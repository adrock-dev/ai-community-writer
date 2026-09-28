import { type BrandId, findChannel } from "../channels.ts";
import type { Database } from "../db/database.ts";
import { bigrams, jaccard } from "../keywords/cluster.ts";

// 유사문서 방지.
//   쓰기 전: 같은 글 유형의 기존 글 제목·소제목·도입부를 "피할 패턴"으로 프롬프트에 넣는다.
//   쓴 뒤:   기존 글 전체와 본문(글자 5-gram MinHash)·제목·소제목 구성을 비교한다.
// 같은 브랜드끼리는 엄격하게, 다른 브랜드(운전면허PLUS ↔ 드라이빙존)는 주제가 겹쳐도 되므로
// 문단이 거의 그대로 반복되는 수준만 막는다.

export const SIMILARITY_LIMITS = {
  sameBrand: { body: 0.3, title: 0.75, outline: 0.6 },
  otherBrand: { body: 0.45, title: 0.9, outline: 1.01 },
} as const;

const HASHES = 64;
const SHINGLE = 5;

export interface Fingerprint {
  outline: string[];
  intro: string;
  /** MinHash 서명 (64개 32비트 정수) */
  signature: number[];
}

/** Markdown 기호를 걷어낸 본문 글자. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/^\|?\s*:?-{3,}.*$/gm, "")
    .replace(/[|*_`>]/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
}

export function outlineOf(markdown: string): string[] {
  return [...markdown.matchAll(/^#{2,3}\s+(.+)$/gm)].map((m) => (m[1] ?? "").trim());
}

/** H1 다음 첫 일반 문단. */
export function introOf(markdown: string): string {
  const blocks = markdown.split(/\n\s*\n/).map((b) => b.trim());
  return (
    blocks.find((b) => b && !/^(#|\||[-*+]\s|\d+[.)]\s|>|!\[)/.test(b))?.replace(/\s+/g, " ") ?? ""
  );
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mix(h: number, seed: number): number {
  let x = (h ^ seed) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

const SEEDS = Array.from({ length: HASHES }, (_, i) => Math.imul(i + 1, 0x9e3779b9) >>> 0);

export function minhash(text: string): number[] {
  const t = text.replace(/[\s\p{P}\p{S}]+/gu, "");
  const sig = new Array<number>(HASHES).fill(0xffffffff);
  for (let i = 0; i + SHINGLE <= t.length; i++) {
    const h = fnv1a(t.slice(i, i + SHINGLE));
    for (let k = 0; k < HASHES; k++) {
      const v = mix(h, SEEDS[k]!);
      if (v < sig[k]!) sig[k] = v;
    }
  }
  return sig;
}

export function signatureSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let same = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same++;
  return same / a.length;
}

export function fingerprint(markdown: string): Fingerprint {
  return {
    outline: outlineOf(markdown),
    intro: introOf(markdown),
    signature: minhash(plainText(markdown)),
  };
}

export function saveFingerprint(db: Database, articleId: number, fp: Fingerprint): void {
  db.run(
    `INSERT INTO article_fingerprints (article_id, outline, intro, shingles) VALUES (?, ?, ?, ?)
     ON CONFLICT(article_id) DO UPDATE SET outline = excluded.outline, intro = excluded.intro, shingles = excluded.shingles`,
    [articleId, JSON.stringify(fp.outline), fp.intro, JSON.stringify(fp.signature)],
  );
}

interface StoredArticle {
  id: number;
  channelId: string;
  articleType: string;
  title: string;
  fp: Fingerprint;
}

function storedArticles(db: Database, excludeId?: number): StoredArticle[] {
  return db
    .all<any>(
      `SELECT a.id, a.channel_id, a.article_type, a.title, f.outline, f.intro, f.shingles
       FROM articles a JOIN article_fingerprints f ON f.article_id = a.id
       WHERE a.status != 'rejected' AND a.id != ? ORDER BY a.id DESC`,
      [excludeId ?? -1],
    )
    .map((r) => ({
      id: r.id,
      channelId: r.channel_id,
      articleType: r.article_type,
      title: r.title,
      fp: { outline: JSON.parse(r.outline), intro: r.intro, signature: JSON.parse(r.shingles) },
    }));
}

const brandOf = (channelId: string): BrandId | undefined => findChannel(channelId)?.brand;

export interface AvoidItem {
  title: string;
  outline: string[];
  intro: string;
}

/** 같은 글 유형의 최근 글: 같은 브랜드 6편 + 다른 브랜드 3편. */
export function avoidList(db: Database, channelId: string, articleType: string): AvoidItem[] {
  const brand = brandOf(channelId);
  const same = storedArticles(db).filter((a) => a.articleType === articleType);
  const mine = same.filter((a) => brandOf(a.channelId) === brand).slice(0, 6);
  const others = same.filter((a) => brandOf(a.channelId) !== brand).slice(0, 3);
  return [...mine, ...others].map((a) => ({
    title: a.title,
    outline: a.fp.outline,
    intro: a.fp.intro,
  }));
}

export interface SimilarHit {
  articleId: number;
  channelId: string;
  title: string;
  bodySim: number;
  titleSim: number;
  outlineSim: number;
  sameBrand: boolean;
  /** 기준을 넘은 항목 (비어 있으면 참고용) */
  exceeded: ("본문" | "제목" | "소제목 구성")[];
}

const round = (x: number) => Math.round(x * 100) / 100;

/** 기존 글과 비교해 비슷한 순으로 돌려준다 (본문 유사도 0.15 이상만). */
export function findSimilar(
  db: Database,
  draft: { title: string; channelId: string; articleType: string; fp: Fingerprint },
  excludeId?: number,
): SimilarHit[] {
  const brand = brandOf(draft.channelId);
  const titleGrams = bigrams(draft.title);
  const outlineGrams = bigrams(draft.fp.outline.join(""));
  const hits: SimilarHit[] = [];
  for (const a of storedArticles(db, excludeId)) {
    const sameBrand = brandOf(a.channelId) === brand;
    const limits = sameBrand ? SIMILARITY_LIMITS.sameBrand : SIMILARITY_LIMITS.otherBrand;
    const body = signatureSimilarity(draft.fp.signature, a.fp.signature);
    const title = jaccard(titleGrams, bigrams(a.title));
    const outline =
      a.articleType === draft.articleType
        ? jaccard(outlineGrams, bigrams(a.fp.outline.join("")))
        : 0;
    const exceeded: SimilarHit["exceeded"] = [];
    if (body >= limits.body) exceeded.push("본문");
    if (title >= limits.title) exceeded.push("제목");
    if (outline >= limits.outline) exceeded.push("소제목 구성");
    if (body >= 0.15 || exceeded.length) {
      hits.push({
        articleId: a.id,
        channelId: a.channelId,
        title: a.title,
        bodySim: round(body),
        titleSim: round(title),
        outlineSim: round(outline),
        sameBrand,
        exceeded,
      });
    }
  }
  return hits.sort((x, y) => y.bodySim - x.bodySim).slice(0, 10);
}

/** 기준을 넘은 유사 글을 수정 지시 문장으로 바꾼다. */
export function similarityIssues(hits: SimilarHit[]): string[] {
  return hits
    .filter((h) => h.exceeded.length)
    .map(
      (h) =>
        `기존 글 "${h.title}"(#${h.articleId})과 ${h.exceeded.join("·")}이(가) 너무 비슷합니다 (본문 ${h.bodySim}, 제목 ${h.titleSim}, 소제목 ${h.outlineSim}). 다른 각도·구성·표현으로 바꾸세요`,
    );
}
