import { describe, expect, it } from "vitest";
import { buildPosteditContext, posteditFactDiff, posteditPrompt, posteditQualityIssues } from "../src/t01-legacy-plus-postedit.js";

const data: any = { targetRegion: "테스트시", candidates: [{ academyId: "1", academyName: "첫학원", academyType: "academy", storedRegion: "테스트시", address: "테스트시 길", phone: "010", availableLicenses: ["1종 보통"], tuition: null, shuttle: null, operatingSchedule: null, regionRelation: "target_region" }], selectedVariant: "region_like_comparison", includeFaq: false };
const reviews: any[] = [{ academyId: "1", academyName: "첫학원", text: "실제 리뷰", source: { label: "운전면허PLUS 실제 수강생 리뷰" } }];
describe("Legacy Plus postedit fact lock", () => {
  it("학원별 review와 독자용 locked facts만 prompt에 전달한다", () => { const c=buildPosteditContext(data,reviews); expect(c.lockedFacts.selectedReviews.map(r=>r.academyId)).toEqual(["1"]); expect(posteditPrompt("초안",c)).toContain("LOCKED FACTS"); expect(posteditPrompt("초안",c)).not.toContain("retrievalSource"); });
  it("학원·소재지·면허 삭제와 review 변경을 critical로 잡는다", () => { const c=buildPosteditContext(data,reviews); const draft="첫학원 테스트시 길 1종 보통\n> 실제 리뷰 — 출처: 운전면허PLUS 실제 수강생 리뷰"; const diff=posteditFactDiff(draft,"# 제목\n첫학원",c); expect(diff.criticalFactLoss).toEqual(expect.arrayContaining(["location:1","license:1:1종 보통"])); expect(diff.reviewIssue).toBe("review_lock_violation"); expect(posteditQualityIssues("첫학원",draft,c).map(x=>x.code)).toContain("postedit_critical_fact_loss"); });
  it("사실 보존·한 건 review·출처는 통과한다", () => { const c=buildPosteditContext(data,reviews); const draft="첫학원 테스트시 길 1종 보통\n> 실제 리뷰 — 출처: 운전면허PLUS 실제 수강생 리뷰"; expect(posteditFactDiff(draft,draft,c).criticalFactLoss).toEqual([]); expect(posteditQualityIssues(draft,draft,c).map(x=>x.code)).not.toContain("postedit_review_lock"); });
});
