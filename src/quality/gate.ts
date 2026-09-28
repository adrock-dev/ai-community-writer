import type { ChannelDef } from "../channels.ts";
import { compactKeyword } from "../keywords/cluster.ts";
import { introOf, plainText } from "../similarity/fingerprint.ts";
import type { DraftArticle } from "../writer/output.ts";

// 품질 게이트: 사람이 검수하기 전에 기계적으로 걸러낼 문제를 찾는다.
// 문제 문구는 그대로 운영자에게 보이고, 재작성 프롬프트에도 들어가므로 고칠 방법까지 적는다.

export interface GateContext {
  channel: ChannelDef;
  primaryKeyword: string;
  articleType: string;
  /** 근거 자료 + 유의사항. 본문 숫자(금액·비율)는 여기에 있어야 한다. */
  corpus: string;
  /** 비교·추천 대상의 실제 후보 이름 */
  candidates: string[];
}

export interface Amount {
  value: number;
  approx: boolean;
  raw: string;
}

/** "627,000원", "62만 7천 원", "25만원", "약 30만 원대", "25만~45만 원" 같은 금액을 원 단위로 읽는다. */
export function extractAmounts(text: string): Amount[] {
  const out: Amount[] = [];
  const re =
    /(약|대략|최대|최소|평균|최저|최고)?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(만\s*(?:(\d{1,4})\s*천)?|천)?\s*(원|~|–|-)(대|선|정도|안팎|이상|이하)?/g;
  for (const m of text.matchAll(re)) {
    const [raw, prefix, numStr, unit, thousands, tail, suffix] = m;
    // "25만~" 형태는 만 단위일 때만 금액 범위로 본다 (날짜·개수 범위와 구분)
    if (tail !== "원" && !unit?.startsWith("만")) continue;
    let value = Number((numStr ?? "").replace(/,/g, ""));
    if (unit?.startsWith("만")) value = value * 10_000 + Number(thousands ?? 0) * 1000;
    else if (unit === "천") value *= 1000;
    value = Math.round(value);
    if (value < 1000) continue;
    out.push({ value, approx: Boolean(prefix || suffix || tail !== "원"), raw: raw.trim() });
  }
  return out;
}

export function extractPercents(text: string): number[] {
  return [...text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => Number(m[1]));
}

const INTERNAL_WORDS =
  /제공된 자료|근거 자료|자료에 따르면|입력 자료|API|데이터베이스|크롤링|naver_place|get-all-academy|api\.driving|localhost|운전선생/;
const AI_SELF = /(AI|인공지능)(로서|입니다|가 작성)|언어 모델|ChatGPT|Claude|Codex/;
const PLACEHOLDER = /\[(?:TODO|이미지|사진|링크|IMAGE|LINK)[^\]]*\]|OOO|○○|\{\{|\}\}/;
const GUARANTEE =
  /(?:100\s*%|무조건|반드시|확실히)\s*(?:합격|취득)|합격\s*보장|취득\s*보장|\d+\s*(?:일|주)\s*(?:만에|안에)\s*(?:합격|취득)|최단기\s*합격/;

function faqQuestionCount(markdown: string): number | undefined {
  const m = /^#{2,3}\s*.*(자주\s*묻는\s*질문|FAQ|Q\s*&\s*A).*$/im.exec(markdown);
  if (!m) return undefined;
  const section = markdown.slice((m.index ?? 0) + m[0].length);
  const next = /^##\s+/m.exec(section);
  const text = next ? section.slice(0, next.index) : section;
  return text
    .split(/\r?\n/)
    .filter(
      (l) => /^\s*(#{3,4}\s*)?(\*\*)?\s*(Q[.:\d\s]|질문)/.test(l) || /\?\**\s*$/.test(l.trim()),
    ).length;
}

export function qualityIssues(draft: DraftArticle, ctx: GateContext): string[] {
  const issues: string[] = [];
  const { quality } = ctx.channel;
  const body = draft.body;
  const plain = plainText(body).replace(/\s+/g, " ").trim();
  const chars = plain.length;
  const key = compactKeyword(ctx.primaryKeyword);
  const isCafe = ctx.channel.format === "cafe-text";

  // 제목·설명
  if (!draft.title) issues.push("제목이 없습니다. <<<TITLE>>>에 제목을 쓰세요");
  else {
    if (!compactKeyword(draft.title).includes(key)) {
      issues.push(`제목에 대표 키워드 "${ctx.primaryKeyword}"를 넣으세요`);
    }
    if (draft.title.length < 12 || draft.title.length > 50) {
      issues.push(`제목 길이가 ${draft.title.length}자입니다. 25~40자 안팎으로 쓰세요`);
    }
  }
  if (draft.summary.length < 50 || draft.summary.length > 170) {
    issues.push(`검색 결과 설명이 ${draft.summary.length}자입니다. 80~150자로 쓰세요`);
  }

  // 분량·구조
  if (chars < quality.minChars)
    issues.push(`본문이 ${chars}자로 짧습니다. ${quality.minChars}자 이상으로 쓰세요`);
  if (chars > quality.maxChars)
    issues.push(`본문이 ${chars}자로 깁니다. ${quality.maxChars}자 이하로 줄이세요`);
  const h2 = (body.match(/^##\s+/gm) ?? []).length;
  if (h2 < quality.minH2)
    issues.push(`소제목(H2)이 ${h2}개입니다. ${quality.minH2}개 이상으로 나누세요`);
  const hasTable = /^\|.+\|\s*$/m.test(body) && /^\|?\s*:?-{3,}/m.test(body);
  if (quality.requireTable && !hasTable) issues.push("비교·정리 표를 1개 이상 넣으세요");
  if (quality.requireFaq) {
    const faq = faqQuestionCount(body);
    if (faq === undefined) issues.push('"자주 묻는 질문" 섹션을 마지막에 넣으세요 (질문 3~5개)');
    else if (faq < 3) issues.push(`자주 묻는 질문이 ${faq}개입니다. 3~5개로 늘리세요`);
  }
  if (isCafe && (h2 > 0 || hasTable)) {
    issues.push("카페 원고에는 ## 소제목과 표를 쓰지 말고 굵은 글씨 한 줄로 단락을 나누세요");
  }

  // 첫 문단 (AEO)
  const intro = introOf(body);
  if (!compactKeyword(intro).includes(key)) {
    issues.push(`제목 아래 첫 문단에 대표 키워드 "${ctx.primaryKeyword}"와 결론을 넣으세요`);
  }
  if (intro.length > 350) issues.push("첫 문단이 깁니다. 결론을 2~3문장으로 먼저 쓰세요");

  // 가독성
  const longest = Math.max(
    0,
    ...body
      .split(/\n\s*\n/)
      .filter((p) => !/^(#|\||[-*+]\s|\d+[.)]\s)/.test(p.trim()))
      .map((p) => p.trim().length),
  );
  if (longest > 450) issues.push(`한 문단이 ${longest}자입니다. 450자 이하로 나누세요`);
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  // "## 자주 묻는 질문" 바로 아래 "### Q." 처럼 하위 소제목이 오는 것은 괜찮다.
  // 같은 수준 이상의 소제목이 본문 없이 이어질 때만 잡는다.
  const level = (l: string) => /^(#{2,6})\s/.exec(l)?.[1]?.length ?? 0;
  const emptyHeading = lines.some((l, i) => {
    const here = level(l);
    const next = level(lines[i + 1] ?? "");
    return here > 0 && next > 0 && next <= here;
  });
  if (emptyHeading) {
    issues.push("내용 없이 이어지는 소제목이 있습니다. 소제목마다 본문을 쓰세요");
  }
  const repeats = compactKeyword(plain).split(key).length - 1;
  if (repeats > Math.max(10, chars / 250)) {
    issues.push(`대표 키워드가 ${repeats}번 반복됩니다. 자연스럽게 줄이세요`);
  }

  // 금지 표현
  const all = `${draft.title}\n${draft.summary}\n${body}`;
  const internal = INTERNAL_WORDS.exec(all)?.[0];
  if (internal)
    issues.push(`내부 용어 "${internal}"가 드러납니다. 독자에게 보이는 표현으로 바꾸세요`);
  if (AI_SELF.test(all)) issues.push("AI 자신에 대한 언급을 빼세요");
  const placeholder = PLACEHOLDER.exec(all)?.[0];
  if (placeholder) issues.push(`자리표시 "${placeholder}"를 빼세요`);
  if (/\[\d+\]/.test(body)) issues.push("각주 번호([1] 등)를 빼세요");
  const guarantee = GUARANTEE.exec(all)?.[0];
  if (guarantee) issues.push(`"${guarantee}" 같은 합격 보장·단정 표현을 빼세요`);

  // 숫자 근거
  const known = extractAmounts(ctx.corpus).map((a) => a.value);
  const unknown = extractAmounts(all).filter(
    (a) =>
      !known.includes(a.value) &&
      !(a.approx && known.some((k) => Math.abs(k - a.value) / k <= 0.1)),
  );
  if (unknown.length) {
    issues.push(
      `근거 자료에 없는 금액이 있습니다: ${[...new Set(unknown.map((a) => a.raw))].slice(0, 5).join(", ")}. 근거 자료의 금액만 쓰거나 빼세요`,
    );
  }
  const knownPct = extractPercents(ctx.corpus);
  const unknownPct = extractPercents(all).filter((p) => !knownPct.includes(p));
  if (unknownPct.length) {
    issues.push(
      `근거 자료에 없는 비율이 있습니다: ${[...new Set(unknownPct)].map((p) => `${p}%`).join(", ")}. 빼세요`,
    );
  }

  // 후보 수 부풀리기
  if (ctx.candidates.length && (ctx.articleType === "recommend" || ctx.articleType === "academy")) {
    const claimed = [...all.matchAll(/(?:TOP|BEST|베스트)\s*(\d+)|(\d+)\s*곳/gi)]
      .map((m) => Number(m[1] ?? m[2]))
      .filter((n) => n > ctx.candidates.length);
    if (claimed.length) {
      issues.push(
        `실제 후보는 ${ctx.candidates.length}곳입니다. ${claimed[0]}곳처럼 부풀려 쓰지 마세요`,
      );
    }
  }
  return issues;
}
