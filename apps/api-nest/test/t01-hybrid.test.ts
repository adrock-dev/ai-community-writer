import { describe, expect, it } from "vitest";
import type { AcademySelectionTrace, AcademySelectionTraceCandidate } from "../src/academy-candidate-selection.js";
import { buildT01DataGatedContext } from "../src/t01-data-gated.js";
import { buildT01HybridContext, dedupeHybridDecisionSupport, hybridDecisionSupportIssues, hybridFactsForPrompt, hybridReviewPromptInstruction, selectHybridReview, T01_HYBRID_MODE, t01HybridPromptContract, t01HybridQualityIssues } from "../src/t01-hybrid.js";

const target = "테스트시";

function row(name: string, id: string, fields: Record<string, unknown> = {}) {
  return { name, external_id: id, academy_type: "academy", region: target, address: `${target} ${name}로`, phone: "031-000-0000", ...fields };
}

function traceCandidate(name: string, academyId: string, retrievalSource: AcademySelectionTraceCandidate["retrievalSource"], fields: Partial<AcademySelectionTraceCandidate> = {}): AcademySelectionTraceCandidate {
  return { academyId, academyName: name, storedRegion: target, address: `${target} ${name}로`, latitude: null, longitude: null, straightLineDistanceKm: null, retrievalSource, inclusionReason: retrievalSource === "stored_region_like" ? "region_like_query" : "within_nearby_radius", retrievalRank: 1, ...fields };
}

function selection(entries: AcademySelectionTraceCandidate[]): AcademySelectionTrace {
  return { targetRegion: target, configuredMinimum: 2, candidatePoolLimit: 7, nearbyRadiusKm: 20, farRadiusKm: 50, regionLikeCandidates: entries.filter((entry) => entry.retrievalSource === "stored_region_like"), supplementCandidates: entries.filter((entry) => entry.retrievalSource === "supplement"), farCandidates: [], duplicatesRemoved: [], excludedCandidates: [], mergedCandidatePool: entries };
}

function context(seed = "hybrid-seed") {
  const rows = [
    row("첫학원", "a", { review_json: JSON.stringify([{ author: "홍길동", point: 5, date: "2026-07-01", content: "상담 설명이 자세해 수업 일정을 정하는 데 도움이 됐습니다." }]) }),
    row("둘학원", "b", { review_json: JSON.stringify([{ author: "김", point: 4, date: "2026-07-02", content: "강사님 안내가 차분해서 초보자도 따라가기 편했습니다." }]) }),
  ];
  const base = buildT01DataGatedContext(target, rows, selection([traceCandidate("첫학원", "a", "stored_region_like"), traceCandidate("둘학원", "b", "stored_region_like", { retrievalRank: 2 })]), seed, ["상담전확인"]);
  return buildT01HybridContext(base, seed);
}

describe("T01 hybrid representative review", () => {
  it("후보별 리뷰가 있어도 글 전체에서 결정적으로 한 개만 선택한다", () => {
    const first = context();
    const second = context();
    expect(first.mode).toBe(T01_HYBRID_MODE);
    expect(first.selectedReview).toEqual(second.selectedReview);
    expect(first.selectedReview).toMatchObject({ source: { label: "DrivingPlus 수강생 리뷰", url: null, identifier: null }, eligibleForContent: true });
    expect(first.selectedReview?.academyId).toBeTruthy();
  });

  it("source가 없거나 개인정보·광고성만 있는 리뷰는 콘텐츠 후보에서 제외한다", () => {
    const candidate = context().data.candidates[0]!;
    const noReview = { ...candidate, studentReviews: [] };
    expect(selectHybridReview([noReview], "seed")).toBeNull();
    const unsafe = { ...candidate, studentReviews: [{ quote: "010-1234-5678로 연락하세요. 무조건 최고 강력 추천", source: "DrivingPlus 수강생 리뷰" as const }] };
    expect(selectHybridReview([unsafe], "seed")).toBeNull();
  });

  it("hybrid prompt에는 대표 리뷰만 전달하고 작성자·평점·날짜·거리 내부값을 노출하지 않는다", () => {
    const hybrid = context();
    const prompt = t01HybridPromptContract(hybrid);
    expect(prompt).toContain("대표수강생리뷰");
    expect(prompt).toContain("DrivingPlus 수강생 리뷰");
    expect(prompt).not.toContain('"작성자"');
    expect(prompt).not.toContain('"평점"');
    expect(prompt).not.toContain("straightLineDistanceKm");
    expect(hybridReviewPromptInstruction(hybrid)).toContain("정확히 한 건");
  });

  it("hybrid facts에서는 학원별 리뷰와 블로그 후기 재료를 제거한다", () => {
    const facts = "A학원: 주소 / 수강생 리뷰: “후기” (출처: DrivingPlus 수강생 리뷰) / 긍정 블로그 리뷰글 보충자료: 후기 흐름\n후기 문구 보유 후보: 1곳\nB학원: 주소";
    const hybridFacts = hybridFactsForPrompt(facts);
    expect(hybridFacts).toContain("A학원: 주소");
    expect(hybridFacts).toContain("B학원: 주소");
    expect(hybridFacts).not.toContain("수강생 리뷰");
    expect(hybridFacts).not.toContain("블로그 리뷰");
  });

  it("원천과 연결된 하나의 인용·출처는 통과하고, 둘 이상의 인용·메타데이터 노출은 실패한다", () => {
    const hybrid = context();
    const review = hybrid.selectedReview!;
    const valid = `# 제목\n\n## 비교\n|항목|첫학원|둘학원|\n|---|---|---|\n|주소|${target}|${target}|\n\n### ${review.academyName}\n설명\n“${review.text}”\n\n출처: ${review.source.label}\n\n### 다른 학원\n설명\n\n## 체크리스트\n- 수강료를 문의하세요.`;
    expect(t01HybridQualityIssues(valid, hybrid).filter((issue) => issue.code.startsWith("hybrid_review"))).toEqual([]);
    const invalid = valid.replace(`출처: ${review.source.label}`, `출처: ${review.source.label}\n> ${review.text}\n작성자: 누구`);
    const codes = t01HybridQualityIssues(invalid, hybrid).map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining(["hybrid_review_count", "hybrid_review_metadata_exposed"]));
  });

  it("수강료 숫자가 없는 과정 표의 1종 표기를 가격 오탐으로 처리하지 않는다", () => {
    const hybrid = context();
    const markdown = `## 비교표\n| 후보 | 운영 과정 | 상담 전 확인 |\n|---|---|---|\n| 첫학원 | 1종 보통 | 수강료와 교육시간 |\n| 둘학원 | 2종 보통 | 수강료와 추가 비용 |`;
    expect(t01HybridQualityIssues(markdown, hybrid).some((issue) => issue.code === "comparison_table_tuition_mismatch")).toBe(false);
  });
});

describe("T01 hybrid FAQ/checklist semantic dedupe", () => {
  it("표현이 달라도 같은 셔틀 확인 행동은 warning으로 잡는다", () => {
    const markdown = `## 등록 전 체크리스트\n- 셔틀 운행 여부와 노선을 문의하세요.\n\n## 자주 묻는 질문\n### Q. 셔틀버스는 운행하나요?\n학원에 문의해야 합니다.`;
    expect(hybridDecisionSupportIssues(markdown)).toContainEqual(expect.objectContaining({ code: "hybrid_faq_checklist_semantic_overlap", severity: "warning" }));
  });

  it("같은 topic이지만 주변 후보 포함 이유를 설명하는 FAQ는 checklist와 공존할 수 있다", () => {
    const markdown = `## 등록 전 체크리스트\n- 셔틀 노선을 확인하세요.\n\n## FAQ\n### Q. 주변 지역 학원을 함께 비교한 이유는 무엇인가요?\n지역 내 후보가 적을 때 선택 범위를 설명합니다.`;
    expect(hybridDecisionSupportIssues(markdown).some((issue) => issue.code === "hybrid_faq_checklist_semantic_overlap")).toBe(false);
  });

  it("상담 내용을 기록하는 행동을 상담 문의로 오인하지 않고 H3 FAQ도 읽는다", () => {
    const markdown = `## 등록 전 체크리스트\n- 수강료에 포함된 항목과 추가 비용을 확인한다.\n- 상담받은 내용을 학원명·과정·비용·일정으로 나눠 기록한다.\n\n### 자주 생기는 추가 질문\n#### Q. 주변 지역 학원을 함께 비교한 이유는 무엇인가요?\n비교 범위를 설명합니다.`;
    const result = hybridDecisionSupportIssues(markdown);
    expect(result.some((issue) => issue.code === "hybrid_checklist_semantic_overlap")).toBe(false);
    expect(result.some((issue) => issue.code === "hybrid_empty_faq")).toBe(false);
  });

  it("생성 뒤 checklist/FAQ의 같은 확인 행동을 결정적으로 제거한다", () => {
    const markdown = `## 체크리스트\n- 셔틀 운행 여부와 노선을 문의하세요.\n- 셔틀이 있다면 노선과 시간을 학원에 확인하세요.\n\n### 자주 생기는 추가 질문\n**셔틀버스는 운행하나요?**\n학원에 문의해야 합니다.\n\n**주변 지역 후보를 함께 보는 이유는 무엇인가요?**\n비교 범위를 설명합니다.`;
    const deduped = dedupeHybridDecisionSupport(markdown);
    expect((deduped.match(/셔틀/g) || []).length).toBe(1);
    expect(deduped).toContain("주변 지역 후보를 함께 보는 이유");
    expect(hybridDecisionSupportIssues(deduped).some((issue) => issue.code.includes("semantic_overlap"))).toBe(false);
  });

  it("빈 FAQ와 정확히 반복된 decision-support 문장은 hard failure로 잡는다", () => {
    expect(hybridDecisionSupportIssues("## FAQ\n")).toContainEqual(expect.objectContaining({ code: "hybrid_empty_faq", severity: "hard_failure" }));
    const repeated = `## 체크리스트\n- 수강료를 문의하세요.\n\n## FAQ\n- 수강료를 문의하세요.`;
    expect(hybridDecisionSupportIssues(repeated)).toContainEqual(expect.objectContaining({ code: "hybrid_decision_support_exact_duplicate", severity: "hard_failure" }));
  });
});
