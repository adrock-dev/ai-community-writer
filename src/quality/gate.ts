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
  /**
   * 공공 요금 근거: 유의사항의 "공단 안내" 묶음(공단 수수료·과태료 등). 여기 있는 금액만 쓴
   * 수수료·과태료 문단은 부가세 표기를 요구하지 않는다(부가세 여부가 안내되지 않은 공공 요금).
   */
  publicFees?: string;
  /** 비교·추천 대상의 실제 후보 이름 */
  candidates: string[];
  /**
   * 본문에 쓸 수 있는 이미지 번호 (img1 …). 생성 직후에만 준다.
   * 검수 중 수정한 글은 이미 실제 주소로 바뀌어 있으므로 비워 두면 번호 검사를 건너뛴다.
   */
  imageIds?: string[];
  /** 본문에 넣어도 되는 자사 사이트 링크 주소. 없으면 링크를 모두 뺀다. */
  allowedLinks?: string[];
  /** 넣을 섹션이 제한된 이미지(글 전체 1장까지, 그 섹션에 mustMention 중 하나가 있어야 함). */
  restrictedImages?: { id: string; mustMention: string[] }[];
}

export interface Amount {
  value: number;
  approx: boolean;
  raw: string;
}

const APPROX_BEFORE = /(약|대략|최대|최소|평균|최저|최고|대체로)\s*$/;
const APPROX_AFTER = /^\s*(대|선|정도|안팎|이상|이하|내외|부터|~|–)/;
const num = (s: string | undefined) => Number((s ?? "").replace(/,/g, ""));

/**
 * 금액을 원 단위로 읽는다.
 * "25만원", "62만 7천원", "62만 7,500원", "4만 4천원", "7,500원", "3천원", "250,000원",
 * "약 30만원대", 범위 "25만~45만원"(앞쪽도 금액으로 읽고 어림으로 표시)
 */
export function extractAmounts(text: string): Amount[] {
  const out: Amount[] = [];
  const re =
    /(\d[\d,]*(?:\.\d+)?)\s*만(?:\s*(\d[\d,]*)\s*(천)?)?\s*원|(\d[\d,]*(?:\.\d+)?)\s*만\s*(?=[~–-])|(\d[\d,]*)\s*천\s*원|(\d[\d,]*)\s*원/g;
  for (const m of text.matchAll(re)) {
    const [raw, man, rest, restThousand, rangeMan, thousand, plain] = m;
    let value: number;
    let range = false;
    if (man !== undefined)
      value = num(man) * 10_000 + (rest ? num(rest) * (restThousand ? 1000 : 1) : 0);
    else if (rangeMan !== undefined) {
      value = num(rangeMan) * 10_000;
      range = true;
    } else if (thousand !== undefined) value = num(thousand) * 1000;
    else value = num(plain);
    value = Math.round(value);
    if (!Number.isFinite(value) || value < 1000) continue;
    const at = m.index ?? 0;
    const approx =
      range ||
      APPROX_BEFORE.test(text.slice(Math.max(0, at - 6), at)) ||
      APPROX_AFTER.test(text.slice(at + raw.length, at + raw.length + 4));
    out.push({ value, approx, raw: raw.trim() });
  }
  return out;
}

/** "250,000원"·"250000원"처럼 만 단위로 쓰지 않은 1만원 이상 금액 */
export function unreadableAmounts(text: string): string[] {
  return [...text.matchAll(/(?<![\d.만])(\d{1,3}(?:,\d{3})+|\d{5,})\s*원/g)]
    .filter((m) => num(m[1]) >= 10_000)
    .map((m) => m[0].trim());
}

const PUBLIC_FEE_WORDS = /수수료|과태료|신체검사/;

/**
 * 공단 수수료·과태료만 쓴 글인지: 금액이 모두 공공 요금 근거에 있고, 수수료·과태료·신체검사라는
 * 말이 함께 있다(표는 바로 앞뒤 문단까지 본다). 업체 요금이 섞이면 부가세 표기를 그대로 요구한다.
 */
export function isPublicFeeText(
  text: string,
  publicFees: string,
  context: (string | undefined)[] = [],
): boolean {
  const amounts = extractAmounts(text);
  if (!amounts.length || !publicFees) return false;
  const known = new Set(extractAmounts(publicFees).map((a) => a.value));
  return (
    amounts.every((a) => known.has(a.value)) &&
    [text, ...context].some((t) => PUBLIC_FEE_WORDS.test(t ?? ""))
  );
}

/**
 * 금액이 나온 문단·표에 부가세 포함 여부가 적혀 있는지. 표는 바로 앞뒤 문단(표 설명)까지 본다.
 * 공단 수수료·과태료만 쓴 블록(`publicFees`)은 제외한다. 표시가 없는 블록의 앞부분을 돌려준다.
 */
export function amountsWithoutVat(markdown: string, publicFees = ""): string[] {
  const blocks = markdown.split(/\n\s*\n/).map((b) => b.trim());
  const hasVat = (s: string | undefined) => /부가세|VAT/i.test(s ?? "");
  const missing: string[] = [];
  blocks.forEach((block, i) => {
    if (!extractAmounts(block).length || hasVat(block)) return;
    const isTable = block.startsWith("|");
    if (isTable && (hasVat(blocks[i - 1]) || hasVat(blocks[i + 1]))) return;
    const around = isTable ? [blocks[i - 1], blocks[i + 1]] : [];
    if (isPublicFeeText(block, publicFees, around)) return;
    missing.push(block.replace(/\s+/g, " ").slice(0, 40));
  });
  return missing;
}

/** 분량 기준 글자 수: Markdown 기호를 뺀 본문, 연속 공백은 한 칸으로 센다(공백 포함). */
export function bodyChars(markdown: string): number {
  return plainText(markdown).replace(/\s+/g, " ").trim().length;
}

export interface ImageRef {
  alt: string;
  src: string;
  line: number;
}

export function imageRefs(markdown: string): ImageRef[] {
  const refs: ImageRef[] = [];
  markdown.split(/\r?\n/).forEach((l, line) => {
    for (const m of l.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)) {
      refs.push({ alt: (m[1] ?? "").trim(), src: m[2] ?? "", line });
    }
  });
  return refs;
}

/** 이미지가 들어간 H2 섹션(소제목부터 다음 H2 전까지)의 글. */
function sectionTextAt(lines: string[], line: number): string {
  let start = line;
  while (start > 0 && !/^##\s/.test(lines[start] ?? "")) start--;
  let end = line + 1;
  while (end < lines.length && !/^##\s/.test(lines[end] ?? "")) end++;
  return lines
    .slice(start, end)
    .join("\n")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "");
}

/** 섹션이 제한된 사진(드라이빙존 매장 사진 등): 1장까지, 그 섹션이 해당 대상을 다뤄야 한다. */
function restrictedImageIssues(
  body: string,
  images: ImageRef[],
  restricted: { id: string; mustMention: string[] }[],
): string[] {
  if (!restricted.length) return [];
  const byId = new Map(restricted.map((r) => [r.id, r.mustMention]));
  const used = images.filter((i) => byId.has(i.src));
  const issues: string[] = [];
  if (used.length > 1) {
    issues.push(
      `매장 사진(${used.map((i) => i.src).join(", ")})은 1장만 쓰세요. 나머지 자리는 삽화 번호로 바꾸세요`,
    );
  }
  const lines = body.split(/\r?\n/);
  const misplaced = used.filter((i) => {
    const words = byId.get(i.src) ?? [];
    const section = sectionTextAt(lines, i.line);
    return !words.some((w) => section.includes(w));
  });
  if (misplaced.length) {
    issues.push(
      `매장 사진(${misplaced.map((i) => i.src).join(", ")})이 드라이빙존을 다루지 않는 섹션에 있습니다. 드라이빙존 안내 섹션으로 옮기거나 그 자리는 삽화로 바꾸세요`,
    );
  }
  return issues;
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
  const chars = bodyChars(body);
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
      .filter((p) => !/^(#|\||[-*+]\s|\d+[.)]\s|!\[)/.test(p.trim()))
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
  // 원고의 원시 HTML은 내보낼 때 글자로 바뀐다. 서식은 **굵게**·==색 강조==로만 넣는다.
  const tag = /<\/?(?:span|b|strong|em|i|u|mark|font|br|p|div)\b[^>]*>/i.exec(body)?.[0];
  if (tag) {
    issues.push(`HTML 태그(${tag})를 빼세요. 굵게는 **문구**, 색 강조는 ==문구== 로 쓰세요`);
  }
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

  // 금액 표기: 25만원 형태 + 부가세 포함 여부
  const unreadable = unreadableAmounts(all);
  if (unreadable.length) {
    issues.push(
      `금액은 "25만원", "62만 7천원"처럼 만 단위로 쓰세요: ${[...new Set(unreadable)].slice(0, 5).join(", ")}`,
    );
  }
  const noVat = amountsWithoutVat(body, ctx.publicFees);
  if (noVat.length) {
    issues.push(
      `금액이 나온 문장·표에 부가세 포함·별도를 함께 적으세요(도로교통공단 수수료·과태료는 제외): "${noVat.slice(0, 3).join('", "')}"`,
    );
  }
  if (
    extractAmounts(draft.summary).length &&
    !/부가세|VAT/i.test(draft.summary) &&
    !isPublicFeeText(draft.summary, ctx.publicFees ?? "")
  ) {
    issues.push("검색 결과 설명에 금액을 쓰려면 부가세 포함·별도도 함께 적거나 금액을 빼세요");
  }

  // 이미지
  const images = imageRefs(body);
  const restricted = ctx.restrictedImages ?? [];
  const minImages = ctx.imageIds
    ? Math.min(
        quality.minImages,
        ctx.imageIds.length - restricted.length + Math.min(1, restricted.length),
      )
    : quality.minImages;
  if (images.length < minImages) {
    issues.push(
      `이미지를 ${quality.minImages}장 이상 넣으세요 (지금 ${images.length}장). 서로 다른 섹션에 ![대체 텍스트](img1) 형식으로 넣으세요`,
    );
  }
  const ids = ctx.imageIds;
  const unknownImages = ids ? images.filter((i) => !ids.includes(i.src)).map((i) => i.src) : [];
  if (ids && unknownImages.length) {
    issues.push(
      `없는 이미지 번호입니다: ${[...new Set(unknownImages)].join(", ")}. 제공된 번호(${ids.join(", ") || "없음"})만 쓰세요`,
    );
  }
  if (images.some((i) => !i.alt))
    issues.push("모든 이미지에 대체 텍스트를 쓰세요 (![대체 텍스트](img1))");
  const srcs = images.map((i) => i.src);
  if (new Set(srcs).size < srcs.length) issues.push("같은 이미지를 두 번 쓰지 마세요");
  const imageLines = new Set(images.map((i) => i.line));
  const bodyLines = body.split(/\r?\n/);
  const adjacent = images.some((i) => {
    let next = i.line + 1;
    while (next < bodyLines.length && !bodyLines[next]?.trim()) next++;
    return imageLines.has(next);
  });
  if (adjacent) issues.push("이미지를 연달아 두지 말고 서로 다른 섹션에 나눠 넣으세요");
  issues.push(...restrictedImageIssues(body, images, restricted));

  // 링크: 모델은 웹을 보지 않으므로 세부 주소는 지어낸 것일 수 있다 (이미지 주소는 제외)
  const links = [
    ...body.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g),
    ...body
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\]\([^)]*\)/g, "]")
      .matchAll(/https?:\/\/[^\s)>\]"']+/g),
  ].map((m) => m[1] ?? m[0]);
  const allowed = new Set(ctx.allowedLinks ?? []);
  const foreign = links.filter((l) => !allowed.has(l));
  if (foreign.length) {
    issues.push(
      `본문의 링크 주소를 빼세요: ${[...new Set(foreign)].slice(0, 3).join(", ")}. 확인처는 "safedriving.or.kr"처럼 사이트 이름만 글자로 쓰세요${allowed.size ? " (링크는 [본문에 넣을 수 있는 링크]의 주소만 됩니다)" : ""}`,
    );
  }
  const own = links.filter((l) => allowed.has(l));
  if (own.length > 2) issues.push(`자사 링크는 2개까지만 넣으세요 (지금 ${own.length}개)`);
  if (/(?:생성|AI)\s*(?:삽화|이미지)|삽화/.test(images.map((i) => i.alt).join(" "))) {
    issues.push(
      '이미지 대체 텍스트에 "생성·삽화·AI"를 쓰지 말고 "기능시험 코스 예시 이미지"처럼 장면을 쓰세요',
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
