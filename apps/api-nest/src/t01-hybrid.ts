import { STUDENT_REVIEW_SOURCE } from "./academy-review-evidence.js";
import { type T01AcademyCandidate, type T01DataGatedContext, type T01QualityIssue, t01QualityIssues } from "./t01-data-gated.js";

export const T01_HYBRID_MODE = "t01_hybrid_v1" as const;

export type HybridReviewCandidate = {
  academyId: string;
  academyName: string;
  text: string;
  source: { label: typeof STUDENT_REVIEW_SOURCE; url: null; identifier: null };
  eligibleForContent: boolean;
  exclusionReasons: string[];
  selectionScore: number;
};

export type T01HybridContext = {
  mode: typeof T01_HYBRID_MODE;
  data: T01DataGatedContext;
  selectedReview: HybridReviewCandidate | null;
};

export type HybridDecisionSupportUnit = {
  section: "faq" | "checklist";
  text: string;
  topic: "location" | "shuttle" | "tuition" | "schedule" | "license" | "internal_test" | "region_relation" | "other";
  intent: "verification" | "selection" | "explanation" | "action" | "other";
  action: "contact_academy" | "compare_candidates" | "check_route" | null;
  answerSummary: string | null;
};

export function isT01HybridMode(value: unknown): value is typeof T01_HYBRID_MODE {
  return value === T01_HYBRID_MODE;
}

export function shouldUseT01HybridMode(templateId: unknown, generationMode: unknown): boolean {
  return String(templateId || "") === "T01" && isT01HybridMode(generationMode);
}

export function buildT01HybridContext(data: T01DataGatedContext, seed: string): T01HybridContext {
  return { mode: T01_HYBRID_MODE, data, selectedReview: selectHybridReview(data.candidates, seed) };
}

/**
 * A comparison article is allowed one review in total.  The v2 candidate
 * adapter already selected a deterministic source review per academy; this
 * selector deterministically chooses only one of those candidate reviews.
 */
export function selectHybridReview(candidates: T01AcademyCandidate[], seed: string): HybridReviewCandidate | null {
  const options = candidates.flatMap((candidate) => (candidate.studentReviews || []).map((review) => reviewCandidate(candidate, review.quote, review.source)));
  const eligible = options.filter((option) => option.eligibleForContent);
  if (!eligible.length) return null;
  return eligible
    .sort((left, right) => right.selectionScore - left.selectionScore || stableRank(`${seed}|${left.academyId}|${left.text}`) - stableRank(`${seed}|${right.academyId}|${right.text}`) || left.academyId.localeCompare(right.academyId))[0] ?? null;
}

/**
 * Keeps the existing hybrid article-level selector unchanged while exposing
 * the same eligibility rules to modes that need one review per academy.
 * The returned order follows the final candidate order.
 */
export function selectEligibleReviewsByAcademy(candidates: T01AcademyCandidate[], seed: string): HybridReviewCandidate[] {
  return candidates.flatMap((candidate) => {
    const eligible = (candidate.studentReviews || [])
      .map((review) => reviewCandidate(candidate, review.quote, review.source))
      .filter((review) => review.eligibleForContent)
      .sort((left, right) => right.selectionScore - left.selectionScore
        || stableRank(`${seed}|${left.academyId}|${left.text}`) - stableRank(`${seed}|${right.academyId}|${right.text}`)
        || left.text.localeCompare(right.text));
    return eligible.slice(0, 1);
  });
}

function reviewCandidate(candidate: T01AcademyCandidate, text: string, source: typeof STUDENT_REVIEW_SOURCE): HybridReviewCandidate {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  const exclusionReasons: string[] = [];
  if (!normalized) exclusionReasons.push("empty_text");
  if (normalized.length < 12) exclusionReasons.push("too_short");
  if (/\b(?:\d{2,3}-\d{3,4}-\d{4}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})\b/u.test(normalized)) exclusionReasons.push("personal_data");
  if (isPromotionalOnly(normalized)) exclusionReasons.push("promotional_only");
  if (!source) exclusionReasons.push("missing_source");
  const score = 30
    + Math.min(25, Math.floor(normalized.length / 8))
    + (/(?:설명|상담|수업|강사|일정|차량|연습|안내|예약)/u.test(normalized) ? 18 : 0)
    - (/(?:추천|최고|대박|완벽|무조건|강력)/u.test(normalized) ? 8 : 0);
  return {
    academyId: candidate.academyId,
    academyName: candidate.academyName,
    text: normalized,
    source: { label: source, url: null, identifier: null },
    eligibleForContent: exclusionReasons.length === 0,
    exclusionReasons,
    selectionScore: score,
  };
}

function isPromotionalOnly(text: string): boolean {
  const signals = text.match(/(?:최고|대박|완벽|무조건|강력\s*추천|가성비\s*최고|친절)/gu) || [];
  return signals.length >= 2 && text.length < 70;
}

export function t01HybridStructureGuide(context: T01HybridContext): string {
  const variant = context.data.selectedVariant;
  const expansion = context.data.candidates.some((candidate) => candidate.retrievalSource !== "stored_region_like");
  const variantGuide = variant === "insufficient_comparison"
    ? "확인 가능한 후보를 정직하게 소개하고, 비교 정보가 비어 있는 항목은 등록 전 확인 행동으로만 남긴다."
    : variant === "criteria_first_grouped_comparison"
      ? "검증된 운영 형태처럼 실제 공통 facts가 있는 기준만 먼저 설명하고, 순위 대신 선택 기준으로 후보를 읽게 한다."
      : "지역 상황에서 선택 기준으로 자연스럽게 이어진 뒤 후보별 설명과 비교표로 마무리한다.";
  return `${expansion ? "도입 또는 선택 기준에서 주변 지역 후보를 함께 본 이유를 한 번 설명하고, 각 후보의 실제 소재지를 사실대로 적는다. " : ""}${variantGuide} 체크리스트는 짧은 행동 목록으로 두고, FAQ는 체크리스트에서 답하지 않은 질문만 남긴다.`;
}

export function t01HybridPromptContract(context: T01HybridContext): string {
  const candidates = context.data.candidates.map((candidate) => ({
    학원명: candidate.academyName,
    실제소재지: candidate.storedRegion || candidate.address || "확인된 지역 정보 없음",
    주소: candidate.address,
    운영형태: candidate.academyType,
    수강료: candidate.tuition,
    셔틀: candidate.shuttle,
    교육시간: candidate.operatingSchedule,
    합격률_정보: candidate.passRate,
    전화: candidate.phone,
    주변후보: candidate.retrievalSource !== "stored_region_like",
  }));
  const selectedReview = context.selectedReview ? {
    학원명: context.selectedReview.academyName,
    원문: context.selectedReview.text,
    출처: context.selectedReview.source.label,
  } : null;
  return [
    "T01 hybrid 작성 계약 (계약명·내부 키·검수 절차는 글에 쓰지 않는다):",
    "- 아래 후보만 소개하고, 실제 소재지·주소·확인된 정보만 쓴다. 없는 가격·셔틀·교육시간·합격률·후기를 만들거나 추측하지 않는다.",
    "- 주변 후보는 요청 지역 소재 학원으로 쓰지 말고, 실제 소재지와 함께 주변 후보로 비교한 이유를 자연스럽게 한 번 설명한다. 거리 수치·km·이동시간·교통 편의 단정은 쓰지 않는다.",
    "- 후보 설명은 확인된 사실 → 지역 이용자에게 주는 의미 → 살펴볼 이용자 → 중요한 확인사항 순서로 쓰되, 모든 결측값을 나열하지 않는다.",
    "- 비교표에는 모든 후보에 실제로 있는 공통 facts만 넣는다. 순위·최상급·합격 보장·근거 없는 체험담을 만들지 않는다.",
    context.selectedReview
      ? "- 아래 대표 수강생 리뷰는 글 전체에서 정확히 한 번만, 연결된 학원 설명 직후에 Markdown 인용으로 원문 그대로 쓴다. 인용 바로 아래에 `출처: 제공된 서비스명`을 표시한다. 작성자·작성일·평점·닉네임·내부 식별자·URL은 쓰지 않는다. 리뷰를 전체 수강생 평가나 합격률로 일반화하지 않는다."
      : "- 대표 수강생 리뷰가 제공되지 않았다. 수강생 후기·리뷰 인용·출처를 만들지 않는다.",
    "- 체크리스트는 등록 전에 실행할 짧은 행동 목록이다. 같은 일정·비용·셔틀 확인 행동을 표현만 바꿔 두 번 쓰지 않는다. FAQ는 체크리스트와 같은 확인 권고를 질문형으로 반복하지 말고, 비교 범위·주변 후보·표 해석처럼 추가 설명이 필요한 질문만 남긴다. 유효한 FAQ가 없으면 FAQ H2를 만들지 않는다.",
    "- 자연스러운 지역 블로그 문체로 작성한다. 내부 데이터 구조, 후보 추출 방식 이름, 필드명, 검수 규칙을 노출하지 않는다.",
    "독자용 후보 사실:",
    JSON.stringify({ 요청지역: context.data.targetRegion, 후보: candidates, 대표수강생리뷰: selectedReview }, null, 2),
  ].join("\n");
}

export function hybridFactsForPrompt(facts: string): string {
  return String(facts || "")
    .split(/\r?\n/)
    .filter((line) => !/후기 문구 보유 후보/u.test(line))
    .map((line) => line.split(" / ").filter((part) => !/(?:수강생\s*리뷰|블로그\s*리뷰|후기\s*흐름|긍정\s*블로그|참고\s*글)/u.test(part)).join(" / ").trim())
    .filter(Boolean)
    .join("\n");
}

export function hybridReviewPromptInstruction(context: T01HybridContext): string {
  return context.selectedReview
    ? "대표 수강생 리뷰는 별도 hybrid 계약에 제공된 정확히 한 건만 연결된 학원 설명 직후에 인용한다. 다른 후기·출처·작성자·작성일·평점은 만들지 않는다."
    : "대표 수강생 리뷰가 없으므로 후기·리뷰 인용·출처를 만들지 않는다.";
}

export function hybridFaqPromptInstruction(): string {
  return "FAQ는 선택 사항이다. 체크리스트의 실행 행동을 질문형으로 되풀이하지 말고, 본문·표·체크리스트에서 답하지 않은 추가 설명이 있을 때만 짧게 둔다. 유효한 질문이 없으면 FAQ H2를 생략한다.";
}

/** Removes only deterministically identified decision-support duplicates after generation. */
export function dedupeHybridDecisionSupport(markdown: string): string {
  const lines = String(markdown || "").split(/\r?\n/);
  const checklistRange = namedSectionRange(lines, /체크리스트/u);
  const keptChecklist: HybridDecisionSupportUnit[] = [];
  if (checklistRange) {
    for (let index = checklistRange.start; index < checklistRange.end; index++) {
      const line = lines[index] || "";
      if (!/^\s*(?:[-*]|\d+\.)\s+/.test(line)) continue;
      const unit = decisionUnit("checklist", line.replace(/^\s*(?:[-*]|\d+\.)\s+/, ""));
      if (keptChecklist.some((item) => normalized(item.text) === normalized(unit.text) || semanticDuplicate(item, unit))) lines[index] = "";
      else keptChecklist.push(unit);
    }
  }
  const faqRange = namedSectionRange(lines, /(?:FAQ|자주\s*(?:묻는|생기는)\s*(?:질문|추가\s*질문))/iu);
  if (faqRange) {
    const keptFaq: HybridDecisionSupportUnit[] = [];
    let skipping = false;
    for (let index = faqRange.start; index < faqRange.end; index++) {
      const line = lines[index] || "";
      if (isFaqQuestion(line)) {
        const unit = decisionUnit("faq", line.replace(/^#{3,}\s+/, "").replace(/^\*\*|\*\*$/g, ""));
        skipping = keptChecklist.some((item) => semanticDuplicate(item, unit)) || keptFaq.some((item) => normalized(item.text) === normalized(unit.text) || semanticDuplicate(item, unit));
        if (skipping) lines[index] = ""; else keptFaq.push(unit);
      } else if (skipping) lines[index] = "";
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function t01HybridQualityIssues(markdown: string, context: T01HybridContext): T01QualityIssue[] {
  const issues = t01QualityIssues(markdown, context.data).filter((item) => item.code !== "faq_variant_not_rendered" && !(item.code === "comparison_table_tuition_mismatch" && !tableContainsSpecificTuition(markdown)));
  const reviewIssues = hybridReviewIssues(markdown, context.selectedReview);
  const decisionIssues = hybridDecisionSupportIssues(markdown);
  return [...issues, ...reviewIssues, ...decisionIssues];
}

function tableContainsSpecificTuition(markdown: string): boolean {
  const tableLines = String(markdown || "").split(/\r?\n/).filter((line) => line.includes("|") && /수강료|비용/u.test(line));
  return tableLines.some((line) => /\d{2,3}\s*만\s*원?|\d{1,3}(?:,\d{3})+\s*원/u.test(line));
}

function hybridReviewIssues(markdown: string, review: HybridReviewCandidate | null): T01QualityIssue[] {
  const issues: T01QualityIssue[] = [];
  const allLines = String(markdown || "").split(/\r?\n/);
  const reviewLines = allLines.filter((line) => /^>\s*/.test(line) || /출처:\s*DrivingPlus 수강생 리뷰/u.test(line));
  const reviewMarkers = reviewLines.filter((line) => /수강생\s*(?:리뷰|후기)|출처:/u.test(line));
  if (!review) {
    if (reviewMarkers.length) issues.push(issue("hybrid_unverified_review_claim", "hard_failure", "선택된 원천 리뷰가 없는데 리뷰 또는 출처를 노출함"));
    return issues;
  }
  const expectedReview = normalized(review.text);
  const quoteLineIndexes = allLines.flatMap((line, index) => normalized(line).includes(expectedReview) ? [index] : []);
  const sourceLineIndexes = allLines.flatMap((line, index) => line.includes(`출처: ${review.source.label}`) ? [index] : []);
  if (quoteLineIndexes.length !== 1) issues.push(issue("hybrid_review_count", "hard_failure", `대표 리뷰 인용은 1개여야 하나 ${quoteLineIndexes.length}개임`));
  if (!sourceLineIndexes.length) issues.push(issue("hybrid_review_source_missing", "hard_failure", "대표 리뷰 출처가 없거나 변경됨"));
  const quoteLineIndex = quoteLineIndexes[0] ?? -1;
  const sourceIsLinked = quoteLineIndex >= 0 && sourceLineIndexes.some((index) => index > quoteLineIndex && index <= quoteLineIndex + 3);
  if (quoteLineIndex >= 0 && sourceLineIndexes.length && !sourceIsLinked) issues.push(issue("hybrid_review_source_unlinked", "hard_failure", "대표 리뷰와 출처가 인접하게 연결되지 않음"));
  if (!quoteLineIndexes.length && reviewMarkers.length) issues.push(issue("hybrid_review_text_mismatch", "hard_failure", "대표 리뷰 인용이 원천 원문과 다름"));
  const reviewIndex = quoteLineIndex >= 0 ? String(markdown).indexOf(allLines[quoteLineIndex] || "") : -1;
  const beforeReview = reviewIndex >= 0 ? String(markdown).slice(0, reviewIndex) : "";
  const precedingHeading = Array.from(beforeReview.matchAll(/^###\s+(.+)$/gm)).at(-1)?.[1] || "";
  if (precedingHeading && !precedingHeading.includes(review.academyName)) issues.push(issue("hybrid_review_wrong_academy", "hard_failure", "대표 리뷰가 연결된 학원 설명 직후에 배치되지 않음"));
  const reviewWindow = quoteLineIndex >= 0 ? allLines.slice(Math.max(0, quoteLineIndex - 1), quoteLineIndex + 5).join("\n") : reviewLines.join("\n");
  if (/(?:작성자|작성일|닉네임|별점|평점|review[_\s-]?id|리뷰\s*ID)/iu.test(reviewWindow)) issues.push(issue("hybrid_review_metadata_exposed", "hard_failure", "리뷰 작성자·작성일·평점 또는 내부 식별자를 노출함"));
  if (/(?:전체\s*수강생|대부분\s*수강생|합격률)/u.test(reviewWindow)) issues.push(issue("hybrid_review_generalized", "hard_failure", "개별 리뷰를 전체 평가 또는 합격률로 일반화함"));
  if (review.text.length > 220) issues.push(issue("hybrid_review_too_long", "warning", "대표 리뷰 인용이 김"));
  return issues;
}

export function hybridDecisionSupportIssues(markdown: string): T01QualityIssue[] {
  const issues: T01QualityIssue[] = [];
  const { checklist, faq, hasChecklist, hasFaq } = parseDecisionSupport(markdown);
  if (hasChecklist && !checklist.length) issues.push(issue("hybrid_empty_checklist", "hard_failure", "체크리스트 제목만 있고 항목이 없음"));
  if (hasFaq && !faq.length) issues.push(issue("hybrid_empty_faq", "hard_failure", "FAQ 제목만 있고 유효한 문답이 없음"));
  for (const duplicate of exactDuplicates([...checklist, ...faq])) issues.push(issue("hybrid_decision_support_exact_duplicate", "hard_failure", `FAQ/체크리스트 문장이 반복됨: ${duplicate.text}`));
  for (const faqUnit of faq) {
    if (checklist.some((item) => semanticDuplicate(item, faqUnit))) {
      issues.push(issue("hybrid_faq_checklist_semantic_overlap", "warning", `FAQ와 체크리스트가 같은 확인 행동을 반복함: ${faqUnit.topic}`));
    }
  }
  for (const duplicate of semanticDuplicates(faq)) issues.push(issue("hybrid_faq_semantic_overlap", "warning", `FAQ끼리 의미상 중복됨: ${duplicate.topic}`));
  for (const duplicate of semanticDuplicates(checklist)) issues.push(issue("hybrid_checklist_semantic_overlap", "warning", `체크리스트 행동이 중복됨: ${duplicate.topic}`));
  return issues;
}

export function parseDecisionSupport(markdown: string): { checklist: HybridDecisionSupportUnit[]; faq: HybridDecisionSupportUnit[]; hasChecklist: boolean; hasFaq: boolean } {
  const checklistSection = namedSection(markdown, /체크리스트/u);
  const faqSection = namedSection(markdown, /(?:FAQ|자주\s*(?:묻는|생기는)\s*(?:질문|추가\s*질문))/iu);
  return {
    checklist: checklistSection ? checklistSection.body.split(/\r?\n/).filter((line) => /^\s*(?:[-*]|\d+\.)\s+/.test(line)).map((line) => decisionUnit("checklist", line.replace(/^\s*(?:[-*]|\d+\.)\s+/, ""))) : [],
    faq: faqSection ? faqItems(faqSection.body).map((line) => decisionUnit("faq", line)) : [],
    hasChecklist: Boolean(checklistSection),
    hasFaq: Boolean(faqSection),
  };
}

function namedSection(markdown: string, headingPattern: RegExp): { heading: string; body: string } | null {
  const source = String(markdown || "");
  const headings = Array.from(source.matchAll(/^(#{2,3})\s+(.+)$/gm));
  const index = headings.findIndex((heading) => headingPattern.test(heading[2] || ""));
  if (index < 0) return null;
  const heading = headings[index]!;
  const level = heading[1]!.length;
  const next = headings.slice(index + 1).find((candidate) => candidate[1]!.length <= level);
  return { heading: heading[2]!.trim(), body: source.slice((heading.index || 0) + heading[0].length, next?.index ?? source.length).trim() };
}

function namedSectionRange(lines: string[], headingPattern: RegExp): { start: number; end: number } | null {
  const index = lines.findIndex((line) => /^#{2,3}\s+/.test(line) && headingPattern.test(line.replace(/^#{2,3}\s+/, "")));
  if (index < 0) return null;
  const level = lines[index]!.match(/^#+/)?.[0].length || 2;
  let end = lines.length;
  for (let cursor = index + 1; cursor < lines.length; cursor++) {
    const candidateLevel = lines[cursor]!.match(/^#+/)?.[0].length;
    if (candidateLevel && candidateLevel <= level) { end = cursor; break; }
  }
  return { start: index + 1, end };
}

function faqItems(body: string): string[] {
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const questions = lines.filter((line) => /(?:^#{3,}\s+|^\*\*)?(?:Q[.:]\s*)?.*(?:\?|？|인가요|어떻게\s*(?:하나요|확인하나요))/.test(line));
  return questions.length ? questions : lines.filter((line) => !/^#{3,}\s*$/.test(line)).slice(0, 4);
}

function isFaqQuestion(line: string): boolean {
  const clean = String(line || "").trim();
  return /(?:^#{3,}\s+|^\*\*)?(?:Q[.:]\s*)?.*(?:\?|？|인가요|어떻게\s*(?:하나요|확인하나요))/.test(clean);
}

function decisionUnit(section: "faq" | "checklist", text: string): HybridDecisionSupportUnit {
  const clean = String(text || "").replace(/[*_`]/g, "").replace(/^Q[.:]\s*/i, "").trim();
  const topic = /셔틀/u.test(clean) ? "shuttle"
    : /수강료|비용|추가\s*비용|가격/u.test(clean) ? "tuition"
      : /시간|일정|주말|야간|수업/u.test(clean) ? "schedule"
        : /면허|과정/u.test(clean) ? "license"
          : /자체\s*시험/u.test(clean) ? "internal_test"
            : /주변|인근|다른\s*지역|포함\s*이유/u.test(clean) ? "region_relation"
              : /주소|소재지|위치/u.test(clean) ? "location" : "other";
  const recordsInformation = /(?:기록|메모|정리)한다|(?:상담받은|안내받은)\s*내용/u.test(clean);
  const intent = recordsInformation ? "action"
    : /왜|이유|어떤\s*기준|어떻게\s*해석/u.test(clean) ? "explanation"
    : /비교|선택|어떤\s*학원/u.test(clean) ? "selection"
      : /확인|문의|물어|상담|[?？]$/u.test(clean) ? "verification" : "other";
  const action = !recordsInformation && /문의|상담|학원에|전화/u.test(clean) ? "contact_academy"
    : /경로|이동|출발/u.test(clean) ? "check_route"
      : /비교/u.test(clean) ? "compare_candidates" : null;
  const resolvedAction = action || (intent === "verification" && ["shuttle", "tuition", "schedule", "license", "internal_test"].includes(topic) ? "contact_academy" : null);
  return { section, text: clean, topic, intent, action: resolvedAction, answerSummary: section === "faq" ? normalized(clean) : null };
}

function exactDuplicates(items: HybridDecisionSupportUnit[]): HybridDecisionSupportUnit[] {
  const seen = new Map<string, HybridDecisionSupportUnit>();
  const duplicates: HybridDecisionSupportUnit[] = [];
  for (const item of items) {
    const key = normalized(item.text);
    if (seen.has(key)) duplicates.push(item); else seen.set(key, item);
  }
  return duplicates;
}

function semanticDuplicates(items: HybridDecisionSupportUnit[]): HybridDecisionSupportUnit[] {
  const duplicates: HybridDecisionSupportUnit[] = [];
  for (let index = 0; index < items.length; index++) for (let other = index + 1; other < items.length; other++) if (semanticDuplicate(items[index]!, items[other]!)) duplicates.push(items[other]!);
  return duplicates;
}

function semanticDuplicate(left: HybridDecisionSupportUnit, right: HybridDecisionSupportUnit): boolean {
  return left.topic === right.topic && left.topic !== "other" && left.intent === right.intent && left.action === right.action;
}

function normalized(value: string): string { return String(value || "").replace(/[^0-9A-Za-z가-힣]/gu, "").toLowerCase(); }
function stableRank(value: string): number { let hash = 2166136261 >>> 0; for (const character of value) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619) >>> 0; } return hash; }
function issue(code: string, severity: T01QualityIssue["severity"], message: string): T01QualityIssue { return { code, severity, message }; }
