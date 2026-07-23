import { describe, expect, it } from "vitest";
import { buildT01DataGatedContext, t01QualityIssues } from "../src/t01-data-gated.js";
import type { AcademySelectionTrace, AcademySelectionTraceCandidate } from "../src/academy-candidate-selection.js";

const target = "테스트시";

function candidate(name: string, externalId: string, fields: Record<string, unknown> = {}) {
  return {
    name, external_id: externalId, academy_type: "academy", region: target, address: `${target} ${name}로`, phone: "031-000-0000", ...fields,
  };
}

function traceCandidate(name: string, academyId: string, retrievalSource: AcademySelectionTraceCandidate["retrievalSource"], fields: Partial<AcademySelectionTraceCandidate> = {}): AcademySelectionTraceCandidate {
  return {
    academyId, academyName: name, storedRegion: target, address: `${target} ${name}로`, latitude: null, longitude: null,
    straightLineDistanceKm: null, retrievalSource, inclusionReason: retrievalSource === "stored_region_like" ? "region_like_query" : retrievalSource === "far_guarantee" ? "within_far_guarantee" : "within_nearby_radius", retrievalRank: 1,
    ...fields,
  };
}

function trace(entries: AcademySelectionTraceCandidate[]): AcademySelectionTrace {
  return {
    targetRegion: target, configuredMinimum: 2, candidatePoolLimit: 7, nearbyRadiusKm: 20, farRadiusKm: 50,
    regionLikeCandidates: entries.filter((entry) => entry.retrievalSource === "stored_region_like"),
    supplementCandidates: entries.filter((entry) => entry.retrievalSource === "supplement"),
    farCandidates: entries.filter((entry) => entry.retrievalSource === "far_guarantee"),
    duplicatesRemoved: [], excludedCandidates: [], mergedCandidatePool: entries,
  };
}

describe("T01 typed candidate adapter", () => {
  it("후보 선택 결과를 바꾸지 않고 source·stored region·missing field를 typed candidate에 보존한다", () => {
    const rows = [candidate("직접", "direct", { price: "500,000원" }), candidate("보충", "supplement", { region: "인접시", address: "인접시 보충로", shuttle: "역 셔틀" })];
    const selection = trace([
      traceCandidate("직접", "direct", "stored_region_like"),
      traceCandidate("보충", "supplement", "supplement", { storedRegion: "인접시", address: "인접시 보충로", straightLineDistanceKm: 12.3, retrievalRank: 2 }),
    ]);
    const context = buildT01DataGatedContext(target, rows, selection, "slot", ["비용절약", "셔틀편리"]);

    expect(context.candidates.map((item) => item.academyId)).toEqual(["direct", "supplement"]);
    expect(context.candidates[1]).toMatchObject({ retrievalSource: "supplement", storedRegion: "인접시", regionRelation: "other_region", straightLineDistanceKm: 12.3 });
    expect(context.candidates[0]?.missingFields).toContain("셔틀");
    expect(context.selectedVariant).toBe("distance_expanded_comparison");
    expect(context.modifiers.map((modifier) => [modifier.originalLabel, modifier.active])).toEqual([["비용절약", true], ["셔틀편리", true]]);
  });

  it("슬롯별 선택 수강생 리뷰 원문과 출처만 typed candidate에 보존한다", () => {
    const rows = [candidate("A", "a", { review_json: JSON.stringify([{ author: "홍길동", point: 5, date: "2026-07-01", content: "강사님 설명이 자세해서 안심됐습니다." }]) }), candidate("B", "b")];
    const selection = trace([traceCandidate("A", "a", "stored_region_like"), traceCandidate("B", "b", "stored_region_like", { retrievalRank: 2 })]);
    const context = buildT01DataGatedContext(target, rows, selection, "slot", []);
    expect(context.candidates[0]?.studentReviews).toEqual([{
      quote: "강사님 설명이 자세해서 안심됐습니다.", source: "운전면허PLUS 실제 수강생 리뷰",
    }]);
  });

  it("원천 SEO 설명에 명시된 면허 과정만 typed candidate와 공통 비교 필드에 보존한다", () => {
    const rows = [
      candidate("A", "a", { seo_description: "1종·2종 보통과 1종 대형 면허 취득 과정을 운영합니다.", seo_keywords: "생활권, 통학" }),
      candidate("B", "b", { seo_description: "1종 보통, 2종 보통 면허 취득 과정을 운영합니다.", seo_keywords: "1종 대형 가능" }),
    ];
    const selection = trace([traceCandidate("A", "a", "stored_region_like"), traceCandidate("B", "b", "stored_region_like", { retrievalRank: 2 })]);
    const context = buildT01DataGatedContext(target, rows, selection, "slot", []);
    expect(context.candidates.map((item) => item.availableLicenses)).toEqual([
      ["1종 보통", "2종 보통", "1종 대형"],
      ["1종 보통", "2종 보통"],
    ]);
    expect(context.commonFactFields).toContain("운영 과정");
    expect(context.candidates[1]?.availableLicenses).not.toContain("1종 대형");
  });

  it("근거 없는 legacy modifier는 typed context에서 비활성화하고 비활성 사유를 보존한다", () => {
    const rows = [candidate("A", "a"), candidate("B", "b")];
    const selection = trace([traceCandidate("A", "a", "stored_region_like"), traceCandidate("B", "b", "stored_region_like", { retrievalRank: 2 })]);
    const context = buildT01DataGatedContext(target, rows, selection, "slot", ["셔틀편리", "야간반"]);
    expect(context.modifiers).toMatchObject([
      { originalLabel: "셔틀편리", active: false, inactiveReason: "no_shuttle_facts" },
      { originalLabel: "야간반", active: false, inactiveReason: "no_structured_schedule_fact" },
    ]);
  });

  it("verified academy type이 둘이면 region-like와 criteria-first만 seed 경쟁 후보가 된다", () => {
    const rows = [candidate("A", "a", { academy_type: "academy" }), candidate("B", "b", { academy_type: "exam_academy" })];
    const selection = trace([traceCandidate("A", "a", "stored_region_like"), traceCandidate("B", "b", "stored_region_like", { retrievalRank: 2 })]);
    const variants = new Set<string>();
    for (let index = 0; index < 60; index++) variants.add(buildT01DataGatedContext(target, rows, selection, `seed-${index}`, []).selectedVariant);
    expect(variants).toEqual(new Set(["region_like_comparison", "criteria_first_grouped_comparison"]));
  });

  it("비교 공통 field가 부족하면 seed와 관계없이 insufficient variant를 선택한다", () => {
    const rows = [candidate("A", "a", { address: null, phone: null }), candidate("B", "b", { address: null, phone: null })];
    const selection = trace([traceCandidate("A", "a", "stored_region_like"), traceCandidate("B", "b", "stored_region_like", { retrievalRank: 2 })]);
    const context = buildT01DataGatedContext(target, rows, selection, "any-seed", []);
    expect(context.commonFactFields).toEqual(["운영 형태"]);
    expect(context.selectedVariant).toBe("insufficient_comparison");
  });

});

describe("T01 shared fact validation", () => {
  const rows = [candidate("직접", "direct", { price: "500,000원" }), candidate("보충", "supplement", { region: "인접시", address: "인접시 보충로" })];
  const context = buildT01DataGatedContext(target, rows, trace([
    traceCandidate("직접", "direct", "stored_region_like"),
    traceCandidate("보충", "supplement", "supplement", { storedRegion: "인접시", address: "인접시 보충로", straightLineDistanceKm: 12.3, retrievalRank: 2 }),
  ]), "slot", ["상담전확인"]);

  it("보충 후보의 실제 지역/확장 고지가 없으면 hard failure로 잡는다", () => {
    const markdown = "# 제목\n\n## 비교\n|항목|직접|보충|\n|---|---|---|\n|주소|테스트시|테스트시|\n\n### 직접\n설명\n\n### 보충\n설명";
    expect(t01QualityIssues(markdown, context)).toContainEqual(expect.objectContaining({ code: "non_primary_candidate_region_disclosure_missing", severity: "hard_failure" }));
  });

  it("직선거리를 도로거리/이동시간으로 표현하면 hard failure로 잡는다", () => {
    const markdown = "# 제목\n\n## 비교\n|항목|직접|보충|\n|---|---|---|\n|주소|테스트시|인접시|\n\n### 직접\n설명\n\n### 보충\n인접시 보충로의 주변 후보이며 약 12.3km 도로 거리입니다.";
    expect(t01QualityIssues(markdown, context)).toContainEqual(expect.objectContaining({ code: "straight_line_distance_misrepresented", severity: "hard_failure" }));
  });

  it("한 후보 이름이 다른 후보 이름에 포함돼도 H3 중복으로 오탐하지 않는다", () => {
    const names = ["양동상무자동차운전전문학원", "상무자동차운전전문학원"];
    const overlapContext = buildT01DataGatedContext(
      target,
      names.map((name, index) => candidate(name, `overlap-${index}`)),
      trace(names.map((name, index) => traceCandidate(name, `overlap-${index}`, "stored_region_like", { retrievalRank: index + 1 }))),
      "slot",
      [],
    );
    const markdown = "# 제목\n\n## 비교\n|항목|양동상무자동차운전전문학원|상무자동차운전전문학원|\n|---|---|---|\n|주소|테스트시|테스트시|\n\n### 양동상무자동차운전전문학원\n설명\n\n### 상무자동차운전전문학원\n설명";
    expect(t01QualityIssues(markdown, overlapContext).map((item) => item.code)).not.toContain("duplicate_candidate_heading");
  });

  it("표의 수강료 불일치와 근거 없는 셔틀·합격률·후기를 각각 hard failure로 구분한다", () => {
    const markdown = "# 제목\n\n## 비교\n|항목|직접|보충|\n|---|---|---|\n|수강료|600,000원|확인|\n|주소|테스트시|인접시|\n\n### 직접\n설명\n\n### 보충\n인접시 보충로의 주변 후보입니다. 셔틀 운행이 가능하고 합격률이 높다는 수강생 후기입니다.";
    const codes = t01QualityIssues(markdown, context).filter((issue) => issue.severity === "hard_failure").map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining(["comparison_table_tuition_mismatch", "unverified_shuttle_claim", "unverified_pass_rate_claim", "unverified_review_claim"]));
  });

  it("warning은 hard failure와 구분되고 거리 확장 설명이 충분하면 경고가 없다", () => {
    const markdown = "# 제목\n\n## 비교\n|항목|직접|보충|\n|---|---|---|\n|주소|테스트시|인접시|\n\n### 직접\n설명\n\n### 보충\n인접시 보충로에 있는 주변 후보입니다. 실제 이동 방법은 상담으로 확인하세요.";
    const issues = t01QualityIssues(markdown, context);
    expect(issues.some((issue) => issue.severity === "hard_failure")).toBe(false);
    expect(issues.some((issue) => issue.code === "distance_expansion_not_explained")).toBe(false);
  });

  it("문체 반복은 hard failure가 아닌 score penalty로 남긴다", () => {
    const markdown = "# 제목\n\n## 비교\n|항목|직접|보충|\n|---|---|---|\n|주소|테스트시|인접시|\n\n### 직접\n상담 때 확인하세요. 상담 때 확인하세요. 상담 때 확인하세요. 상담 때 확인하세요.\n\n### 보충\n인접시 보충로에 있는 주변 후보입니다.";
    expect(t01QualityIssues(markdown, context)).toContainEqual(expect.objectContaining({ code: "repeated_consultation_phrase", severity: "score_penalty" }));
  });

});
