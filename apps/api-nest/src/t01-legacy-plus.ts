import { selectEligibleReviewsByAcademy, type AcademyContentReviewCandidate } from "./academy-review-evidence.js";
import { t01QualityIssues, type T01DataGatedContext, type T01QualityIssue } from "./t01-data-gated.js";
import { courseFactText } from "./academy-course-evidence.js";

export const T01_LEGACY_PLUS_MODE = "t01_legacy_plus_v1" as const;

export type T01LegacyPlusContext = {
  mode: typeof T01_LEGACY_PLUS_MODE;
  data: T01DataGatedContext;
  selectedReviews: AcademyContentReviewCandidate[];
};

type LegacyPlusDecisionSupportUnit = {
  section: "faq" | "checklist";
  text: string;
  topic: "location" | "shuttle" | "tuition" | "schedule" | "license" | "internal_test" | "region_relation" | "other";
  intent: "verification" | "selection" | "explanation" | "action" | "other";
  action: "contact_academy" | "compare_candidates" | "check_route" | null;
  answerSummary: string | null;
};

export type LegacyPlusComparisonFocus = "license_course" | "operating_model" | "verified_basics";

export type LegacyPlusComparisonPlan = {
  focus: LegacyPlusComparisonFocus;
  tableFields: string[];
  directive: string;
};

export function isT01LegacyPlusMode(value: unknown): value is typeof T01_LEGACY_PLUS_MODE {
  return value === T01_LEGACY_PLUS_MODE;
}

export function isT01TemplateFamily(templateId: unknown, originTemplateId?: unknown): boolean {
  return String(templateId || "") === "T01" || String(originTemplateId || "") === "T01";
}

export function resolveT01GenerationMode(requestedMode: unknown, templateId: unknown, originTemplateId?: unknown): "legacy" | typeof T01_LEGACY_PLUS_MODE {
  if (requestedMode === "auto") return isT01TemplateFamily(templateId, originTemplateId) ? T01_LEGACY_PLUS_MODE : "legacy";
  return isT01LegacyPlusMode(requestedMode) ? T01_LEGACY_PLUS_MODE : "legacy";
}

export function shouldUseT01LegacyPlusMode(templateId: unknown, generationMode: unknown, originTemplateId?: unknown): boolean {
  return isT01TemplateFamily(templateId, originTemplateId) && isT01LegacyPlusMode(generationMode);
}

export function buildT01LegacyPlusContext(data: T01DataGatedContext, seed: string): T01LegacyPlusContext {
  return { mode: T01_LEGACY_PLUS_MODE, data, selectedReviews: selectEligibleReviewsByAcademy(data.candidates, seed) };
}

/** The reader sees at most 100 characters. The ellipsis is part of that limit. */
export function truncateLegacyPlusReview(text: string, maximumLength = 100): string {
  const chars = Array.from(String(text || "").trim());
  if (chars.length < maximumLength) return chars.join("");
  return `${chars.slice(0, Math.max(0, maximumLength - 1)).join("")}…`;
}

/** Keep Legacy's facts and narrative scaffold, but do not feed candidate-by-
 * candidate review material or blog-review themes into the model. */
export function legacyPlusFactsForPrompt(facts: string): string {
  return String(facts || "")
    .split(/\r?\n/)
    .filter((line) => !/후기 문구 보유 후보/u.test(line))
    .map(legacyPlusPromptFactLine)
    .filter(Boolean)
    .join("\n");
}

/**
 * Present source facts in the order readers use them.  The raw feed places
 * address first and carries SEO neighbourhood aliases in the same sentence;
 * neither should silently become the article's comparison axis.
 */
function legacyPlusPromptFactLine(line: string): string {
  if (!/^\[\d+\]\s+/u.test(line)) return line;
  const parts = String(line).split(" / ").map((part) => part.trim()).filter(Boolean);
  const [identity = "", ...rest] = parts;
  const byLabel = new Map<string, string>();
  for (const part of rest) {
    const match = part.match(/^([^:]+):\s*(.*)$/u);
    if (match) byLabel.set(match[1]!.trim(), match[2]!.trim());
  }
  // buildFacts 가 구조화 필드로 만든 "운영 과정" 을 그대로 쓴다.
  // 그 라벨이 없는 예전 facts 문자열(테스트 픽스처 등)만 SEO 설명 파싱으로 폴백한다.
  const courses = byLabel.get("운영 과정") || courseFactText({ seo_description: byLabel.get("SEO 설명") });
  const keep = [
    courses ? `운영 과정: ${courses}` : "",
    ...["운영 형태", "수강료", "셔틀", "영업시간", "합격률", "주소", "전화", "사진 슬롯"]
      .map((label) => byLabel.get(label) ? `${label}: ${byLabel.get(label)}` : ""),
  ].filter(Boolean);
  return [identity, ...keep].join(" / ");
}

export function legacyPlusComparisonPlan(context: T01LegacyPlusContext): LegacyPlusComparisonPlan {
  const candidates = context.data.candidates;
  const allHaveCourses = candidates.length > 0 && candidates.every((candidate) => candidate.availableLicenses.length > 0);
  const hasTypeDifference = new Set(candidates.map((candidate) => candidate.academyType).filter(Boolean)).size >= 2;
  if (allHaveCourses) {
    return {
      focus: "license_course",
      tableFields: ["실제 지역", "운영 과정", ...(hasTypeDifference ? ["운영 형태"] : [])],
      directive: "확인된 면허 과정은 비교표나 실제 차이가 드러나는 학원 설명에 활용할 수 있다. 다만 도입과 모든 학원 소개를 같은 과정 문장으로 시작하지 말고, 독자의 준비 상황과 자연스럽게 연결될 때만 쓴다. 주소는 기본 정보 불릿에만 둔다.",
    };
  }
  if (hasTypeDifference) {
    return {
      focus: "operating_model",
      tableFields: ["실제 지역", "운영 형태"],
      directive: "면허 과정 정보가 모든 학원에 충분하지 않으므로 운영 형태처럼 실제로 다른 정보만 비교 재료로 쓴다. 모든 문단을 운영 형태 설명으로 채우지 않고, 없는 과정이나 장점을 만들지 않는다. 주소는 기본 정보로만 둔다.",
    };
  }
  return {
    focus: "verified_basics",
    tableFields: ["실제 지역", "운영 형태"],
      directive: "학원 간에 확인된 차이가 많지 않다. 위치를 비교 주제로 키우거나 후보별 설명을 억지로 늘리지 말고, 짧은 객관 정보와 공통 확인 순서로 안내한다. 주소는 학원 식별용 기본 정보로만 둔다.",
  };
}

export function legacyPlusTemplateDirection(context: T01LegacyPlusContext): string {
  return `SEO 제목의 BEST 표기는 유지하되 순위 근거를 만들지 않는다. 기존 Legacy처럼 지역에서 면허를 준비하는 독자의 고민에서 자연스럽게 후보 소개로 이어 간다. ${legacyPlusComparisonPlan(context).directive}`;
}

export function legacyPlusAcademyPrinciples(): string {
  return [
    "- 제공된 후보만 본문·표·사진에 사용하고 후보 수보다 큰 숫자를 만들지 않는다.",
    "- 실제 소재지가 다른 학원은 해당 학원 소개와 표에 실제 지역만 사실대로 적는다. 지역 내/인근 후보군으로 나누거나 거리·이동시간·접근성 우위를 만들지 않는다.",
    "- 주소·전화는 학원을 식별하는 기본 정보다. 소개의 첫 이유·순위·추천 근거·표의 중심 열로 쓰지 않는다.",
  ].join("\n");
}

/** This is intentionally short: the Legacy prompt remains the narrative owner. */
export function t01LegacyPlusPromptContract(context: T01LegacyPlusContext): string {
  const plan = legacyPlusComparisonPlan(context);
  const nonPrimary = context.data.candidates
    .filter((candidate) => candidate.retrievalSource !== "stored_region_like")
    .map((candidate) => `- ${candidate.academyName}: ${candidate.storedRegion || candidate.address || "실제 소재지 확인 필요"}`);
  // Full addresses and phone numbers are identity/contact facts, not a useful
  // comparison axis for someone choosing a licence course.  Keep them
  // available in the legacy facts, but do not nominate them for the table.
  const comparisonFields = plan.tableFields;
  const common = comparisonFields.join(", ") || "운영 형태와 확인된 면허·과정처럼 후보 사이의 실제 차이";
  const review = context.selectedReviews.length
    ? "수강생 리뷰는 생성 뒤 원천 원문과 출처로 학원별 한 건씩 연결된다. 본문을 작성할 때 후기·출처·체험담을 새로 만들거나 요약하지 않는다."
    : "사용 가능한 수강생 리뷰가 제공되지 않았다. 후기·출처·체험담을 만들지 않는다.";
  return [
    "T01 Legacy Plus 보강 지침 (이 지침의 이름이나 내부 작업 방식은 글에 쓰지 않는다):",
    "- 제공된 학원 정보만 사용하고, 확인되지 않은 가격·셔틀·합격률·후기·체험담은 추측하지 않는다.",
    `- 비교표와 학원 설명에 활용할 수 있는 확인 재료: ${common}. ${plan.directive}`,
    "- 글의 중심은 면허 취득 준비자가 자기 상황에 맞는 학원을 비교하는 데 있다. 확인된 면허 과정·운영 형태·자체시험 여부·수강생 리뷰는 실제 차이가 있거나 독자의 선택에 도움이 될 때 쓴다. 주소·전화는 학원별 기본 정보로 한 번씩 명확히 적되, 거리·생활권과 함께 비교축이나 후보의 장점으로 쓰지 않는다.",
    "- 페르소나에 출발지·통학·출퇴근·이동 제약이 명시된 경우에만 생활권·동선을 독자가 확인할 조건으로 제한해 쓸 수 있다. 주소만으로 특정 학원이 가깝다·통학하기 편하다·접근성이 좋다고 결론 내리지 않는다.",
    "- 소개하는 학원은 모두 같은 비교 단위로 다룬다. 실제 소재지가 대상 지역과 다른 학원은 비교표 또는 해당 학원 소개에서 실제 지역만 정확히 적고, `지역 내 후보`·`인근 후보`처럼 별도 후보군이나 섹션으로 나누지 않는다. 전체 주소를 반복하지 않는다. `13.2km`, `약 Nkm` 같은 거리 수치와 직선거리·도로거리·이동시간·통학·접근성·교통 편의 단정은 쓰지 않는다.",
    "- 비교표는 후보 사이에 공통으로 확인된 정보와 실제 지역만 사용한다. 전체 주소·전화번호를 기본 열로 쓰지 않으며, 값이 없는 열은 채우지 말고 뺀다. 각 학원 소개에는 제공된 주소·전화·운영 과정·운영 형태 중 확인된 항목을 2~4개의 짧은 기본 정보 불릿으로 한 번만 정리한다.",
    `- 표에 활용할 수 있는 공통 정보: ${common}`,
    "- 각 학원 소개의 H3 제목은 반드시 학원명만 정확히 쓴다. H3 뒤에는 한두 문장의 자연스러운 소개로 시작하고, 그 학원에서 실제로 차이가 드러나는 사실이 있을 때만 독자의 선택 상황과 연결한다. 모든 소개를 면허 과정·운영 형태·확인 권고의 같은 순서로 시작하지 않는다. 차이를 만들 수 있는 정보가 부족하면 불확실한 장점을 만들지 말고 짧게 소개한다.",
    "- 체크리스트는 짧은 실행 행동으로 쓴다. FAQ는 체크리스트와 같은 문의·확인 행동을 질문형으로 반복하지 말고, 유효한 추가 질문이 없으면 FAQ 제목 자체를 쓰지 않는다.",
    context.selectedReviews.length
      ? "- 수강생 리뷰 원문과 출처는 생성 뒤 원천 데이터로 연결된다. 본문에서 리뷰·후기·출처·체험담을 새로 만들거나 학원 전체 평가·합격률로 일반화하지 않는다."
      : "- 수강생 리뷰 섹션이나 출처 표기를 만들지 않는다.",
    nonPrimary.length ? `실제 소재지가 대상 지역과 다른 학원(별도 후보군으로 나누지 말고 실제 지역만 정확히 표기):\n${nonPrimary.join("\n")}` : "",
    review,
  ].filter(Boolean).join("\n");
}

export function legacyPlusReviewPromptInstruction(context: T01LegacyPlusContext): string {
  return context.selectedReviews.length
    ? "수강생 리뷰는 생성 뒤 원천 데이터에서 학원별 한 건씩 연결된다. 본문에서 후기·리뷰 인용·출처·체험담을 새로 쓰거나 일반화하지 않는다."
    : "사용 가능한 수강생 리뷰가 없으므로 후기·리뷰 인용·출처를 만들지 않는다.";
}

export function legacyPlusFaqPromptInstruction(): string {
  return "FAQ는 선택 사항이다. 체크리스트의 확인 행동을 질문형으로 반복하지 말고, 본문·표·체크리스트에서 해결되지 않은 추가 설명이 있을 때만 짧게 쓴다. 유효한 질문이 없으면 FAQ H2를 생략한다.";
}

/**
 * Legacy Plus deliberately replaces the T01 local archetype's location-first
 * writing guidance. Location remains a factual disclosure, not the reader's
 * primary way of comparing licence schools.
 */
export function legacyPlusStructureGuide(context?: T01LegacyPlusContext): string {
  const plan = context ? legacyPlusComparisonPlan(context) : null;
  return [
    "도입은 지역에서 면허를 준비할 때 생기는 현실적인 고민을 한두 짧은 문단으로 열고 후보 소개로 자연스럽게 이어 간다. 면허 과정·주소·운영 형태 중 하나를 모든 도입의 고정 주제로 삼지 않는다.",
    `${plan?.directive || "후보 사이에 실제로 다른 정보만 비교 재료로 쓴다."} 비교표에는 학원명, ${plan?.tableFields.join("·") || "실제 지역, 확인된 면허 과정·운영 형태·자체시험"}처럼 후보 사이에 공통으로 확인된 차이를 정리한다. 전체 주소·전화번호는 기본 열로 쓰지 않는다.`,
    "각 학원은 H3에 학원명만 정확히 쓰고, 한두 문장의 자연스러운 소개 뒤에 그 학원에서 실제로 차이가 드러나는 사실을 필요한 경우에만 연결한다. 이어서 제공된 주소·전화·운영 과정·운영 형태 중 확인된 항목을 짧은 기본 정보 불릿으로 한 번만 정리한다. 실제 지역이 다른 학원도 별도 후보군으로 나누지 않고 실제 지역만 정확히 표기한다.",
    "체크리스트는 공통 확인 행동만 짧게 정리하고, FAQ는 체크리스트와 다른 추가 질문이 있을 때만 둔다.",
    "마무리에서는 독자가 자신의 면허 과정과 확인 순서를 정할 수 있게 돕는다.",
  ].join("\n");
}

export function legacyPlusWritingGuide(context?: T01LegacyPlusContext): string {
  const plan = context ? legacyPlusComparisonPlan(context) : null;
  return [
    plan?.directive || "후보가 여럿이면 학원별 확인된 면허 과정, 운영 형태, 자체시험 여부, 실제 수강생 리뷰 중 차이가 드러나는 재료만 자연스럽게 비교한다.",
    "후보별 첫 문장과 문단 구조를 기계적으로 같게 맞추지 않는다. 확인된 사실을 독자의 선택 상황에 연결하되, 과정·운영 형태·리뷰가 없는 경우에는 짧은 사실 소개만 남긴다.",
    "실제 소재지는 오표현을 막는 보조 사실로만 쓴다. 페르소나가 이동 조건을 명시할 때만 생활권·동선을 확인할 조건으로 다루되, 주소만으로 통학·가까움·접근성을 판단하지 않는다.",
    "가격·시간표·셔틀처럼 변동 가능하거나 자료가 없는 항목은 사실처럼 단정하지 말고 필요한 경우 공통 체크리스트에서 한 번만 확인 행동으로 안내한다.",
  ].join("\n");
}

export function legacyPlusArticlePatternGuide(context?: T01LegacyPlusContext): string {
  const plan = context ? legacyPlusComparisonPlan(context) : null;
  return `독자의 면허 준비 질문에서 시작해 ${plan?.focus === "verified_basics" ? "짧은 객관 정보" : "학원별 확인된 차이와 객관 정보"}를 자연스러운 서술로 보여준 뒤 선택에 필요한 확인 순서로 마무리한다. 표·기본 정보·체크리스트가 본문을 다시 설명하지 않게 하고, 생활권·동선은 페르소나가 이동 조건을 명시한 경우에만 보조 질문으로 쓴다.`;
}

export function legacyPlusDesignGuide(): string {
  return "비교·선택을 돕는 정보형 톤을 사용한다. 위치·생활권·동선은 페르소나가 이동 조건을 제시할 때만 확인 조건으로 다루며, 주소만으로 후보의 장점으로 판단하지 않는다.";
}

export function dedupeLegacyPlusDecisionSupport(markdown: string): string {
  const lines = String(markdown || "").split(/\r?\n/);
  const checklist = sectionRange(lines, /체크리스트/u);
  const keptChecklist: LegacyPlusDecisionSupportUnit[] = [];
  if (checklist) {
    for (let index = checklist.start; index < checklist.end; index++) {
      const text = checklistItem(lines[index] || "");
      if (!text) continue;
      const unit = decisionUnit("checklist", text);
      if (keptChecklist.some((item) => sameDecision(item, unit))) lines[index] = "";
      else keptChecklist.push(unit);
    }
  }
  const faq = sectionRange(lines, /(?:FAQ|자주\s*(?:묻는|생기는|추가)\s*(?:질문|FAQ))/iu);
  if (faq) {
    const keptFaq: LegacyPlusDecisionSupportUnit[] = [];
    for (const block of faqBlocks(lines, faq)) {
      const unit = decisionUnit("faq", block.text);
      const duplicate = keptChecklist.some((item) => sameFaqChecklistDecision(item, unit))
        || keptFaq.some((item) => sameDecision(item, unit));
      if (duplicate) {
        for (let index = block.start; index < block.end; index++) lines[index] = "";
      } else {
        keptFaq.push(unit);
      }
    }
    if (!keptFaq.length) for (let index = faq.heading; index < faq.end; index++) lines[index] = "";
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Deterministic presentation cleanup only: it never invents review text or
 * source data. It removes extraction-only distance statements, adds a short
 * actual-region disclosure where the selected candidate is outside the target
 * region, and appends each eligible academy's exact source review once.
 * Academies with no eligible source review deliberately receive no block.
 */
export function finalizeLegacyPlusMarkdown(markdown: string, context: T01LegacyPlusContext): string {
  const attributed = stripLegacyPlusClicheAudienceAddress(String(markdown || "")).split(/\r?\n/).map((line) => {
    if (!/^>\s*/.test(line) || /출처:\s*DrivingPlus 수강생 리뷰/u.test(line)) return line;
    const matchesReview = context.selectedReviews.some((review) => normalized(line).includes(normalized(truncateLegacyPlusReview(review.text))));
    return matchesReview && line.includes("DrivingPlus 수강생 리뷰")
      ? line.replace("DrivingPlus 수강생 리뷰", "출처: DrivingPlus 수강생 리뷰")
      : line;
  }).filter((line) => !/(?:\d+(?:\.\d+)?\s*km|직선\s*거리|도로\s*거리|지역\s*중심\s*기준\s*거리)/iu.test(line)).join("\n");
  return removeRepeatedNarrativeSentences(
    dedupeLegacyPlusDecisionSupport(
      dedupeCandidateHeadings(appendLockedCandidateBlocks(attributed, context), context.data),
    ),
  );
}

/**
 * A source review is evidence, not model-authored blog prose. Keep the global
 * cliche gate strict for generated text, but do not reject a Legacy Plus
 * article solely because an exact, locked source-review quote contains one of
 * those phrases. A generated line, an altered quote, or a phrase outside a
 * quote remains a normal blocking issue.
 */
export function isLockedLegacyPlusReviewOnlyClicheIssue(issue: string, markdown: string, context: T01LegacyPlusContext): boolean {
  const prefix = "ai_cliche_expressions_";
  if (!issue.startsWith(prefix)) return false;
  const phrases = issue.slice(prefix.length).split("·").map((phrase) => phrase.trim()).filter(Boolean);
  if (!phrases.length) return false;
  const reviewLines = String(markdown || "").split(/\r?\n/).filter((line) => /^>\s*/.test(line));
  const isExactLockedReviewLine = (line: string) => context.selectedReviews.some((review) => normalized(line).includes(normalized(truncateLegacyPlusReview(review.text))));
  return phrases.every((phrase) => {
    const occurrences = String(markdown || "").split(/\r?\n/).filter((line) => line.includes(phrase));
    return occurrences.length > 0 && occurrences.every((line) => reviewLines.includes(line) && isExactLockedReviewLine(line));
  });
}

/**
 * The general surface gate rejects the stock address "여러분".  The prompt
 * and repair prompt already prohibit it, but this is a purely presentational
 * fallback for Legacy Plus drafts: it only rewrites model-authored prose
 * before locked source-review blocks are appended below.  It never changes a
 * source review or any academy fact.
 */
function stripLegacyPlusClicheAudienceAddress(markdown: string): string {
  return String(markdown || "").split(/\r?\n/).map((line) => {
    if (/^>\s*/.test(line)) return line;
    return line.replace(/여러분(은|이|의|을|를|에게|께|도|과|와)?(?=[\s,.!?]|$)/gu, (_match, particle = "") => `운전면허를 준비하는 분${particle}`);
  }).join("\n");
}

export function t01LegacyPlusQualityIssues(markdown: string, context: T01LegacyPlusContext): T01QualityIssue[] {
  const factual = t01QualityIssues(markdown, context.data)
    // Legacy Plus keeps the actual-region fact but deliberately does not use
    // the retired v2 "expanded candidate" narrative as article structure.
    // `actualRegionIssues` below keeps the substantive location disclosure;
    // the v2-only warning must not demand words that Legacy Plus forbids.
    .filter((item) => !["faq_variant_not_rendered", "non_primary_candidate_region_disclosure_missing", "distance_expansion_not_explained"].includes(item.code));
  return [...factual, ...candidateHeadingIssues(markdown, context.data), ...basicInfoIssues(markdown, context.data), ...actualRegionIssues(markdown, context.data), ...reviewIssues(markdown, context.selectedReviews), ...decisionSupportIssues(markdown), ...locationCompositionIssues(markdown), ...emptyHeadingIssues(markdown)];
}

function appendLockedCandidateBlocks(markdown: string, context: T01LegacyPlusContext): string {
  const lines = String(markdown || "").split(/\r?\n/);
  const reviewByAcademyId = new Map(context.selectedReviews.map((review) => [review.academyId, review]));
  for (const candidate of [...context.data.candidates].reverse()) {
    const headingIndex = lines.findIndex((line) => candidateHeadingMatches(line, candidate.academyName));
    if (headingIndex < 0) continue;
    let sectionEnd = lines.length;
    for (let index = headingIndex + 1; index < lines.length; index++) {
      if (/^#{2,3}\s+/.test(lines[index] || "")) { sectionEnd = index; break; }
    }
    const section = lines.slice(headingIndex, sectionEnd).join("\n");
    const additions: string[] = [];
    const basicInfo = legacyPlusBasicInfoLines(candidate, section);
    if (basicInfo.length) additions.push(...basicInfo);
    if (candidate.retrievalSource !== "stored_region_like") {
      const actualRegion = candidate.storedRegion || candidate.address;
      if (actualRegion && !section.includes(actualRegion)) additions.push(`실제 소재지는 ${actualRegion}입니다.`);
    }
    const review = reviewByAcademyId.get(candidate.academyId);
    if (review) {
      const expected = normalized(truncateLegacyPlusReview(review.text));
      const hasExpectedQuote = lines.some((line) => /^>\s*/.test(line) && normalized(line).includes(expected));
      if (!hasExpectedQuote) additions.push(`> ${truncateLegacyPlusReview(review.text)} — 출처: ${review.source.label}`);
    }
    if (additions.length) lines.splice(sectionEnd, 0, "", ...additions, "");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Addresses and contact details are factual scan information, not narrative
 * comparison axes. Keep each available item once in a short list. */
function legacyPlusBasicInfoLines(candidate: T01DataGatedContext["candidates"][number], section: string): string[] {
  const facts: Array<[string, string | null]> = [
    ["주소", candidate.address],
    ["전화", candidate.phone],
    ["운영 형태", displayAcademyType(candidate.academyType)],
  ];
  const lines = facts.flatMap(([label, value]) => value && !hasBasicInfoLabel(section, label)
    ? [`- **${label}:** ${value}`]
    : []);
  return lines.length ? ["", ...lines] : [];
}

function hasBasicInfoLabel(section: string, label: string): boolean {
  return new RegExp(`^\\s*[-*]\\s+\\*\\*${label}:?\\*\\*`, "mu").test(section);
}

function displayAcademyType(value: string | null): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return ({ academy: "운전학원", exam_academy: "자동차운전전문학원", test_center: "운전면허시험장" } as Record<string, string>)[raw] || raw.replace(/_/g, " ");
}

/** A substring is not identity: "양동상무자동차운전전문학원" must not
 * receive locked facts for "상무자동차운전전문학원". */
function candidateHeadingMatches(line: string, academyName: string): boolean {
  if (!/^###\s+/.test(line)) return false;
  return normalized(line.replace(/^###\s+/, "")) === normalized(academyName);
}

function candidateHeadingIssues(markdown: string, data: T01DataGatedContext): T01QualityIssue[] {
  const lines = String(markdown || "").split(/\r?\n/);
  return data.candidates.flatMap((candidate) => candidateHeadingMatchesAny(lines, candidate.academyName)
    ? []
    : [issue("legacy_plus_candidate_heading_missing", "hard_failure", `${candidate.academyName}의 독립 H3 제목이 없음`)]);
}

function candidateHeadingMatchesAny(lines: string[], academyName: string): boolean {
  return lines.some((line) => candidateHeadingMatches(line, academyName));
}

function basicInfoIssues(markdown: string, data: T01DataGatedContext): T01QualityIssue[] {
  const lines = String(markdown || "").split(/\r?\n/);
  return data.candidates.flatMap((candidate) => {
    if (!candidate.address) return [];
    const headingIndex = lines.findIndex((line) => candidateHeadingMatches(line, candidate.academyName));
    if (headingIndex < 0) return [];
    const sectionEnd = lines.findIndex((line, index) => index > headingIndex && /^#{2,3}\s+/.test(line));
    const section = lines.slice(headingIndex, sectionEnd < 0 ? lines.length : sectionEnd).join("\n");
    return hasBasicInfoLabel(section, "주소")
      ? []
      : [issue("legacy_plus_basic_address_missing", "hard_failure", `${candidate.academyName}의 주소 기본 정보 불릿이 없음`)];
  });
}

function actualRegionIssues(markdown: string, data: T01DataGatedContext): T01QualityIssue[] {
  return data.candidates.flatMap((candidate) => {
    if (candidate.retrievalSource === "stored_region_like") return [];
    const actualLocationMentioned = [candidate.storedRegion, candidate.address]
      .filter(Boolean)
      .some((value) => markdown.includes(String(value)));
    return actualLocationMentioned
      ? []
      : [issue("legacy_plus_actual_region_missing", "hard_failure", `${candidate.academyName}의 실제 소재지 고지가 없음`)];
  });
}

function dedupeCandidateHeadings(markdown: string, data: T01DataGatedContext): string {
  const lines = String(markdown || "").split(/\r?\n/);
  for (const candidate of data.candidates) {
    const duplicateIndexes = lines.flatMap((line, index) => candidateHeadingMatches(line, candidate.academyName) ? [index] : []);
    for (const index of duplicateIndexes.slice(1)) lines[index] = "";
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Remove only an exact repeated prose sentence; facts in headings, tables,
 * lists, and review quotes are deliberately left untouched. */
function removeRepeatedNarrativeSentences(markdown: string): string {
  const seen = new Set<string>();
  return String(markdown || "").split(/\r?\n/).map((line) => {
    if (!line.trim() || /^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|\||>\s)/.test(line)) return line;
    const sentences = line.split(/(?<=[.!?。…])\s+/).filter(Boolean);
    const kept = sentences.filter((sentence) => {
      const normalizedSentence = sentence.replace(/\s+/g, " ").trim();
      if (normalizedSentence.length < 16 || !seen.has(normalizedSentence)) {
        if (normalizedSentence.length >= 16) seen.add(normalizedSentence);
        return true;
      }
      return false;
    });
    return kept.join(" ");
  }).filter((line, index, lines) => line.trim() || (index > 0 && lines[index - 1]?.trim())).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Location evidence is necessary for factual disclosure, but it must not
 * become the article's primary grouping.  These checks are scoped to Legacy
 * Plus; legacy, v2, hybrid, and non-T01 output keep their current contract.
 */
function locationCompositionIssues(markdown: string): T01QualityIssue[] {
  const headings = Array.from(String(markdown || "").matchAll(/^##\s+(.+)$/gmu)).map((match) => match[1] || "");
  if (headings.some((heading) => /(?:인근|주변)\s*(?:후보|학원)|(?:지역|시|군|구)\s*(?:안|내)[^\n]{0,20}(?:후보|학원)/u.test(heading))) {
    return [issue("legacy_plus_location_first_grouping", "hard_failure", "학원을 실제 지역 안팎의 별도 후보군으로 나눈 H2가 비교의 중심이 됨")];
  }
  return [];
}

function reviewIssues(markdown: string, reviews: AcademyContentReviewCandidate[]): T01QualityIssue[] {
  const lines = String(markdown || "").split(/\r?\n/);
  const markers = lines.filter((line) => /^>\s*/.test(line) || /출처:\s*DrivingPlus 수강생 리뷰/u.test(line));
  if (!reviews.length) return markers.some((line) => /수강생\s*(?:리뷰|후기)|출처:/u.test(line))
    ? [issue("legacy_plus_unverified_review_claim", "hard_failure", "선택된 원천 리뷰가 없는데 리뷰 또는 출처를 노출함")]
    : [];
  const issues: T01QualityIssue[] = [];
  const expectedQuotes = reviews.map((review) => normalized(truncateLegacyPlusReview(review.text)));
  for (const review of reviews) {
    const expected = normalized(truncateLegacyPlusReview(review.text));
    const quoteIndexes = lines.flatMap((line, index) => normalized(line).includes(expected) ? [index] : []);
    const sourceIndexes = lines.flatMap((line, index) => line.includes(`출처: ${review.source.label}`) ? [index] : []);
    if (quoteIndexes.length !== 1) issues.push(issue("legacy_plus_review_count", "hard_failure", `${review.academyName} 리뷰 인용은 1개여야 하나 ${quoteIndexes.length}개임`));
    const quoteIndex = quoteIndexes[0] ?? -1;
    if (quoteIndex >= 0 && !sourceIndexes.some((index) => index >= quoteIndex && index <= quoteIndex + 3)) issues.push(issue("legacy_plus_review_source_missing", "hard_failure", `${review.academyName} 리뷰 출처가 없거나 인접하지 않음`));
    const heading = quoteIndex >= 0 ? previousCandidateHeading(lines, quoteIndex) : "";
    if (heading && normalized(heading) !== normalized(review.academyName)) issues.push(issue("legacy_plus_review_wrong_academy", "hard_failure", `${review.academyName} 리뷰가 연결 학원 설명 직후에 있지 않음`));
    const windowLines = quoteIndex >= 0 ? lines.slice(Math.max(0, quoteIndex - 1), quoteIndex + 5) : markers;
    const window = windowLines.join("\n");
    if (/(?:작성자|작성일|닉네임|별점|평점|review[_\s-]?id|리뷰\s*ID)/iu.test(window)) issues.push(issue("legacy_plus_review_metadata_exposed", "hard_failure", "리뷰 metadata를 노출함"));
    // The supplied source quote is an individual experience, not editorial
    // generalization. Only surrounding article prose can turn it into an
    // academy-wide or pass-rate claim.
    if (reviewIsGeneralized(windowLines.filter((line) => !/^>\s*/.test(line)).join("\n"))) {
      issues.push(issue("legacy_plus_review_generalized", "hard_failure", "개별 리뷰를 전체 평가 또는 합격률로 일반화함"));
    }
  }
  const quoteCount = lines.filter((line) => /^>\s*/.test(line)).length;
  const sourceCount = lines.filter((line) => /출처:\s*DrivingPlus 수강생 리뷰/u.test(line)).length;
  if (quoteCount !== reviews.length || sourceCount !== reviews.length || expectedQuotes.length !== new Set(expectedQuotes).size) {
    issues.push(issue("legacy_plus_review_count", "hard_failure", `학원별 리뷰·출처는 각각 ${reviews.length}개여야 함`));
  }
  return issues;
}

function decisionSupportIssues(markdown: string): T01QualityIssue[] {
  const parsed = parseDecisionSupport(markdown);
  const issues: T01QualityIssue[] = [];
  if (parsed.hasChecklist && !parsed.checklist.length) issues.push(issue("legacy_plus_empty_checklist", "hard_failure", "체크리스트 제목만 있고 항목이 없음"));
  if (parsed.hasFaq && !parsed.faq.length) issues.push(issue("legacy_plus_empty_faq", "hard_failure", "FAQ 제목만 있고 문답이 없음"));
  if (parsed.faq.some((faq) => parsed.checklist.some((item) => sameDecision(item, faq)))) issues.push(issue("legacy_plus_faq_checklist_semantic_overlap", "warning", "FAQ와 체크리스트가 같은 확인 행동을 반복함"));
  if (hasDuplicates(parsed.faq)) issues.push(issue("legacy_plus_faq_semantic_overlap", "warning", "FAQ끼리 의미상 중복됨"));
  if (hasDuplicates(parsed.checklist)) issues.push(issue("legacy_plus_checklist_semantic_overlap", "warning", "체크리스트 행동이 중복됨"));
  return issues;
}

function emptyHeadingIssues(markdown: string): T01QualityIssue[] {
  const lines = String(markdown || "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    if (!/^#{2,3}\s+/.test(lines[index] || "")) continue;
    let next = index + 1;
    while (next < lines.length && !lines[next]!.trim()) next++;
    if (next >= lines.length || /^#{1,3}\s+/.test(lines[next] || "")) return [issue("legacy_plus_empty_heading", "hard_failure", "내용 없는 H2/H3가 있음")];
  }
  return [];
}

function parseDecisionSupport(markdown: string): { checklist: LegacyPlusDecisionSupportUnit[]; faq: LegacyPlusDecisionSupportUnit[]; hasChecklist: boolean; hasFaq: boolean } {
  const lines = String(markdown || "").split(/\r?\n/);
  const checklistRange = sectionRange(lines, /체크리스트/u);
  const faqRange = sectionRange(lines, /(?:FAQ|자주\s*(?:묻는|생기는|추가)\s*(?:질문|FAQ))/iu);
  return {
    checklist: checklistRange ? lines.slice(checklistRange.start, checklistRange.end).map(checklistItem).filter(Boolean).map((text) => decisionUnit("checklist", text)) : [],
    faq: faqRange ? faqBlocks(lines, faqRange).map((block) => decisionUnit("faq", block.text)) : [],
    hasChecklist: Boolean(checklistRange), hasFaq: Boolean(faqRange),
  };
}

function sectionRange(lines: string[], pattern: RegExp): { heading: number; start: number; end: number } | null {
  const heading = lines.findIndex((line) => /^#{2,3}\s+/.test(line) && pattern.test(line.replace(/^#{2,3}\s+/, "")));
  if (heading < 0) return null;
  const level = lines[heading]!.match(/^#+/)?.[0].length || 2;
  let end = lines.length;
  for (let index = heading + 1; index < lines.length; index++) {
    const other = lines[index]!.match(/^#+/)?.[0].length;
    if (other && other <= level) { end = index; break; }
  }
  return { heading, start: heading + 1, end };
}

function faqBlocks(lines: string[], range: { heading: number; start: number; end: number }): Array<{ start: number; end: number; text: string }> {
  const headings = Array.from({ length: range.end - range.start }, (_, offset) => range.start + offset)
    .filter((index) => /^###\s+/.test(lines[index] || ""));
  return headings.map((start, index) => {
    const end = headings[index + 1] ?? range.end;
    const text = lines.slice(start, end).join("\n").replace(/^###\s+/m, "").trim();
    return { start, end, text };
  });
}

function checklistItem(line: string): string {
  return String(line || "").replace(/^\s*(?:[-*]|\d+[.)]|[✅☑✔])\s*/, "").trim();
}

function decisionUnit(section: "faq" | "checklist", text: string): LegacyPlusDecisionSupportUnit {
  const clean = String(text).replace(/[*_`]/g, "").trim();
  const topic = /셔틀/u.test(clean) ? "shuttle" : /수강료|비용|가격/u.test(clean) ? "tuition" : /시간|일정|주말|야간|수업/u.test(clean) ? "schedule" : /면허|과정/u.test(clean) ? "license" : /자체\s*시험/u.test(clean) ? "internal_test" : /주변|인근|다른\s*지역|포함\s*이유/u.test(clean) ? "region_relation" : /주소|소재지|위치/u.test(clean) ? "location" : "other";
  const intent = /왜|이유|어떤\s*기준|어떻게\s*해석/u.test(clean) ? "explanation" : /확인|문의|물어|상담/u.test(clean) ? "verification" : /비교|선택|어떤\s*학원/u.test(clean) ? "selection" : /[?？]$/u.test(clean) ? "verification" : "other";
  const action = /문의|상담|학원에|전화/u.test(clean) || (intent === "verification" && ["shuttle", "tuition", "schedule", "license", "internal_test"].includes(topic)) ? "contact_academy" : /경로|이동|출발/u.test(clean) ? "check_route" : /비교/u.test(clean) ? "compare_candidates" : null;
  return { section, text: clean, topic, intent, action, answerSummary: section === "faq" ? normalized(clean) : null };
}

function sameDecision(left: LegacyPlusDecisionSupportUnit, right: LegacyPlusDecisionSupportUnit): boolean {
  return normalized(left.text) === normalized(right.text) || (left.topic === right.topic && left.topic !== "other" && left.intent === right.intent && left.action === right.action);
}

function sameFaqChecklistDecision(checklist: LegacyPlusDecisionSupportUnit, faq: LegacyPlusDecisionSupportUnit): boolean {
  if (sameDecision(checklist, faq)) return true;
  return checklist.topic === faq.topic
    && checklist.topic !== "other"
    && faq.intent === "verification"
    && ["verification", "other"].includes(checklist.intent);
}

function hasDuplicates(items: LegacyPlusDecisionSupportUnit[]): boolean {
  return items.some((item, index) => items.slice(index + 1).some((other) => sameDecision(item, other)));
}

function previousCandidateHeading(lines: string[], index: number): string {
  for (let cursor = index - 1; cursor >= 0; cursor--) if (/^###\s+/.test(lines[cursor] || "")) return lines[cursor]!.replace(/^###\s+/, "");
  return "";
}

function reviewIsGeneralized(value: string): boolean {
  return String(value || "").split(/(?<=[.!?。…])\s+/).some((sentence) => {
    // The review rule is not a second pass-rate rule.  A nearby independent
    // sentence about pass-rate must be handled by the claim-context gate,
    // not treated as a review generalization merely because it follows a
    // source quote.
    if (!/(?:리뷰|후기|경험)/u.test(sentence)) return false;
    if (!/(?:전체\s*수강생|대부분\s*수강생|합격률)/u.test(sentence)) return false;
    return !/(?:전체\s*수강생|대부분\s*수강생).{0,30}(?:일반화할\s*수\s*(?:는)?\s*없|일반화하지\s*않)|(?:일반화할\s*수\s*(?:는)?\s*없|일반화하지\s*않).{0,30}(?:전체\s*수강생|대부분\s*수강생)|합격률.{0,25}(?:단정(?:할\s*수)?\s*없|확인(?:할\s*수)?\s*없|제공(?:되지)?\s*않)/u.test(sentence);
  });
}

function normalized(value: string): string { return String(value || "").replace(/[^0-9A-Za-z가-힣]/gu, "").toLowerCase(); }
function issue(code: string, severity: T01QualityIssue["severity"], message: string): T01QualityIssue { return { code, severity, message }; }
