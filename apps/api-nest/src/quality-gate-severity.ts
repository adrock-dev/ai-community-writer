// 품질 게이트 이슈 코드의 심각도 분류.
//
// 격리(draft_posts) 검수 워크플로에서, 게이트에 걸린 글을 관리자가 발행해도 되는지 판단하는 기준.
//   - "A" (구조/문체): 사람이 보고 "이 정도면 쓸 만하다" 판단이 타당한 것. 사유 확인 후 발행 허용.
//   - "B" (안전/사실): 사람 눈에 괜찮아 보여도 발행하면 실제 피해(내부 흔적 노출·허위 정보). 발행 차단.
//
// 게이트가 내보내는 코드는 too_short_1234 / inflated_candidate_count_5_gt_3 처럼 동적 접미사가
// 붙으므로 stem(어간) 매칭으로 분류한다. quality-gate.ts 에 새 코드가 추가됐는데 여기에 없으면
// test/quality-gate-severity.test.ts(드리프트 가드)가 실패하고, 런타임은 안전하게 "B"로 폴백한다.

export type IssueSeverityClass = "A" | "B";

// 구조/문체 — 사유 확인 후 발행 허용.
export const A_ISSUE_STEMS: readonly string[] = [
  "missing_h1_title",
  "too_short",
  "too_long",
  "not_enough_h2",
  "too_many_h2",
  "missing_comparison_table",
  "missing_summary_table",
  "missing_checklist_or_list",
  "thin_sections",
  "review_facts_unused",
  "missing_available_image_slot",
  "unknown_image_slots",
  "missing_candidate_h3_headings",
  "keyword_spacing_issue",
  "overlong_paragraph",
  "overlong_sentence",
  "hard_sentences",
  "missing_internal_link",
];

// 안전/사실 — 발행 차단(수정 후 재검증만). 내부 흔적 노출·미검증 단정·후보 수 부풀림 등.
export const B_ISSUE_STEMS: readonly string[] = [
  "exposes_internal_fact_language",
  "contains_visible_citations",
  "contains_pseudo_slot",
  "risky_duration_or_pass_guarantee_claim",
  "unverified_specific_price_claim",
  "unverified_review_claim",
  "inflated_candidate_count",
  "missing_real_candidate_name",
  "table_missing_real_candidate_name",
  // t01 데이터 게이트 hard_failure 는 worker 에서 "t01_" 접두사로 편입된다.
  "t01_unverified_shuttle_claim",
  "t01_unverified_pass_rate_claim",
  "t01_unverified_shuttle_implication",
  "t01_unverified_pass_rate_implication",
];

// 긴 stem 이 짧은 stem 을 가리지 않도록 길이 내림차순으로 검사한다.
const STEM_CLASS: ReadonlyArray<readonly [string, IssueSeverityClass]> = [
  ...A_ISSUE_STEMS.map((stem) => [stem, "A"] as const),
  ...B_ISSUE_STEMS.map((stem) => [stem, "B"] as const),
].sort((a, b) => b[0].length - a[0].length);

/** 단일 이슈 코드를 A/B 로 분류한다. 미분류 코드는 안전하게 "B"(발행 차단)로 폴백. */
export function classifyIssue(code: string): IssueSeverityClass {
  const normalized = String(code || "").trim();
  for (const [stem, cls] of STEM_CLASS) {
    if (normalized === stem || normalized.startsWith(`${stem}_`)) return cls;
  }
  return "B";
}

/** 분류표에 명시적으로 존재하는지(=드리프트 가드용). 폴백 매칭과 구분한다. */
export function isKnownIssueStem(stem: string): boolean {
  return A_ISSUE_STEMS.includes(stem) || B_ISSUE_STEMS.includes(stem);
}

export interface ClassifiedIssue {
  code: string;
  class: IssueSeverityClass;
}

/** 이슈 코드 목록을 {code, class} 로 매핑(저장용). */
export function classifyIssues(codes: readonly string[]): ClassifiedIssue[] {
  return codes.map((code) => ({ code, class: classifyIssue(code) }));
}

/** 걸린 이슈들의 최상위 차단 등급. B 가 하나라도 있으면 "B", 아니면 "A"(빈 목록도 "A"). */
export function blockingClass(codes: readonly string[]): IssueSeverityClass {
  return codes.some((code) => classifyIssue(code) === "B") ? "B" : "A";
}
