import type { AcademySelectionTrace, AcademySelectionTraceCandidate, CandidateRetrievalSource } from "./academy-candidate-selection.js";
import { selectedStudentReviewForAcademy } from "./academy-review-evidence.js";
import { availableLicensesFromSource } from "./academy-course-evidence.js";

type Row = Record<string, any>;

/** Internal typed evidence context used by Legacy Plus validation. */
export const T01_FACT_VALIDATION_CONTEXT = "t01_legacy_plus_internal" as const;
export type T01RegionRelation = "target_region" | "same_parent_region" | "other_region" | "unknown";
export type T01VariantId = "region_like_comparison" | "distance_expanded_comparison" | "criteria_first_grouped_comparison" | "insufficient_comparison";
export type T01ModifierCategory = "composition" | "evidence" | "audience";

export type T01AcademyCandidate = {
  academyId: string;
  academyName: string;
  academyType: string | null;
  availableLicenses: string[];
  storedRegion: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  straightLineDistanceKm: number | null;
  retrievalSource: CandidateRetrievalSource;
  inclusionReason: AcademySelectionTraceCandidate["inclusionReason"];
  retrievalRank: number;
  regionRelation: T01RegionRelation;
  tuition: string | null;
  shuttle: string | null;
  operatingSchedule: string | null;
  passRate: string | null;
  phone: string | null;
  reviewEvidencePresent: boolean;
  studentReviews: Array<{ quote: string; source: "운전면허PLUS 실제 수강생 리뷰" }>;
  missingFields: string[];
};

export type T01TypedModifier = {
  id: string;
  originalLabel: string;
  category: T01ModifierCategory;
  compatibleVariants: T01VariantId[];
  active: boolean;
  inactiveReason?: string;
  promptDirectives: string[];
  outputConstraints: string[];
};

export type T01DataGatedContext = {
  mode: typeof T01_FACT_VALIDATION_CONTEXT;
  targetRegion: string;
  selection: Pick<AcademySelectionTrace, "configuredMinimum" | "candidatePoolLimit" | "nearbyRadiusKm" | "farRadiusKm"> & {
    regionLikeCount: number;
    supplementCount: number;
    farCount: number;
    finalBodyCount: number;
  };
  candidates: T01AcademyCandidate[];
  selectedVariant: T01VariantId;
  compatibleVariants: T01VariantId[];
  commonFactFields: string[];
  modifiers: T01TypedModifier[];
  includeFaq: boolean;
};

export type T01QualityIssue = {
  code: string;
  severity: "hard_failure" | "warning" | "score_penalty";
  message: string;
};

export type T01ClaimTopic = "shuttle" | "pass_rate";
export type T01ClaimPolarity = "positive" | "negative" | "uncertain" | "neutral";
export type T01ClaimEpistemicStatus = "asserted" | "unverified" | "verification_required" | "speculative" | "denied";
export type T01ClaimType = "factual_assertion" | "verification_advice" | "absence_of_information" | "general_guidance" | "speculative_statement";
export type T01ClaimContext = {
  topic: T01ClaimTopic;
  sentence: string;
  polarity: T01ClaimPolarity;
  epistemicStatus: T01ClaimEpistemicStatus;
  claimType: T01ClaimType;
  isFactualAssertion: boolean;
};

const FIELD_LABELS: Array<[keyof Pick<T01AcademyCandidate, "address" | "tuition" | "shuttle" | "operatingSchedule" | "passRate" | "phone">, string]> = [
  ["address", "주소"], ["tuition", "수강료"], ["shuttle", "셔틀"], ["operatingSchedule", "운영시간"], ["passRate", "합격률"], ["phone", "전화"],
];

export function buildT01DataGatedContext(targetRegion: string, candidates: Row[], trace: AcademySelectionTrace, seed: string, labels: Array<string | null | undefined>): T01DataGatedContext {
  const traceById = new Map(trace.mergedCandidatePool.map((candidate) => [candidate.academyId, candidate]));
  const normalized = candidates.map((candidate, index) => normalizeCandidate(candidate, traceById.get(candidateKey(candidate)), targetRegion, index + 1, seed));
  const commonFactFields = commonFields(normalized);
  const { selectedVariant, compatibleVariants } = selectT01Variant(normalized, commonFactFields, seed);
  const modifiers = resolveT01Modifiers(labels, normalized, selectedVariant);
  return {
    mode: T01_FACT_VALIDATION_CONTEXT,
    targetRegion,
    selection: {
      configuredMinimum: trace.configuredMinimum,
      candidatePoolLimit: trace.candidatePoolLimit,
      nearbyRadiusKm: trace.nearbyRadiusKm,
      farRadiusKm: trace.farRadiusKm,
      regionLikeCount: trace.regionLikeCandidates.length,
      supplementCount: trace.supplementCandidates.length,
      farCount: trace.farCandidates.length,
      finalBodyCount: normalized.length,
    },
    candidates: normalized,
    selectedVariant,
    compatibleVariants,
    commonFactFields,
    modifiers,
    includeFaq: shouldIncludeT01Faq(seed),
  };
}

export function t01QualityIssues(markdown: string, context: T01DataGatedContext): T01QualityIssue[] {
  const issues: T01QualityIssue[] = [];
  const tableText = markdown.split(/\r?\n/).filter((line) => line.includes("|")).join("\n");
  if (context.candidates.length >= 2) {
    const missingFromTable = context.candidates.filter((candidate) => !tableText.includes(candidate.academyName));
    if (missingFromTable.length) issues.push(issue("comparison_table_missing_candidates", "hard_failure", `비교표에 후보 누락: ${missingFromTable.map((candidate) => candidate.academyName).join(", ")}`));
  }
  for (const candidate of context.candidates) {
    // Candidate identity must use the whole H3 text. A substring comparison
    // treats "양동상무자동차운전전문학원" as a second heading for
    // "상무자동차운전전문학원".
    const h3Matches = Array.from(markdown.matchAll(/^###\s+(.+)$/gm)).filter((match) => normalizeHeadingText(match[1]) === normalizeHeadingText(candidate.academyName));
    if (h3Matches.length > 1) issues.push(issue("duplicate_candidate_heading", "hard_failure", `${candidate.academyName} 후보 H3가 중복됨`));
    if (candidate.retrievalSource !== "stored_region_like") {
      const actualLocationMentioned = [candidate.storedRegion, candidate.address].filter(Boolean).some((value) => markdown.includes(String(value)));
      const expansionDisclosure = /(주변|인근|확장 후보|다른 지역|거리 기준|가장 가까운 후보)/.test(markdown);
      if (!actualLocationMentioned || !expansionDisclosure) issues.push(issue("non_primary_candidate_region_disclosure_missing", "hard_failure", `${candidate.academyName}의 실제 지역 또는 확장 후보 고지가 부족함`));
    }
    if (candidate.straightLineDistanceKm !== null) {
      const distance = String(candidate.straightLineDistanceKm);
      const distanceSentence = markdown.split(/(?<=[.!?。…])\s+|\n+/).filter((sentence) => sentence.includes(distance) && /km/i.test(sentence));
      if (distanceSentence.some((sentence) => /(이동시간|도로\s*거리|대중교통|차로\s*.*분|분\s*거리)/.test(sentence))) issues.push(issue("straight_line_distance_misrepresented", "hard_failure", `${candidate.academyName}의 직선거리를 이동 근거로 표현함`));
    }
  }
  const allTuition = context.candidates.map((candidate) => candidate.tuition || "").join(" ");
  if (/\b\d+(?:\.\d+)?\s*km\b/i.test(markdown)) issues.push(issue("distance_km_exposed", "hard_failure", "후보 추출용 거리 수치를 본문에 노출함"));
  if (!allTuition && hasSpecificMoney(markdown)) issues.push(issue("unverified_tuition_claim", "hard_failure", "입력 tuition이 없는데 구체 금액을 사용함"));
  const tableTuitionValues = tableText.split(/\r?\n/)
    .filter((line) => line.includes("수강료"))
    .flatMap((line) => normalizedMoneyValues(line));
  const factTuitionValues = context.candidates.flatMap((candidate) => normalizedMoneyValues(candidate.tuition || ""));
  if (tableTuitionValues.some((value) => !factTuitionValues.includes(value))) {
    issues.push(issue("comparison_table_tuition_mismatch", "hard_failure", "비교표 수강료가 typed facts와 일치하지 않음"));
  }
  addUnverifiedClaimIssues(issues, markdown, "shuttle", context.candidates.some((candidate) => Boolean(candidate.shuttle)), context.candidates);
  addUnverifiedClaimIssues(issues, markdown, "pass_rate", context.candidates.some((candidate) => Boolean(candidate.passRate)), context.candidates);
  if (!context.candidates.some((candidate) => candidate.reviewEvidencePresent) && /(실제\s*수강생|수강생\s*후기|리뷰에서는|후기에서는)/.test(markdown)) issues.push(issue("unverified_review_claim", "hard_failure", "입력 후기 근거가 없는데 후기를 단정함"));
  if (context.selectedVariant === "distance_expanded_comparison" && !/(주변|인근|확장 후보|거리 기준|가장 가까운 후보)/.test(markdown)) issues.push(issue("distance_expansion_not_explained", "warning", "거리/보충 후보 포함 이유 설명이 약함"));
  const questions = (markdown.match(/\?/g) || []).length;
  if (questions > 6) issues.push(issue("excessive_questions", "warning", `질문형 문장 ${questions}개`));
  if ((markdown.match(/상담 때 확인/g) || []).length > 3) {
    issues.push(issue("repeated_consultation_phrase", "score_penalty", "상담 확인 전환 문구가 반복됨"));
  }
  if ((markdown.match(/^##\s+/gm) || []).length > 6) {
    issues.push(issue("heading_density", "score_penalty", "H2가 6개를 초과해 문단 리듬이 과도하게 분절됨"));
  }
  if (context.includeFaq && !/^##\s+.*(?:FAQ|자주 묻는 질문)/mi.test(markdown)) {
    issues.push(issue("faq_variant_not_rendered", "hard_failure", "FAQ 포함 회전인데 자주 묻는 질문 섹션이 없음"));
  }
  return issues;
}

function normalizeHeadingText(value: unknown): string {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[\[\]()*_`~:：.]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Shared T01 factual-claim classifier. It keeps the legacy/non-T01 article
 * gate contract untouched while distinguishing factual claims from safe
 * "check with the academy" guidance.
 */
export function t01ClaimContexts(markdown: string, topic: T01ClaimTopic): T01ClaimContext[] {
  return claimSentences(markdown, topic).map((sentence) => classifyClaimContext(topic, sentence));
}

function addUnverifiedClaimIssues(issues: T01QualityIssue[], markdown: string, topic: T01ClaimTopic, hasSupportingFact: boolean, candidates: T01AcademyCandidate[]): void {
  if (hasSupportingFact) return;
  // A verbatim, cited student review can describe a past shuttle or passing
  // experience. It is evidence of that review, not an assertion that the
  // academy currently offers the service or outcome. Only exempt exact
  // supplied quotes; a made-up quote with a source marker still fails.
  const claims = t01ClaimContexts(markdown, topic).filter((claim) => !isProvidedStudentReviewQuote(claim.sentence, candidates));
  if (claims.some((claim) => claim.isFactualAssertion)) {
    issues.push(issue(topic === "shuttle" ? "unverified_shuttle_claim" : "unverified_pass_rate_claim", "hard_failure", topic === "shuttle" ? "입력 shuttle이 없는데 셔틀 운행을 단정함" : "입력 합격률이 없는데 합격률을 단정함"));
    return;
  }
  if (claims.some((claim) => claim.epistemicStatus === "speculative")) {
    issues.push(issue(topic === "shuttle" ? "unverified_shuttle_implication" : "unverified_pass_rate_implication", "warning", topic === "shuttle" ? "입력 shuttle이 없는데 셔틀 가능성을 암시함" : "입력 합격률이 없는데 합격 가능성을 암시함"));
  }
}

function isProvidedStudentReviewQuote(sentence: string, candidates: T01AcademyCandidate[]): boolean {
  if (!sentence.includes("출처: 운전면허PLUS 실제 수강생 리뷰")) return false;
  const normalizedSentence = normalizeReviewText(sentence.replace(/\s*[—–-]?\s*출처:\s*운전면허PLUS 실제 수강생 리뷰.*$/u, ""));
  return candidates.some((candidate) => candidate.studentReviews.some((review) => {
    const normalizedReview = normalizeReviewText(review.quote);
    return normalizedSentence.includes(normalizedReview)
      || (normalizedSentence.length >= 20 && normalizedReview.startsWith(normalizedSentence));
  }));
}

function normalizeReviewText(value: string): string {
  return String(value || "").replace(/[*_`>#“”"'\s]/g, "").trim();
}

function claimSentences(markdown: string, topic: T01ClaimTopic): string[] {
  const topicPattern = topic === "shuttle" ? /셔틀(?:버스)?/ : /합격률|합격\s*(?:성과|가능성)|빠르(?:게|운)\s*합격|한\s*번에\s*합격|대부분.*합격/;
  return String(markdown || "")
    .split(/\r?\n/)
    .flatMap((line) => line.split(/(?<=[.!?。…])\s+/))
    .map((line) => line.replace(/[*_`>#]/g, "").trim())
    .filter((line) => line && topicPattern.test(line));
}

function classifyClaimContext(topic: T01ClaimTopic, sentence: string): T01ClaimContext {
  // FAQ questions such as "셔틀이 운행되나요?" ask for verification;
  // they do not state that the service exists.
  if (/[?？]\s*$/.test(sentence)) {
    return claim(topic, sentence, "neutral", "verification_required", "verification_advice", false);
  }
  const strongAssertion = topic === "shuttle" ? hasStrongShuttleAssertion(sentence) : hasStrongPassRateAssertion(sentence);
  // A direct negation/qualification is safe guidance, not a positive fact
  // assertion. Keep it narrower than generic "확인되지 않았다" so an actual
  // positive assertion cannot be excused merely by adding a confirmation cue.
  if (hasDirectDenial(topic, sentence)) {
    return claim(topic, sentence, "negative", "denied", "absence_of_information", false);
  }
  // Explicit absence/denial outranks weak lexical positives, but not a direct
  // "operates/provides" assertion followed by a request to confirm details.
  if (!strongAssertion && /(확인되지|확인(?:할)?\s*수\s*없|제공(?:된)?\s*(?:자료|정보).*(?:없|않)|자료.*(?:없|않)|단정(?:하기)?(?:는)?\s*(?:어렵|불가)|뜻하지\s*않|보장하지\s*않|알 수 없)/.test(sentence)) {
    return claim(topic, sentence, "negative", /단정|뜻하지|보장하지|알 수 없/.test(sentence) ? "denied" : "unverified", /단정|뜻하지|보장하지|알 수 없/.test(sentence) ? "general_guidance" : "absence_of_information", false);
  }
  if (strongAssertion) return claim(topic, sentence, "positive", "asserted", "factual_assertion", true);
  // The sentence can contain an unrelated possibility phrase (for example,
  // "수업을 배정할 수 있는지") while asking whether a shuttle operates.
  // Treat that shuttle clause as a verification question, not an implication
  // that a shuttle may be available.
  if (topic === "shuttle" && /셔틀(?:버스)?(?:을|를|이|가|은|는)?\s*(?:운행|운영|제공)(?:한다면|할\s*경우|하는지|여부).{0,80}(?:확인|문의|상담|물어보|묻)/.test(sentence)) {
    return claim(topic, sentence, "neutral", "verification_required", "verification_advice", false);
  }
  if (/(?:수\s*있(?:습니다|다)?|가능(?:할|성)|기대(?:할|됩니다)|좋은\s*편인지)/.test(sentence)) return claim(topic, sentence, "uncertain", "speculative", "speculative_statement", false);
  if (/(?:여부|확인|문의|상담|질문|물어보|묻기|직접\s*연락|알아보)/.test(sentence)) return claim(topic, sentence, "neutral", "verification_required", "verification_advice", false);
  return claim(topic, sentence, "neutral", "unverified", "general_guidance", false);
}

function hasStrongShuttleAssertion(sentence: string): boolean {
  // A conditional or verification question may contain the same "셔틀 운영"
  // words as a factual assertion.  It is safe only when the operation itself
  // is not asserted; e.g. "운영한다면 확인" or "운영하는지 문의".  Do this
  // before the positive-claim pattern so "운영하므로 시간은 확인" remains a
  // hard failure when no supporting fact exists.
  if (/셔틀(?:버스)?(?:을|를|이|가|은|는)?\s*(?:운행|운영|제공)(?:한다면|할\s*경우|하는지|여부)/.test(sentence)) return false;
  if (/셔틀(?:버스)?\s*(?:운행|운영|제공)은.{0,48}(?:문의|확인|상담|물어보|묻)/.test(sentence)) return false;
  return /셔틀(?:버스)?(?:을|를|이|가|은|는)?\s*(?:정기적으로\s*)?(?:운행|운영|제공)(?!\s*(?:여부|정보|지역|시간|노선|범위|가능|되(?:는지|는|ㄹ)))|(?:무료|정기|특정\s*지역)\s*셔틀|셔틀(?:버스)?\s*이용\s*가능(?!성|을\s*뜻하지)/.test(sentence);
}

function hasStrongPassRateAssertion(sentence: string): boolean {
  return /(?:높은|우수한|좋은)\s*합격률|합격률\s*(?:이|은)?\s*(?:\d+(?:\.\d+)?\s*%|높|우수|좋)|(?:수강생|응시자).{0,24}(?:대부분|많은\s*편).{0,24}(?:한\s*번에|빠르게)\s*합격|(?:대부분|많은\s*편).{0,24}(?:한\s*번에|빠르게)\s*합격/.test(sentence);
}

function hasDirectDenial(topic: T01ClaimTopic, sentence: string): boolean {
  if (topic === "shuttle") {
    return /셔틀(?:버스)?(?:을|를|이|가|은|는)?\s*(?:운행|운영|제공)하지\s*않|셔틀(?:버스)?.{0,24}(?:운행|운영|제공).{0,16}보장.{0,12}(?:않|아니)|셔틀(?:버스)?.{0,18}(?:없|불가)/.test(sentence);
  }
  return /합격률.{0,24}(?:높|좋|우수).{0,16}단정(?:하기)?(?:는)?\s*(?:어렵|불가)|합격(?:률|\s*성과).{0,20}(?:보장|단정)하지\s*않/.test(sentence);
}

function claim(topic: T01ClaimTopic, sentence: string, polarity: T01ClaimPolarity, epistemicStatus: T01ClaimEpistemicStatus, claimType: T01ClaimType, isFactualAssertion: boolean): T01ClaimContext {
  return { topic, sentence, polarity, epistemicStatus, claimType, isFactualAssertion };
}

function normalizeCandidate(row: Row, trace: AcademySelectionTraceCandidate | undefined, targetRegion: string, fallbackRank: number, seed: string): T01AcademyCandidate {
  const value = (key: string): string | null => {
    const text = String(row[key] ?? "").trim();
    return text && text !== "[]" && text !== "null" && text !== "{}" ? text : null;
  };
  const academyType = value("academy_type");
  const address = value("address");
  const tuition = value("price");
  const shuttle = value("shuttle");
  const operatingSchedule = value("hours");
  const passRate = value("pass_rate");
  const phone = value("vphone") || value("phone");
  const selectedReview = selectedStudentReviewForAcademy(row, seed);
  const studentReviews = selectedReview ? [{ quote: selectedReview.quote, source: selectedReview.source }] : [];
  const partial = { address, tuition, shuttle, operatingSchedule, passRate, phone };
  const missingFields = FIELD_LABELS.filter(([field]) => !partial[field]).map(([, label]) => label);
  const storedRegion = value("region");
  return {
    academyId: candidateKey(row),
    academyName: String(row.name || ""),
    academyType,
    availableLicenses: availableLicensesFromSource(row),
    storedRegion,
    address,
    latitude: numberOrNull(row.latitude),
    longitude: numberOrNull(row.longitude),
    straightLineDistanceKm: trace?.straightLineDistanceKm ?? numberOrNull(row.distance_km),
    retrievalSource: trace?.retrievalSource ?? "stored_region_like",
    inclusionReason: trace?.inclusionReason ?? "region_like_query",
    retrievalRank: trace?.retrievalRank ?? fallbackRank,
    regionRelation: regionRelation(targetRegion, storedRegion),
    tuition,
    shuttle,
    operatingSchedule,
    passRate,
    phone,
    reviewEvidencePresent: studentReviews.length > 0 || Boolean(value("blog_reviews")),
    studentReviews,
    missingFields,
  };
}

function selectT01Variant(candidates: T01AcademyCandidate[], commonFactFields: string[], seed: string): { selectedVariant: T01VariantId; compatibleVariants: T01VariantId[] } {
  if (candidates.length < 2 || commonFactFields.length < 2) return { selectedVariant: "insufficient_comparison", compatibleVariants: ["insufficient_comparison"] };
  if (candidates.some((candidate) => candidate.retrievalSource !== "stored_region_like")) return { selectedVariant: "distance_expanded_comparison", compatibleVariants: ["distance_expanded_comparison"] };
  const typeCount = new Set(candidates.map((candidate) => candidate.academyType).filter(Boolean)).size;
  const compatibleVariants: T01VariantId[] = typeCount >= 2
    ? ["region_like_comparison", "criteria_first_grouped_comparison"]
    : ["region_like_comparison"];
  return { selectedVariant: compatibleVariants[seedIndex(seed, compatibleVariants.length)]!, compatibleVariants };
}

function resolveT01Modifiers(labels: Array<string | null | undefined>, candidates: T01AcademyCandidate[], variant: T01VariantId): T01TypedModifier[] {
  return labels.filter((label): label is string => Boolean(label && label.trim())).map((label) => modifierFor(label, candidates, variant));
}

function modifierFor(label: string, candidates: T01AcademyCandidate[], variant: T01VariantId): T01TypedModifier {
  const compatibleVariants: T01VariantId[] = ["region_like_comparison", "distance_expanded_comparison", "criteria_first_grouped_comparison", "insufficient_comparison"];
  const active = (category: T01ModifierCategory, promptDirectives: string[], outputConstraints: string[], required: boolean, inactiveReason?: string): T01TypedModifier => ({
    id: `legacy_${label}`, originalLabel: label, category, compatibleVariants, active: required, inactiveReason: required ? undefined : inactiveReason,
    promptDirectives: required ? promptDirectives : [], outputConstraints: required ? outputConstraints : [],
  });
  if (label === "가까운" || label === "근처") return active("composition", ["주소와 실제 지역만으로 후보를 비교하고 거리 수치나 km를 쓰지 않는다."], ["지역 밖 후보는 실제 지역 관계를 표시한다."], variant !== "insufficient_comparison", "comparison_insufficient");
  if (label === "비용절약") return active("evidence", ["수강료가 있는 후보만 금액을 언급하고, 없는 후보는 확인 질문으로 남긴다."], ["가격만으로 최저/가성비 순위를 만들지 않는다."], candidates.some((candidate) => Boolean(candidate.tuition)), "no_tuition_facts");
  if (label === "상담전확인") return active("audience", ["결론에 사실 데이터가 비어 있는 항목을 확인하는 짧은 체크리스트를 둔다."], ["확인 질문을 답변처럼 단정하지 않는다."], true);
  if (label === "셔틀편리") return active("evidence", ["셔틀 문자열이 있는 후보에만 그 내용을 언급한다."], ["셔틀 자료가 없는 후보의 운행을 추정하지 않는다."], candidates.some((candidate) => Boolean(candidate.shuttle)), "no_shuttle_facts");
  if (label === "야간반" || label === "주말반") return active("evidence", [], [], false, "no_structured_schedule_fact");
  return active("audience", ["선택한 수식어는 사실과 충돌하지 않는 범위에서만 반영한다."], ["새로운 학원 사실을 만들지 않는다."], true);
}

function commonFields(candidates: T01AcademyCandidate[]): string[] {
  if (!candidates.length) return [];
  const fields: Array<[keyof T01AcademyCandidate, string]> = [["availableLicenses", "운영 과정"], ["address", "주소"], ["academyType", "운영 형태"], ["tuition", "수강료"], ["shuttle", "셔틀"], ["operatingSchedule", "운영시간"], ["phone", "전화"]];
  return fields.filter(([field]) => candidates.every((candidate) => Array.isArray(candidate[field]) ? candidate[field].length > 0 : Boolean(candidate[field]))).map(([, label]) => label);
}

function regionRelation(targetRegion: string, storedRegion: string | null): T01RegionRelation {
  if (!storedRegion) return "unknown";
  if (storedRegion === targetRegion || storedRegion.includes(targetRegion) || targetRegion.includes(storedRegion)) return "target_region";
  const target = administrativeTokens(targetRegion);
  const actual = administrativeTokens(storedRegion);
  if (target.length && actual.length && target[0] === actual[0] && ((target[1] && target[1] === actual[1]) || (target[2] && target[2] === actual[2]))) return "same_parent_region";
  return "other_region";
}

function candidateKey(row: Row): string { return String(row.external_id || row.id || row.name); }
function numberOrNull(value: unknown): number | null { const number = Number(value); return Number.isFinite(number) ? number : null; }
function administrativeTokens(value: string): string[] { return String(value || "").split(/\s+/).filter((token) => /(?:특별시|광역시|특별자치시|특별자치도|도|시|군|구)$/u.test(token)); }
function seedIndex(seed: string, modulo: number): number { let hash = 2166136261 >>> 0; for (let index = 0; index < seed.length; index++) { hash ^= seed.charCodeAt(index); hash = Math.imul(hash, 16777619) >>> 0; } return modulo <= 1 ? 0 : hash % modulo; }
// T01 legacy local has six seed-rotated structures and its sixth is the FAQ
// variant. Reusing that rotation keeps v2 optional and deterministic per slot.
function shouldIncludeT01Faq(seed: string): boolean { return seedIndex(seed, 6) === 5; }
function hasSpecificMoney(value: string): boolean { return /\d{2,3}\s*만\s*(?:원|뤈|웜)?|\d{3},\d{3}\s*원/u.test(value); }
function normalizedMoneyValues(value: string): string[] {
  return Array.from(String(value).matchAll(/(\d{1,3}(?:,\d{3})+|\d{1,3})\s*(만)?\s*원?/gu)).map((match) => {
    const base = Number(String(match[1]).replace(/,/g, ""));
    return String(match[2] ? base * 10000 : base);
  });
}
function issue(code: string, severity: T01QualityIssue["severity"], message: string): T01QualityIssue { return { code, severity, message }; }
