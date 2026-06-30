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

export function articleQualityIssues(markdown: string, facts: string, images: Record<string, string>): string[] {
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
  if (!isAnyMarkdownTable(markdown)) issues.push(candidateCount >= 2 ? "missing_comparison_table" : "missing_summary_table");
  if (!/(^|\n)\s*(?:[-*]\s+|\d+[.)]\s+|✅)/m.test(markdown)) issues.push("missing_checklist_or_list");
  if (/\[(?:TABLE|CTA|FAQ|QUOTE|IMAGE|INTERNAL_LINK)_SLOT:|\[INTERNAL_LINK:/i.test(markdown)) issues.push("contains_pseudo_slot");
  if (/\[\d+\]/.test(markdown)) issues.push("contains_visible_citations");
  if (thinSectionCount(markdown) > 1) issues.push("thin_sections");
  if (/(검증된 자료|확인된 콘텐츠 재료|작성 범위|소개 가능한 후보 수|API 자료|제공된 자료|후기 필드|긍정 수강생 리뷰 보충자료|긍정 블로그 리뷰글 보충자료|직접 매칭 후보 수|사용 가능한 이미지 슬롯|본문에 사용할 수 있는 후보|본문에 사용할 수 있는 사진 슬롯|작성자 주의|내부자료ID|내부 데이터|내부 API|DrivingPlus|api-dev\.drivingplus\.me|get-all-academy|firebasestorage\.googleapis\.com|storage\.googleapis\.com)/i.test(markdown)) issues.push("exposes_internal_fact_language");
  if (hasRiskyDurationClaim(markdown)) issues.push("risky_duration_or_pass_guarantee_claim");
  if (!hasVerifiedPriceFacts(facts) && hasSpecificMoneyClaim(markdown)) issues.push("unverified_specific_price_claim");
  if (!hasReviewFacts(facts) && hasSpecificReviewClaim(markdown)) issues.push("unverified_review_claim");
  const inflated = inflatedCandidateCountClaim(markdown, candidateCount);
  if (inflated) issues.push(`inflated_candidate_count_${inflated.claimed}_gt_${inflated.actual}`);
  if (candidateNames.length && !candidateNames.some((name) => markdown.includes(name))) issues.push("missing_real_candidate_name");
  const requiredCandidateH3 = Math.min(candidateNames.length, 3);
  const candidateH3Count = candidateHeadingMatchCount(markdown, candidateNames);
  if (requiredCandidateH3 >= 2 && candidateH3Count < requiredCandidateH3) issues.push(`missing_candidate_h3_headings_${candidateH3Count}_lt_${requiredCandidateH3}`);
  if (candidateNames.length >= 2 && !candidateNames.slice(0, 4).some((name) => markdownTableText(markdown).includes(name))) issues.push("table_missing_real_candidate_name");
  if (/긍정 수강생 리뷰 보충자료|긍정 블로그 리뷰글 보충자료/.test(facts) && !/(후기|리뷰|수강생|블로그)/.test(markdown)) issues.push("review_facts_unused");
  if (imageKeys.length && usedImageKeys.length === 0) issues.push("missing_available_image_slot");
  const unknown = usedImageKeys.filter((key) => !imageKeys.includes(key));
  if (unknown.length) issues.push(`unknown_image_slots_${Array.from(new Set(unknown)).join("_")}`);
  return issues;
}

export function postSurfaceQualityIssues(post: Row, minChars = 2600, candidateCount = 0): string[] {
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
  if (!isAnyMarkdownTable(markdown)) issues.push(candidateCount >= 2 ? "missing_comparison_table" : "missing_summary_table");
  if (thinSectionCount(markdown) > 1) issues.push("thin_sections");
  if (!/(^|\n)\s*(?:[-*]\s+|\d+[.)]\s+|✅|✓)/m.test(markdown)) issues.push("missing_checklist_or_list");
  if (/\[(?:TABLE|CTA|FAQ|QUOTE|IMAGE|INTERNAL_LINK)_SLOT:|\[INTERNAL_LINK:/i.test(markdown)) issues.push("contains_pseudo_slot");
  if (/\[\d+\]/.test(markdown)) issues.push("contains_visible_citations");
  if (/(운전선생|검증된 자료|확인된 콘텐츠 재료|작성 범위|소개 가능한 후보 수|API 자료|제공된 자료|후기 필드|긍정 수강생 리뷰 보충자료|긍정 블로그 리뷰글 보충자료|직접 매칭 후보 수|사용 가능한 이미지 슬롯|본문에 사용할 수 있는 후보|본문에 사용할 수 있는 사진 슬롯|작성자 주의|내부자료ID|내부 데이터|내부 API|DrivingPlus|api-dev\.drivingplus\.me|get-all-academy|zipcode\/search-seo|firebasestorage\.googleapis\.com|storage\.googleapis\.com)/i.test(`${title}\n${markdown}`)) issues.push("exposes_internal_fact_language");
  if (hasRiskyDurationClaim(`${title}\n${markdown}`)) issues.push("risky_duration_or_pass_guarantee_claim");
  const inflated = inflatedCandidateCountClaim(`${title}\n${markdown}`, candidateCount);
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
  return issues;
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
  return /긍정 수강생 리뷰 보충자료|긍정 블로그 리뷰글 보충자료/u.test(facts);
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
