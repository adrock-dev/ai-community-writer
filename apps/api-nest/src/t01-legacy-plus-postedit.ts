import { dedupeLegacyPlusDecisionSupport, truncateLegacyPlusReview } from "./t01-legacy-plus.js";
import { t01QualityIssues, type T01DataGatedContext, type T01QualityIssue } from "./t01-data-gated.js";
import type { AcademyContentReviewCandidate } from "./academy-review-evidence.js";

export const T01_LEGACY_PLUS_POSTEDIT_MODE = "t01_legacy_plus_postedit_v1" as const;
export type PosteditLockedFacts = { targetRegion: string; academies: Array<{ academyId: string; name: string; actualRegion: string | null; address: string | null; phone: string | null; academyType: string | null; availableLicenses: string[]; internalTest: null; tuition: string | null; shuttle: string | null; operatingSchedule: string | null; website: null; isOutsideTargetRegion: boolean }>; selectedReviews: Array<{ academyId: string; academyName: string; text: string; sourceLabel: string }>; prohibitedClaims: string[] };
export type PosteditContext = { mode: typeof T01_LEGACY_PLUS_POSTEDIT_MODE; data: T01DataGatedContext; lockedFacts: PosteditLockedFacts };
export type PosteditFactDiff = { criticalFactLoss: string[]; addedClaimSignals: string[]; reviewIssue: string | null; academySetPreserved: boolean; locationPreserved: boolean; licensesPreserved: boolean };

export function buildPosteditContext(data: T01DataGatedContext, reviews: AcademyContentReviewCandidate[]): PosteditContext {
  return { mode: T01_LEGACY_PLUS_POSTEDIT_MODE, data, lockedFacts: {
    targetRegion: data.targetRegion,
    academies: data.candidates.map((candidate) => ({ academyId: candidate.academyId, name: candidate.academyName, actualRegion: candidate.storedRegion, address: candidate.address, phone: candidate.phone, academyType: candidate.academyType, availableLicenses: licenses(candidate), internalTest: null, tuition: candidate.tuition, shuttle: candidate.shuttle, operatingSchedule: candidate.operatingSchedule, website: null, isOutsideTargetRegion: candidate.regionRelation !== "target_region" })),
    selectedReviews: reviews.map((review) => ({ academyId: review.academyId, academyName: review.academyName, text: truncateLegacyPlusReview(review.text), sourceLabel: review.source.label })),
    prohibitedClaims: ["가격", "셔틀", "합격률", "접근성", "시설", "강사진", "주말·야간 수업", "할인"],
  }};
}

export function posteditPrompt(draft: string, context: PosteditContext): string {
  const lock = JSON.stringify(context.lockedFacts, null, 2);
  return `아래 초안을 사실 잠금 상태로 후편집하세요. 완성된 Markdown 글만 출력하세요.\n\n허용: 제목·문단 순서·소제목·연결 문장·중복을 다듬고, 작성자 중심·내부 작업 표현을 독자 중심 문장으로 바꾸며, 중복 FAQ와 빈 섹션은 삭제합니다.\n금지: 학원·주소·전화·면허·지역 관계·가격·셔틀·합격률·시간표·접근성·시설·강사 정보를 새로 만들거나 다른 학원으로 옮기지 마세요. 소재지가 대상 지역 밖이면 실제 소재지와 함께 “인근 지역 학원도 함께 비교한다”는 뜻을 한 번 분명히 쓰되 km·이동시간·접근성 판단은 쓰지 마세요.\n리뷰: lockedFacts.selectedReviews의 각 리뷰는 연결 학원에 최대 한 번만 정확히 인용하고 출처를 그대로 쓰세요. 인용과 출처는 같은 blockquote 또는 바로 다음 blockquote 줄에 둡니다. 리뷰가 없는 학원에는 후기·출처를 만들지 마세요. 리뷰를 전체 평가나 합격률로 일반화하지 마세요.\n비교표는 공통 사실만 쓰고, FAQ는 체크리스트와 중복되면 생략하세요. 모든 학원명과 실제 소재지/주소, 초안에 있던 핵심 면허 정보는 글 어딘가에 남겨야 합니다.\n\nLOCKED FACTS:\n${lock}\n\nDRAFT:\n${draft}`;
}

export function finalizePostedit(markdown: string): string { return dedupeLegacyPlusDecisionSupport(String(markdown || "")).trim(); }

export function posteditFactDiff(draft: string, final: string, context: PosteditContext): PosteditFactDiff {
  const lost: string[] = [];
  for (const academy of context.lockedFacts.academies) {
    if (!final.includes(academy.name)) lost.push(`academy:${academy.academyId}`);
    const baselineLocation = [academy.actualRegion, academy.address].filter((value) => value && draft.includes(value)).map(String);
    if (baselineLocation.length && !baselineLocation.some((value) => final.includes(value))) lost.push(`location:${academy.academyId}`);
    for (const license of academy.availableLicenses.filter((value) => draft.includes(value))) if (!final.includes(license)) lost.push(`license:${academy.academyId}:${license}`);
  }
  const reviews = context.lockedFacts.selectedReviews;
  const lines = final.split(/\r?\n/);
  const matchedReviewQuotes = reviews.filter((review) => lines.some((line) => /^>\s+/.test(line) && line.includes(review.text))).length;
  const reviewIssue = reviews.length ? (matchedReviewQuotes !== reviews.length || reviews.some((review) => { const index = lines.findIndex((line) => line.includes(review.text)); return index < 0 || !lines.slice(index, index + 3).some((line) => line.includes(`출처: ${review.sourceLabel}`)); }) ? "review_lock_violation" : null) : (lines.some((line) => /^>\s+/.test(line)) ? "unexpected_review" : null);
  const added = [/(?:합격률이\s*(?:높|좋)|최고|BEST|TOP|가장\s*친절|접근성이\s*(?:좋|뛰))/u, /(?:무료\s*셔틀|주말\s*수업|야간\s*수업|할인)/u].filter((pattern) => pattern.test(final) && !pattern.test(draft)).map(String);
  return { criticalFactLoss: lost, addedClaimSignals: added, reviewIssue, academySetPreserved: !lost.some((value) => value.startsWith("academy:")), locationPreserved: !lost.some((value) => value.startsWith("location:")), licensesPreserved: !lost.some((value) => value.startsWith("license:")) };
}

export function posteditQualityIssues(markdown: string, draft: string, context: PosteditContext): T01QualityIssue[] {
  const diff = posteditFactDiff(draft, markdown, context);
  const issues = t01QualityIssues(markdown, context.data).filter((issue) => issue.code !== "faq_variant_not_rendered");
  if (diff.criticalFactLoss.length) issues.push(issue("postedit_critical_fact_loss", "hard_failure", diff.criticalFactLoss.join(", ")));
  if (diff.reviewIssue) issues.push(issue("postedit_review_lock", "hard_failure", diff.reviewIssue));
  if (diff.addedClaimSignals.length) issues.push(issue("postedit_added_claim", "hard_failure", diff.addedClaimSignals.join(", ")));
  if (/(?:후보|원천 데이터|수집 결과|검수 결과|내부 기준|typed candidate|retrieval source)/iu.test(markdown)) issues.push(issue("postedit_report_language", "warning", "내부 작업 표현이 남음"));
  return issues;
}
function licenses(candidate: T01DataGatedContext["candidates"][number]): string[] { return Array.from(new Set((candidate as any).availableLicenses || [])).map(String); }
function issue(code: string, severity: T01QualityIssue["severity"], message: string): T01QualityIssue { return { code, severity, message }; }
