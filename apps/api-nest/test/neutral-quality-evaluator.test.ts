import { describe, expect, it } from "vitest";
import { neutralT01QualityIssues } from "../src/neutral-quality-evaluator.js";

const context: any = {
  targetRegion: "익산시", candidates: [{ academyId: "1", academyName: "테스트운전학원", storedRegion: "익산시", address: "익산시 테스트로 1", retrievalSource: "stored_region_like", straightLineDistanceKm: null, tuition: null, shuttle: null, operatingSchedule: null, passRate: null }],
};

describe("neutralT01QualityIssues", () => {
  it("does not treat confirmation questions or explicit missing facts as shuttle/pass-rate claims", () => {
    const text = "# 제목\n\n테스트운전학원\n\n셔틀 운행 여부와 합격률은 확인되지 않았으므로 상담에서 확인하세요. 셔틀 운행 지역은 어디인가요?\n\n| 후보 | 테스트운전학원 |";
    expect(neutralT01QualityIssues(text, context).filter((issue) => issue.severity === "hard_failure")).toEqual([]);
  });

  it("flags positive ungrounded shuttle and pass-rate claims", () => {
    const text = "# 제목\n\n테스트운전학원은 셔틀을 운행하며 합격률이 높습니다.\n\n| 후보 | 테스트운전학원 |";
    expect(neutralT01QualityIssues(text, context).map((issue) => issue.ruleId)).toEqual(expect.arrayContaining(["unverified_shuttle_claim", "unverified_pass_rate_claim"]));
  });
});
