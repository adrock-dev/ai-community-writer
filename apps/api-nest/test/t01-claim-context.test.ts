import { describe, expect, it } from "vitest";
import { T01_FACT_VALIDATION_CONTEXT, t01ClaimContexts, t01QualityIssues } from "../src/t01-data-gated.js";
import type { T01DataGatedContext } from "../src/t01-data-gated.js";

function context(facts: { shuttle?: string; passRate?: string } = {}): T01DataGatedContext {
  return {
    mode: T01_FACT_VALIDATION_CONTEXT,
    targetRegion: "테스트시",
    selection: { configuredMinimum: 2, candidatePoolLimit: 7, nearbyRadiusKm: 20, farRadiusKm: 50, regionLikeCount: 2, supplementCount: 0, farCount: 0, finalBodyCount: 2 },
    candidates: ["A", "B"].map((academyName, index) => ({
      academyId: String(index + 1), academyName, academyType: "academy", storedRegion: "테스트시", address: `테스트시 ${academyName}로`,
      latitude: null, longitude: null, straightLineDistanceKm: null, retrievalSource: "stored_region_like", inclusionReason: "region_like_query", retrievalRank: index + 1,
      regionRelation: "target_region", tuition: null, shuttle: facts.shuttle ?? null, operatingSchedule: null, passRate: facts.passRate ?? null,
      phone: null, reviewEvidencePresent: false, studentReviews: [], missingFields: [],
    })),
    selectedVariant: "region_like_comparison",
    compatibleVariants: ["region_like_comparison"],
    commonFactFields: ["주소"],
    modifiers: [],
    includeFaq: false,
  };
}

function claimCodes(markdown: string, facts: { shuttle?: string; passRate?: string } = {}): string[] {
  return t01QualityIssues(markdown, context(facts)).map((issue) => issue.code);
}

const actualFalsePositiveFixtures = [
  { id: "iksan-shuttle", topic: "shuttle" as const, candidateId: 120, sentence: "셔틀 운행 여부, 운행 지역, 승하차 장소와 예약 방법", supportingFact: null, prior: "hard_failure", expected: "pass", reason: "운행 여부를 확인할 체크 항목" },
  { id: "iksan-pass-rate", topic: "pass_rate" as const, candidateId: 120, sentence: "다만 수강료·셔틀·운영시간·합격률은 확인되지 않았으므로 상담 때 총비용과 교육 일정을 구체적으로 물어보세요.", supportingFact: null, prior: "hard_failure", expected: "pass", reason: "합격률 자료 부재와 상담 권고" },
  { id: "donghae-shuttle", topic: "shuttle" as const, candidateId: 431, sentence: "다만 셔틀 운행 지역과 시간, 수강료, 운영시간, 합격률은 공개된 확인 자료에 없으므로 상담 때 별도로 물어봐야 합니다.", supportingFact: null, prior: "hard_failure", expected: "pass", reason: "셔틀 세부 정보가 없다는 설명" },
  { id: "donghae-pass-rate", topic: "pass_rate" as const, candidateId: 431, sentence: "수강료·셔틀·운영시간·합격률은 확인된 자료에 없으므로 숫자나 유리한 조건으로 비교하지 않았습니다.", supportingFact: null, prior: "hard_failure", expected: "pass", reason: "합격률을 비교하지 않았다는 자료 부재 설명" },
  { id: "goseong-shuttle", topic: "shuttle" as const, candidateId: 381, sentence: "실제 도로 주행거리, 차량 이동시간, 대중교통 이용 편의, 셔틀 운행 여부를 뜻하지 않으므로 상담 전 출발지 기준으로 다시 확인해야 합니다.", supportingFact: null, prior: "hard_failure", expected: "pass", reason: "직선거리의 한계와 셔틀 미확인 문맥" },
  { id: "goseong-pass-rate", topic: "pass_rate" as const, candidateId: 381, sentence: "확인된 자료에는 두 학원의 수강료, 셔틀, 운영시간, 합격률이 포함되어 있지 않습니다.", supportingFact: null, prior: "hard_failure", expected: "pass", reason: "합격률 자료가 없다는 명시" },
  { id: "wonju-shuttle", topic: "shuttle" as const, candidateId: 355, sentence: "거주지 또는 통학지 기준 셔틀 운행 여부와 정류 위치", supportingFact: null, prior: "hard_failure", expected: "pass", reason: "등록 전 확인 목록" },
  { id: "wonju-pass-rate", topic: "pass_rate" as const, candidateId: 355, sentence: "수강료, 셔틀, 운영시간, 합격률은 제공 자료에 없어 비교표에서 임의로 채우지 않았으며, 상담 시 동일한 질문으로 확인하는 항목으로 남겨 두었습니다.", supportingFact: null, prior: "hard_failure", expected: "pass", reason: "합격률을 임의로 작성하지 않았다는 설명" },
];

describe("T01 claim-context detector", () => {
  it("저장된 네 pair의 실제 false positive 문장 8개를 assertion으로 오인하지 않는다", () => {
    expect(actualFalsePositiveFixtures).toHaveLength(8);
    for (const fixture of actualFalsePositiveFixtures) {
      const contexts = t01ClaimContexts(fixture.sentence, fixture.topic);
      expect(contexts, fixture.id).not.toHaveLength(0);
      expect(contexts.some((item) => item.isFactualAssertion), fixture.id).toBe(false);
      const codes = claimCodes(fixture.sentence);
      const hardCode = fixture.topic === "shuttle" ? "unverified_shuttle_claim" : "unverified_pass_rate_claim";
      expect(codes, fixture.id).not.toContain(hardCode);
    }
  });

  it("셔틀의 긍정 사실, 안전 문맥, 가능성 암시를 구분한다", () => {
    expect(claimCodes("A학원은 셔틀버스를 운행합니다.")).toContain("unverified_shuttle_claim");
    expect(claimCodes("A학원은 셔틀버스를 운행합니다.", { shuttle: "역 셔틀" })).not.toContain("unverified_shuttle_claim");
    expect(claimCodes("셔틀 운행 여부는 확인이 필요합니다.")).not.toContain("unverified_shuttle_claim");
    expect(claimCodes("등록 전 학원에 셔틀 노선과 시간을 문의하세요.")).not.toContain("unverified_shuttle_claim");
    expect(claimCodes("셔틀은 운영하지 않는다고 안내받았습니다.")).not.toContain("unverified_shuttle_claim");
    expect(claimCodes("셔틀이 운행되나요?")).not.toContain("unverified_shuttle_claim");
    expect(claimCodes("리뷰가 현재 수업 품질이나 셔틀 운행을 보장하는 것은 아니므로 상담에서 확인하세요.")).not.toContain("unverified_shuttle_claim");
    expect(claimCodes("거주지 주변까지 셔틀이 운행되는지와 정류 위치를 묻기")).not.toContain("unverified_shuttle_claim");
    const conditionalAdvice = "셔틀을 운영한다면 신용동 또는 내 거주지 인근 정류장이 있는지 상담 때 확인해야 합니다.";
    expect(claimCodes(conditionalAdvice)).not.toContain("unverified_shuttle_claim");
    expect(t01ClaimContexts(conditionalAdvice, "shuttle")[0]).toMatchObject({ epistemicStatus: "verification_required", claimType: "verification_advice" });
    expect(claimCodes("셔틀을 운영하는지, 운영한다면 출발지 주변 정류장과 운행 시간을 확인하세요.")).not.toContain("unverified_shuttle_claim");
    expect(claimCodes("학원별 교육비와 셔틀 운영은 해당 학원에 직접 문의해야 합니다.")).not.toContain("unverified_shuttle_claim");
    expect(claimCodes("셔틀 이용이 가능할 수 있으니 확인해보세요.")).toContain("unverified_shuttle_implication");
    expect(claimCodes("이 학원은 셔틀을 운영하므로 자세한 시간은 확인하세요.")).toContain("unverified_shuttle_claim");
  });

  it("입력에 있는 원문·출처 수강생 리뷰의 과거 셔틀 언급은 현재 셔틀 주장으로 오인하지 않는다", () => {
    const review = "셔틀을 운영해서 학원 오가는데 편했고 선생님들이 친절하셨어요.";
    const suppliedContext = context();
    suppliedContext.candidates[0]!.studentReviews = [{ quote: review, source: "운전면허PLUS 실제 수강생 리뷰" }];
    const markdown = `> “${review}” — 출처: 운전면허PLUS 실제 수강생 리뷰 · 평점: 5/5`;
    expect(t01QualityIssues(markdown, suppliedContext).map((item) => item.code)).not.toContain("unverified_shuttle_claim");
    expect(claimCodes(`> “${review}” — 출처: 운전면허PLUS 실제 수강생 리뷰 · 평점: 5/5`)).toContain("unverified_shuttle_claim");
  });

  it("합격률의 긍정 사실, 안전 문맥, 일반 조언을 구분한다", () => {
    expect(claimCodes("A학원은 합격률이 높은 학원입니다.")).toContain("unverified_pass_rate_claim");
    expect(claimCodes("A학원의 합격률은 92%입니다.")).toContain("unverified_pass_rate_claim");
    expect(claimCodes("A학원은 합격률이 높은 학원입니다.", { passRate: "92%" })).not.toContain("unverified_pass_rate_claim");
    expect(claimCodes("공식 합격률은 제공된 자료에서 확인할 수 없습니다.")).not.toContain("unverified_pass_rate_claim");
    expect(claimCodes("합격률이 높다고 단정하기는 어렵습니다.")).not.toContain("unverified_pass_rate_claim");
    expect(claimCodes("합격 가능성은 개인별 연습 정도에 따라 달라집니다.")).not.toContain("unverified_pass_rate_claim");
    expect(claimCodes("합격 가능성이 높을 수 있으니 문의해보세요.")).toContain("unverified_pass_rate_implication");
    expect(claimCodes("합격률이 높은 학원이니 공식 자료도 확인하세요.")).toContain("unverified_pass_rate_claim");
  });
});
