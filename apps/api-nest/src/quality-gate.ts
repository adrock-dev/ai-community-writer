// 콘텐츠 품질 게이트 — 생성·검수 단계에서 마크다운 본문을 검사하는 순수 함수 모음.
// DB/네트워크 의존이 없어 단위 테스트 대상이다(런타임 게이트의 단일 출처).
// 참고: scripts/qa-posts.mjs 에 렌더 인식 게이트가 별도로 있으니 규칙을 바꿀 때 함께 맞춘다.

type Row = Record<string, any>;

// db.service 의 safeJson 과 동일 동작의 로컬 사본(이 모듈을 node:sqlite 의존에서 떼어내기 위함).
function safeJson(value: any, fallback: any): any {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

// AI 상투표현: 형식적 메타서술("~알아보겠습니다")·블로그 프레임("이번 글에서는")·판박이 마무리("도움이 되셨…").
// 사람이 쓴 자연스러운 글엔 거의 없고, 있으면 repair 로 쉽게 다시 쓸 수 있다. 필러/흔한 부사(다양한·꼭·반드시 등)는
// 정상 글에도 흔해 오탐이 크므로 제외한다(정밀 우선). 하나라도 있으면 자연스러움 저하로 본다.
// scripts/qa-posts.mjs 가 이 목록을 미러링한다(렌더 인식 게이트). 두 곳이 어긋나면 test/gate-parity.test.ts 가 실패한다.
export const AI_CLICHE_PHRASES = [
  "알아보겠습니다", "알아보도록", "알아보는 시간", "살펴보겠습니다", "살펴보도록", "짚어보겠습니다",
  "정리해보겠습니다", "정리해 보겠습니다", "정리해드리겠습니다", "살펴보았습니다", "알아봤습니다",
  "이 글에서는", "이번 글에서는", "이번 포스팅", "본 포스팅", "포스팅에서는",
  "도움이 되셨", "도움이 되길 바", "도움이 되기를 바", "참고하시기 바랍니다", "마무리하겠습니다", "마치겠습니다",
  "여러분",
];
export function aiClicheIssues(text: string): string[] {
  const found = AI_CLICHE_PHRASES.filter((phrase) => text.includes(phrase));
  return found.length ? [`ai_cliche_expressions_${found.join("·")}`] : [];
}

// 글간 반복되는 판박이 필러 문장 — 사실이 아니라 템플릿 상투구다(도입/요약/후기 프레임). verbatim 재사용을
// 막아 글마다 다르게 쓰게 한다(중복 콘텐츠 방지). 학원명·주소·과정 같은 사실 문장은 포함하지 않는다.
// extra 로 도메인별 감시 문구(monitored_phrases)를 더할 수 있다.
// scripts/qa-posts.mjs 가 이 목록을 미러링한다. 어긋나면 test/gate-parity.test.ts 가 실패한다.
export const BOILERPLATE_PHRASES = [
  "확인된 후보 정보와 상담 전 체크포인트를 기준으로",
  "실제로 비교할 때 도움이 되는 내용만",
  "후기 요약에서는 친절한 상담·응대와 강사의 꼼꼼한 설명이 확인됩니다",
  "정리하면 선택 기준은 단순",
];
export function boilerplatePhraseIssues(text: string, extra: string[] = []): string[] {
  const found = [...BOILERPLATE_PHRASES, ...extra].filter((phrase) => phrase && text.includes(phrase));
  return found.length ? [`boilerplate_phrase_${found.join("·")}`] : [];
}

// ── 내부 누출 검사의 공유 조각 ────────────────────────────────────────────────
// 런타임 게이트(worker.removeInternalLeakage)와 렌더 인식 게이트(scripts/qa-posts.mjs)는
// 누출 판정 규칙이 서로 다르지만(전자는 줄 제거, 후자는 글 감사) 아래 두 조각은 반드시 같아야 한다.
// 어긋나면 test/gate-parity.test.ts 가 실패한다. 정규식 리터럴 대신 패턴 문자열로 두어
// 양쪽이 동일한 소스를 복제했는지 문자열 단위로 대조할 수 있게 한다.

// 수강생 리뷰 출처 표기는 내부 구현 참조가 아니라 공개 글의 정상 콘텐츠다.
// Legacy Plus 계약은 이 표기가 '없으면' hard_failure(legacy_plus_review_source_missing)이므로,
// 누출 검사가 이를 제외하지 않으면 한쪽에서 필수인 문장 때문에 다른 쪽에서 떨어진다.
export const PUBLIC_REVIEW_ATTRIBUTION_PATTERN = "출처:\\s*DrivingPlus\\s+수강생\\s+리뷰";
export function stripPublicReviewAttribution(text: string): string {
  return String(text || "").replace(new RegExp(PUBLIC_REVIEW_ATTRIBUTION_PATTERN, "gi"), "");
}

// 프롬프트 입력 묶음 표현(내부 자료 언어). "긍정"을 필수 접두어로 두면 모델이 그 단어만 빼고
// "수강생 리뷰 보충자료"라고 써도 양쪽 게이트를 그대로 통과하므로, 접두어는 선택으로 둔다.
export const REVIEW_SUPPLEMENT_LEAK_PATTERN = "(?:긍정\\s*)?(?:수강생|블로그)\\s*리뷰(?:글)?\\s*보충자료";

// 글내 동일 문장(≥16자) verbatim 반복: 사실 카드는 학원당 1회라 정상이므로, 2회 이상이면 템플릿 티/패딩으로 본다.
// readableParagraphs/splitSentences 로 표·헤딩·리스트·링크를 제외해 사실 나열이 아닌 산문 문장만 센다.
export function repeatedSentenceIssues(markdown: string): string[] {
  const counts = new Map<string, number>();
  for (const para of readableParagraphs(markdown)) {
    for (const sentence of splitSentences(para)) {
      const norm = sentence.replace(/\s+/g, " ").trim();
      if (norm.length < 16) continue;
      counts.set(norm, (counts.get(norm) || 0) + 1);
    }
  }
  const repeated = Array.from(counts.values()).filter((n) => n >= 2).length;
  return repeated ? [`repeated_sentence_${repeated}`] : [];
}

// 내부링크 신호(P3, 비차단): facts 의 '관련 글 후보'로 실제 내부 URL 이 주어졌는데 본문이 그 중 하나도
// Markdown 링크로 연결하지 않았으면 신호를 낸다. 관련 후보가 없으면(신규 도메인 등) 신호 없음.
// 이 검사는 articleQualityIssues(하드 게이트)에 넣지 않는다 — 실측상 LLM 이 강한 지시·repair 에도 링크를
// 자주 거부하고(관련 후보가 대개 타 지역이라 억지 링크가 부자연스러움), 하드 게이트로 두면 그 외 품질을 모두
// 통과한 글이 링크 하나로 전량 실패하기 때문이다. 대신 생성 프롬프트가 링크를 유도(예방)하고, 그래도 링크가
// 없으면 worker 가 per_slot.quality_warnings 로만 기록한다(대량 실패 방지). URL 은 facts 에 실제로 주어진
// 것만 인정한다 → 없는 슬러그를 지어낸 가짜 링크는 신호를 지우지 못한다. 링크는 생성 시점에만 존재
// (relatedPostsForSlot→facts→프롬프트)하며 읽기 시점 주입은 하지 않는다.
export function internalLinkIssues(markdown: string, facts: string): string[] {
  const offered = offeredInternalUrls(facts);
  if (!offered.length) return [];
  const linkedHrefs = Array.from(String(markdown || "").matchAll(/\]\(\s*([^)\s]+)/g)).map((m) => String(m[1] || ""));
  const hasInternalLink = linkedHrefs.some((href) => offered.some((url) => href === url || href.startsWith(url)));
  return hasInternalLink ? [] : ["missing_internal_link"];
}

function offeredInternalUrls(facts: string): string[] {
  return Array.from(new Set(Array.from(String(facts || "").matchAll(/https?:\/\/\S+?\/community\/[^\s)]+/g)).map((m) => m[0]!)));
}

// 사이트 자기 공개 도메인(예: app.drivingplus.me) URL 은 내부 누출이 아니다 — 정상 내부링크의 host 다.
// 내부 누출 검사 전에 자기 host 만 제거해 오탐을 없앤다. 내부 API host(api-dev.drivingplus.me)나 산문 속
// 브랜드명(DrivingPlus)은 자기 host 를 지워도 그대로 남아 계속 잡힌다(host 문자열이 서로 부분집합이 아님).
function stripOwnSiteRefs(text: string, siteHost?: string): string {
  return (siteHost ? text.split(siteHost).join("") : text)
    // Public review citations are allowed; an implementation/API reference to
    // DrivingPlus remains an internal-leakage violation.
    .replace(/출처:\s*DrivingPlus\s+수강생\s+리뷰/gi, "");
}

export function articleQualityIssues(markdown: string, facts: string, images: Record<string, string>, boilerplatePhrases: string[] = [], siteHost?: string): string[] {
  const issues: string[] = [];
  const chars = markdown.trim().length;
  const candidateCount = candidateCountFromFacts(facts);
  const candidateNames = candidateNamesFromFacts(facts);
  const h2Count = (markdown.match(/^##\s+/gm) || []).length;
  const imageKeys = Object.keys(images);
  const usedImageKeys = Array.from(markdown.matchAll(/\[IMAGE:([A-Za-z0-9_-]+)\]/g)).map((m) => m[1]!);
  if (!markdown.trim().startsWith("# ")) issues.push("missing_h1_title");
  if (chars < 3500) issues.push(`too_short_${chars}`);
  if (chars > 5600) issues.push(`too_long_${chars}`);
  if (h2Count < 4) issues.push(`not_enough_h2_${h2Count}`);
  if (h2Count > 10) issues.push(`too_many_h2_${h2Count}`);
  issues.push(...readabilityIssues(markdown));
  issues.push(...aiClicheIssues(markdown));
  issues.push(...repeatedSentenceIssues(markdown));
  issues.push(...boilerplatePhraseIssues(markdown, boilerplatePhrases));
  if (!isAnyMarkdownTable(markdown)) issues.push(candidateCount >= 2 ? "missing_comparison_table" : "missing_summary_table");
  if (!/(^|\n)\s*(?:[-*]\s+|\d+[.)]\s+|✅)/m.test(markdown)) issues.push("missing_checklist_or_list");
  if (/\[(?:TABLE|CTA|FAQ|QUOTE|IMAGE|INTERNAL_LINK)_SLOT:|\[INTERNAL_LINK:/i.test(markdown)) issues.push("contains_pseudo_slot");
  if (/\[\d+\]/.test(markdown)) issues.push("contains_visible_citations");
  if (thinSectionCount(markdown) > 1) issues.push("thin_sections");
  if (/(검증된 자료|확인된 콘텐츠 재료|작성 범위|소개 가능한 후보 수|API 자료|제공된 자료|후기 필드|긍정 수강생 리뷰 보충자료|긍정 블로그 리뷰글 보충자료|직접 매칭 후보 수|사용 가능한 이미지 슬롯|본문에 사용할 수 있는 후보|본문에 사용할 수 있는 사진 슬롯|작성자 주의|내부자료ID|내부 데이터|내부 API|DrivingPlus|api-dev\.drivingplus\.me|get-all-academy|firebasestorage\.googleapis\.com|storage\.googleapis\.com)/i.test(stripOwnSiteRefs(markdown, siteHost))) issues.push("exposes_internal_fact_language");
  if (hasRiskyDurationClaim(markdown)) issues.push("risky_duration_or_pass_guarantee_claim");
  if (!hasVerifiedPriceFacts(facts) && hasSpecificMoneyClaim(markdown)) issues.push("unverified_specific_price_claim");
  if (!hasReviewFacts(facts) && hasSpecificReviewClaim(markdown)) issues.push("unverified_review_claim");
  // 후보 수 과장 검사는 학원 후보가 있는 글(학원형)에만 적용한다(키워드형은 candidateNames 가 비어 오탐 방지).
  // 기준은 'facts에 준 개수'가 아니라 '본문에 실제 실린 후보 수'(이름이 본문에 등장한 수) — 제목/헤딩이 그보다 큰 숫자를 주장하면 실패.
  if (candidateNames.length > 0) {
    const rendered = candidateNames.filter((name) => markdown.includes(name)).length;
    const inflated = inflatedCandidateCountClaim(markdown, rendered);
    if (inflated) issues.push(`inflated_candidate_count_${inflated.claimed}_gt_${inflated.actual}`);
  }
  if (candidateNames.length && !candidateNames.some((name) => markdown.includes(name))) issues.push("missing_real_candidate_name");
  const requiredCandidateH3 = Math.min(candidateNames.length, 3);
  const candidateH3Count = candidateHeadingMatchCount(markdown, candidateNames);
  if (requiredCandidateH3 >= 2 && candidateH3Count < requiredCandidateH3) issues.push(`missing_candidate_h3_headings_${candidateH3Count}_lt_${requiredCandidateH3}`);
  if (candidateNames.length >= 2 && !candidateNames.slice(0, 4).some((name) => markdownTableText(markdown).includes(name))) issues.push("table_missing_real_candidate_name");
  if (/수강생 리뷰 \d+|긍정 수강생 리뷰 보충자료|긍정 블로그 리뷰글 보충자료/.test(facts) && !/(후기|리뷰|수강생|블로그)/.test(markdown)) issues.push("review_facts_unused");
  if (imageKeys.length && usedImageKeys.length === 0) issues.push("missing_available_image_slot");
  const unknown = usedImageKeys.filter((key) => !imageKeys.includes(key));
  if (unknown.length) issues.push(`unknown_image_slots_${Array.from(new Set(unknown)).join("_")}`);
  return issues;
}

export function postSurfaceQualityIssues(post: Row, minChars = 2600, candidateCount = 0, boilerplatePhrases: string[] = [], siteHost?: string): string[] {
  const markdown = String(post.body_markdown || "");
  const title = String(post.title || "");
  const issues: string[] = [];
  const chars = markdown.trim().length;
  const h2Count = (markdown.match(/^##\s+/gm) || []).length;
  const images = safeJson(post.images, {});
  const imageKeys = images && typeof images === "object" && !Array.isArray(images) ? Object.keys(images) : [];
  const usedImageKeys = Array.from(markdown.matchAll(/\[IMAGE:([A-Za-z0-9_-]+)\]/g)).map((m) => m[1]!);
  if (!markdown.trim().startsWith("# ")) issues.push("missing_h1_title");
  if (chars < minChars) issues.push(`too_short_${chars}`);
  if (chars > 5600) issues.push(`too_long_${chars}`);
  if (h2Count < 4) issues.push(`not_enough_h2_${h2Count}`);
  if (h2Count > 10) issues.push(`too_many_h2_${h2Count}`);
  issues.push(...readabilityIssues(markdown));
  issues.push(...aiClicheIssues(`${title}\n${markdown}`));
  issues.push(...repeatedSentenceIssues(markdown));
  issues.push(...boilerplatePhraseIssues(`${title}\n${markdown}`, boilerplatePhrases));
  if (!isAnyMarkdownTable(markdown)) issues.push(candidateCount >= 2 ? "missing_comparison_table" : "missing_summary_table");
  if (thinSectionCount(markdown) > 1) issues.push("thin_sections");
  if (!/(^|\n)\s*(?:[-*]\s+|\d+[.)]\s+|✅|✓)/m.test(markdown)) issues.push("missing_checklist_or_list");
  if (/\[(?:TABLE|CTA|FAQ|QUOTE|IMAGE|INTERNAL_LINK)_SLOT:|\[INTERNAL_LINK:/i.test(markdown)) issues.push("contains_pseudo_slot");
  if (/\[\d+\]/.test(markdown)) issues.push("contains_visible_citations");
  if (/(운전선생|검증된 자료|확인된 콘텐츠 재료|작성 범위|소개 가능한 후보 수|API 자료|제공된 자료|후기 필드|긍정 수강생 리뷰 보충자료|긍정 블로그 리뷰글 보충자료|직접 매칭 후보 수|사용 가능한 이미지 슬롯|본문에 사용할 수 있는 후보|본문에 사용할 수 있는 사진 슬롯|작성자 주의|내부자료ID|내부 데이터|내부 API|DrivingPlus|api-dev\.drivingplus\.me|get-all-academy|zipcode\/search-seo|firebasestorage\.googleapis\.com|storage\.googleapis\.com)/i.test(stripOwnSiteRefs(`${title}\n${markdown}`, siteHost))) issues.push("exposes_internal_fact_language");
  if (hasRiskyDurationClaim(`${title}\n${markdown}`)) issues.push("risky_duration_or_pass_guarantee_claim");
  // 학원 후보가 있는 글에서만(candidateCount>0) 후보 수 과장 검사. 키워드형(0)은 오탐 방지 위해 건너뜀.
  const inflated = candidateCount > 0 ? inflatedCandidateCountClaim(`${title}\n${markdown}`, candidateCount) : null;
  if (inflated) issues.push(`inflated_candidate_count_${inflated.claimed}_gt_${inflated.actual}`);
  if (/[가-힣]+(?:시|군|구|읍|면|동)운전면허학원/.test(title)) issues.push("keyword_spacing_issue");
  if (imageKeys.length && usedImageKeys.length === 0) issues.push("missing_available_image_slot");
  const unknown = usedImageKeys.filter((key) => !imageKeys.includes(key));
  if (unknown.length) issues.push(`unknown_image_slots_${Array.from(new Set(unknown)).join("_")}`);
  return issues;
}

function readabilityIssues(markdown: string): string[] {
  const issues: string[] = [];
  const paragraphs = readableParagraphs(markdown);
  const longParagraphs = paragraphs.filter((paragraph) => paragraph.length > 420);
  if (longParagraphs.length) issues.push(`overlong_paragraph_${Math.max(...longParagraphs.map((p) => p.length))}`);
  if (adjacentHeadingCount(markdown) > 0) issues.push('adjacent_headings_without_body');
  if (orphanHeadingCount(markdown) > 1) issues.push('too_many_thin_or_empty_heading_sections');
  issues.push(...sentenceDifficultyIssues(markdown));
  return issues;
}

// 문장 난이도(가독성): 한 '문장'이 지나치게 길면(run-on) 읽기 어렵다. 한국어 형태소 분석 없이
// 결정적으로 잴 수 있는 대리 지표로 문장 길이를 쓴다. 실제 생성 글의 산문 문장은 (링크 URL 제외)
// p99≈106자·최대 141자라, 150자 이상은 사실상 run-on 으로 본다. scripts/qa-posts.mjs 와 동일 규칙.
export const HARD_SENTENCE_CHARS = 150;      // 이 이상이면 '읽기 어려운 긴 문장'(qa-posts.mjs 미러)
export const OVERLONG_SENTENCE_CHARS = 220;  // 이 이상이면 한 문장만으로도 실패(qa-posts.mjs 미러)
function sentenceDifficultyIssues(markdown: string): string[] {
  const issues: string[] = [];
  const lengths = readableParagraphs(markdown).flatMap(splitSentences).map((sentence) => sentence.length);
  if (!lengths.length) return issues;
  const longest = Math.max(...lengths);
  const hard = lengths.filter((n) => n >= HARD_SENTENCE_CHARS).length;
  if (longest >= OVERLONG_SENTENCE_CHARS) issues.push(`overlong_sentence_${longest}`);
  else if (hard >= 2) issues.push(`hard_sentences_${hard}`);
  return issues;
}

// 문장 단위 분리 + 길이 왜곡 요소 제거: 링크 URL·강조 마커는 독자가 읽는 문장 길이가 아니다.
function splitSentences(paragraph: string): string[] {
  return String(paragraph || "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")   // [텍스트](URL) → 텍스트
    .replace(/https?:\/\/\S+/g, "")               // 남은 맨 URL 제거
    .replace(/\*\*|__|[*_`]/g, "")                // 강조 마커 제거
    .split(/(?<=[.!?。…])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function readableParagraphs(markdown: string): string[] {
  return String(markdown || '')
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part && !/^(?:#{1,6}\s+|\|.+\||[-*]\s+|\d+[.)]\s+|>|\[IMAGE:)/m.test(part));
}

function adjacentHeadingCount(markdown: string): number {
  const lines = String(markdown || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let count = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^#{2,3}\s+/.test(lines[i] || '') && /^#{2,3}\s+/.test(lines[i + 1] || '')) count++;
  }
  return count;
}

function orphanHeadingCount(markdown: string): number {
  const sections = String(markdown || '').split(/^##\s+/gm).slice(1);
  let count = 0;
  for (const section of sections) {
    const lines = section.split(/\r?\n/);
    lines.shift();
    const text = lines.join('\n')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/\[IMAGE:[A-Za-z0-9_-]+\]/g, '')
      .replace(/^\|.+\|$/gm, '')
      .replace(/(^|\n)\s*(?:[-*]\s+|\d+[.)]\s+|✅|✓).*$/gm, '')
      .replace(/^#{3,6}\s+.+$/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length > 0 && text.length < 80) count++;
  }
  return count;
}

const RISKY_DURATION_OR_GUARANTEE_RE = /\d+\s*일\s*(?:만|컷|완성)|삼\s*일\s*(?:만|컷|완성)|하루\s*만|당일\s*합\s*격|무조건\s*합\s*격|합\s*격\s*보장|보장\s*합\s*격/u;
const SPECIFIC_MONEY_RE = /\d{2,3}\s*만\s*(?:원|뤈|웜)?|\d{3},\d{3}\s*원/u;
const SPECIFIC_REVIEW_CLAIM_RE = /실제\s*수강생|수강생들은|수강생이|후기에서는|후기에서|리뷰에서는|리뷰에서|블로그\s*후기/u;

function hasRiskyDurationClaim(value: string): boolean {
  return RISKY_DURATION_OR_GUARANTEE_RE.test(value);
}

function hasSpecificMoneyClaim(value: string): boolean {
  return SPECIFIC_MONEY_RE.test(value);
}

function hasVerifiedPriceFacts(facts: string): boolean {
  return /(?:수강료|가격|비용):\s*[^/\n]+/u.test(facts);
}

function hasReviewFacts(facts: string): boolean {
  return /수강생 리뷰 \d+|긍정 수강생 리뷰 보충자료|긍정 블로그 리뷰글 보충자료/u.test(facts);
}

function hasSpecificReviewClaim(value: string): boolean {
  return SPECIFIC_REVIEW_CLAIM_RE.test(value);
}

function inflatedCandidateCountClaim(markdown: string, actual: number): { claimed: number; actual: number } | null {
  if (!actual || actual < 1) return null;
  const headings = Array.from(markdown.matchAll(/^#{1,3}\s+(.+)$/gm)).map((m) => m[1] || "");
  const titleLine = markdown.split(/\r?\n/, 1)[0] || "";
  const targets = Array.from(new Set([titleLine.replace(/^#\s+/, ""), ...headings]));
  let maxClaim = 0;
  for (const target of targets) {
    for (const count of candidateCountClaims(target)) maxClaim = Math.max(maxClaim, count);
  }
  return maxClaim > actual ? { claimed: maxClaim, actual } : null;
}

function candidateCountClaims(value: string): number[] {
  const text = String(value || "");
  const claims: number[] = [];
  const patterns = [
    /(?:BEST|TOP)\s*(\d{1,2})/giu,
    /(?:추천|비교|후보|학원)\s*(\d{1,2})\s*(?:곳|개)/gu,
    /(\d{1,2})\s*(?:곳|개)\s*(?:추천|비교|후보|학원)/gu,
    /운전면허학원\s*(\d{1,2})\s*(?:곳|개)/gu,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const n = Number(match[1]);
      if (Number.isFinite(n)) claims.push(n);
    }
  }
  return claims;
}

export function candidateCountFromFacts(facts: string): number {
    const direct = facts.match(/(?:직접 매칭 후보 수|본문에 사용할 수 있는 후보|소개 가능한 후보 수):\s*(\d+)/);
  if (direct) return Number(direct[1]);
  return (facts.match(/^\[\d+\]/gm) || []).length;
}

export function candidateNamesFromFacts(facts: string): string[] {
  return Array.from(facts.matchAll(/^\[\d+\]\s+([^\n/]+?)(?:\s*\/|\s*$)/gm))
    .map((m) => String(m[1] || "").trim())
    .filter((name) => name.length >= 2 && !/^(?:test|테스트|sample|dummy)/i.test(name));
}

// 본문에 실제로 실린 후보 수 = facts가 준 후보 이름 중 본문에 등장한 수. 제목 개수·저장 카운트의 단일 소스.
export function renderedCandidateCount(markdown: string, facts: string): number {
  return candidateNamesFromFacts(facts).filter((name) => markdown.includes(name)).length;
}

function candidateHeadingMatchCount(markdown: string, candidateNames: string[]): number {
  const headings = Array.from(markdown.matchAll(/^###\s+(.+)$/gm))
    .map((match) => normalizeCandidateHeading(String(match[1] || "")));
  let matched = 0;
  for (const name of candidateNames) {
    const normalizedName = normalizeCandidateHeading(name);
    if (!normalizedName || normalizedName.length < 3) continue;
    if (headings.some((heading) => heading === normalizedName || heading.startsWith(normalizedName))) matched++;
  }
  return matched;
}

function normalizeCandidateHeading(value: string): string {
  return String(value || "")
    .replace(/^[\d.)\s]+/, "")
    .replace(/[\s*_`#()（）·.,:：—\-]/g, "")
    .toLowerCase();
}

function markdownTableText(markdown: string): string {
  return markdown.split(/\r?\n/).filter((line) => line.includes("|")).join("\n");
}

function thinSectionCount(markdown: string): number {
  const sections = markdown.split(/^##\s+/gm).slice(1);
  let count = 0;
  for (const section of sections) {
    const lines = section.split(/\r?\n/);
    const heading = String(lines.shift() || "");
    if (/FAQ|자주 묻는 질문|체크리스트|요약|상담|예약/i.test(heading)) continue;
    const text = lines.join("\n")
      .replace(/\[IMAGE:[A-Za-z0-9_-]+\]/g, "")
      .replace(/\|[^\n]+\|/g, "")
      .replace(/(^|\n)\s*(?:[-*]\s+|\d+[.)]\s+|✅|✓).*$/gm, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length > 0 && text.length < 140) count++;
  }
  return count;
}

function isAnyMarkdownTable(markdown: string): boolean {
  const lines = markdown.split(/\r?\n/).map((line) => line.trim());
  return lines.some((line, index) => line.includes("|") && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(lines[index + 1] || "") && (lines[index + 2] || "").includes("|"));
}
