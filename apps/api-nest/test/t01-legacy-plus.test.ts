import { describe, expect, it } from "vitest";
import type { AcademySelectionTrace, AcademySelectionTraceCandidate } from "../src/academy-candidate-selection.js";
import { buildT01DataGatedContext } from "../src/t01-data-gated.js";
import { buildT01LegacyPlusContext, dedupeLegacyPlusDecisionSupport, finalizeLegacyPlusMarkdown, isLockedLegacyPlusReviewOnlyClicheIssue, isT01TemplateFamily, legacyPlusAcademyPrinciples, legacyPlusArticlePatternGuide, legacyPlusComparisonPlan, legacyPlusDesignGuide, legacyPlusFactsForPrompt, legacyPlusStructureGuide, legacyPlusTemplateDirection, legacyPlusWritingGuide, resolveT01GenerationMode, shouldUseT01LegacyPlusMode, T01_LEGACY_PLUS_MODE, t01LegacyPlusPromptContract, t01LegacyPlusQualityIssues, truncateLegacyPlusReview } from "../src/t01-legacy-plus.js";
import { buildPrompt } from "../src/worker.service.js";
import { getArchetype } from "../src/archetypes.js";

const target = "테스트시";
function row(name: string, id: string, fields: Record<string, unknown> = {}) {
  return { name, external_id: id, academy_type: "academy", region: target, address: `${target} ${name}로`, phone: "031-000-0000", ...fields };
}
function traceCandidate(name: string, id: string, retrievalSource: AcademySelectionTraceCandidate["retrievalSource"] = "stored_region_like", fields: Partial<AcademySelectionTraceCandidate> = {}): AcademySelectionTraceCandidate {
  return { academyId: id, academyName: name, storedRegion: target, address: `${target} ${name}로`, latitude: null, longitude: null, straightLineDistanceKm: null, retrievalSource, inclusionReason: retrievalSource === "stored_region_like" ? "region_like_query" : "within_nearby_radius", retrievalRank: 1, ...fields };
}
function context(seed = "legacy-plus-seed") {
  const rows = [
    row("첫학원", "a", { review_json: JSON.stringify([{ author: "홍길동", point: 5, date: "2026-07-01", content: "상담 설명이 자세해 수업 일정을 정하는 데 도움이 됐습니다." }]) }),
    row("둘학원", "b", { review_json: JSON.stringify([{ author: "김", point: 4, date: "2026-07-02", content: "강사님 안내가 차분해서 초보자도 따라가기 편했습니다." }]) }),
  ];
  const entries = [traceCandidate("첫학원", "a"), traceCandidate("둘학원", "b", "stored_region_like", { retrievalRank: 2 })];
  const trace: AcademySelectionTrace = { targetRegion: target, configuredMinimum: 2, candidatePoolLimit: 7, nearbyRadiusKm: 20, farRadiusKm: 50, regionLikeCandidates: entries, supplementCandidates: [], farCandidates: [], duplicatesRemoved: [], excludedCandidates: [], mergedCandidatePool: entries };
  return buildT01LegacyPlusContext(buildT01DataGatedContext(target, rows, trace, seed, ["상담전확인"]), seed);
}

describe("T01 Legacy Plus", () => {
  it("T01 계보에서만 선택되고 auto는 T01 계보를 Legacy Plus로 해석한다", () => {
    expect(shouldUseT01LegacyPlusMode("T01", T01_LEGACY_PLUS_MODE)).toBe(true);
    expect(shouldUseT01LegacyPlusMode("T01", "legacy")).toBe(false);
    expect(shouldUseT01LegacyPlusMode("T14", T01_LEGACY_PLUS_MODE)).toBe(false);
    expect(isT01TemplateFamily("C123", "T01")).toBe(true);
    expect(shouldUseT01LegacyPlusMode("C123", T01_LEGACY_PLUS_MODE, "T01")).toBe(true);
    expect(resolveT01GenerationMode("auto", "T01")).toBe(T01_LEGACY_PLUS_MODE);
    expect(resolveT01GenerationMode("auto", "C123", "T01")).toBe(T01_LEGACY_PLUS_MODE);
    expect(resolveT01GenerationMode("auto", "T14")).toBe("legacy");
    expect(resolveT01GenerationMode("legacy", "T01")).toBe("legacy");
  });

  it("후보 학원별로 eligible review를 하나씩 결정적으로 선택하고 prompt에는 privacy metadata를 넣지 않는다", () => {
    const first = context(); const second = context();
    expect(first.selectedReviews).toEqual(second.selectedReviews);
    expect(first.selectedReviews).toHaveLength(2);
    expect(first.selectedReviews.map((review) => review.academyId)).toEqual(["a", "b"]);
    expect(first.selectedReviews).toContainEqual(expect.objectContaining({ source: expect.objectContaining({ label: "DrivingPlus 수강생 리뷰" }), eligibleForContent: true }));
    const prompt = t01LegacyPlusPromptContract(first);
    expect(prompt).toContain("생성 뒤 원천 원문과 출처로 학원별 한 건씩 연결된다");
    expect(prompt).not.toContain("DrivingPlus 수강생 리뷰");
    expect(prompt).not.toContain("출처: 제공된 서비스명");
    expect(prompt).not.toContain("홍길동");
    expect(prompt).not.toContain("2026-07-01");
    expect(prompt).not.toContain("retrievalSource");
    expect(prompt).not.toContain("straightLineDistanceKm");
  });

  it("Legacy Plus 계약은 주소를 기본 정보로 보존하면서 면허·운영 차이를 비교 중심으로 둔다", () => {
    const plus = context();
    const prompt = t01LegacyPlusPromptContract(plus);
    expect(prompt).toContain("면허 취득 준비자가 자기 상황에 맞는 학원을 비교하는 데 있다");
    expect(prompt).toContain("주소·전화는 학원별 기본 정보로 한 번씩 명확히 적되");
    expect(prompt).toContain("전체 주소·전화번호를 기본 열로 쓰지 않으며");
    expect(prompt).toContain("짧은 기본 정보 불릿");
    expect(prompt).toContain("별도 후보군이나 섹션으로 나누지 않는다");
    expect(prompt).not.toContain("주변 지역 후보가 있으면");
    expect(prompt).not.toContain("표에 우선 쓸 공통 정보: 주소");
  });

  it("reader-flow 옵션은 Legacy Plus에만 주소·동선 중심 원본 지침을 대체하고 기본 Legacy 지침은 유지한다", () => {
    const slot = { template_id: "T01", region: target, primary_keyword: `${target} 운전면허학원`, slot_id: "reader-flow", modifier_1: "가까운", modifier_2: "상담전확인" };
    const standard = buildPrompt({ display_name: "테스트" }, slot, "facts", "comparison", getArchetype("local"), "", true);
    const plus = buildPrompt({ display_name: "테스트" }, slot, "facts", "comparison", getArchetype("local"), "", true, undefined, {
      structureGuide: legacyPlusStructureGuide(),
      writingGuide: legacyPlusWritingGuide(),
      articlePatternGuide: legacyPlusArticlePatternGuide(),
      designGuide: legacyPlusDesignGuide(),
      readerFlow: true,
      modifierLabels: ["상담전확인"],
    });
    expect(standard).toContain("위치/동선, 추천 대상");
    expect(standard).toContain("수식어: 가까운, 상담전확인");
    expect(plus).toContain("독자 질문 → 학원별 차이 → 객관 정보 → 선택 도움");
    expect(plus).toContain("주소를 후보 소개의 첫 문장·추천 이유·비교표의 중심 열로 삼지 않는다");
    expect(plus).toContain("짧은 기본 정보 불릿");
    expect(plus).not.toContain("위치/동선, 추천 대상");
    expect(plus).not.toContain("지역 생활권과 출퇴근/통학 동선을 짚고");
    expect(plus).not.toContain("지역 기준 거리를 비교표에 반영");
    expect(plus).toContain("생활권·동선·통학을 새 비교축이나 후보의 장점으로 만들지 않는다");
    expect(plus).toContain("수식어: 상담전확인");
  });

  it("Legacy Plus 전용 구조·작성법은 자연스러운 Legacy 흐름을 유지하고 이동 제약은 페르소나 조건으로만 허용한다", () => {
    expect(legacyPlusStructureGuide()).toContain("면허 과정");
    expect(legacyPlusStructureGuide()).not.toContain("생활권");
    expect(legacyPlusWritingGuide()).toContain("실제 수강생 리뷰");
    expect(legacyPlusWritingGuide()).toContain("기계적으로 같게 맞추지 않는다");
    expect(legacyPlusWritingGuide()).toContain("페르소나가 이동 조건을 명시할 때만");
    expect(legacyPlusArticlePatternGuide()).toContain("자연스러운 서술");
  });

  it("이동 제약이 명시된 페르소나에서는 생활권·동선을 확인 조건으로만 허용한다", () => {
    const slot = { template_id: "T01", region: target, primary_keyword: `${target} 운전면허학원`, slot_id: "commute-reader-flow", persona: "직장 출퇴근과 통학 시간을 함께 고려하는 면허 준비자" };
    const prompt = buildPrompt({ display_name: "테스트" }, slot, "facts", "comparison", getArchetype("local"), "", true, undefined, {
      structureGuide: legacyPlusStructureGuide(),
      writingGuide: legacyPlusWritingGuide(),
      articlePatternGuide: legacyPlusArticlePatternGuide(),
      designGuide: legacyPlusDesignGuide(),
      readerFlow: true,
    });
    expect(prompt).toContain("페르소나에 명시된 이동 조건은 독자가 등록 전 확인할 조건으로 제한해 자연스럽게 쓸 수 있다");
    expect(prompt).toContain("주소만으로 특정 학원의 통학 편의·접근성·가까움을 단정하지 않는다");
    expect(prompt).not.toContain("통학하기 편하다");
  });

  it("review가 없는 경우 review 및 출처를 만들지 않도록 계약한다", () => {
    const base = context();
    const noReview = { ...base, data: { ...base.data, candidates: base.data.candidates.map((candidate) => ({ ...candidate, studentReviews: [] })) }, selectedReviews: [] };
    expect(t01LegacyPlusPromptContract(noReview)).toContain("후기·출처·체험담을 만들지 않는다");
    const markdown = "## 비교표\n| 항목 | 첫학원 | 둘학원 |\n|---|---|---|\n| 주소 | 테스트시 | 테스트시 |\n\n### 첫학원\n설명\n> 만들어진 후기\n출처: DrivingPlus 수강생 리뷰";
    expect(t01LegacyPlusQualityIssues(markdown, noReview).map((issue) => issue.code)).toContain("legacy_plus_unverified_review_claim");
    const clean = finalizeLegacyPlusMarkdown("### 첫학원\n면허 과정을 확인하세요.\n\n### 둘학원\n운영 형태를 확인하세요.", noReview);
    expect(clean).not.toContain("DrivingPlus 수강생 리뷰");
    expect(t01LegacyPlusQualityIssues(clean, noReview).map((issue) => issue.code)).not.toContain("legacy_plus_review_count");
  });

  it("모델이 쓴 상투적 독자 호칭만 자연스러운 표현으로 정리하고 원천 리뷰는 바꾸지 않는다", () => {
    const plus = context();
    const source = "### 첫학원\n여러분은 운영 과정을 먼저 비교해 보세요.\n\n### 둘학원\n여러분의 일정에 맞는지 확인해 보세요.";
    const result = finalizeLegacyPlusMarkdown(source, plus);
    expect(result).not.toContain("여러분");
    expect(result).toContain("운전면허를 준비하는 분은");
    expect(result).toContain("운전면허를 준비하는 분의");

    const reviewWithAudienceAddress = {
      ...plus,
      selectedReviews: [{ ...plus.selectedReviews[0]!, text: "여러분에게 도움이 됐다는 수강생 경험입니다." }],
    };
    const reviewResult = finalizeLegacyPlusMarkdown("### 첫학원\n설명\n\n### 둘학원\n설명", reviewWithAudienceAddress);
    expect(reviewResult).toContain("> 여러분에게 도움이 됐다는 수강생 경험입니다. — 출처: DrivingPlus 수강생 리뷰");
  });

  it("원천 리뷰 인용 안에만 있는 상투 표현은 무시하지만 생성 본문에 있으면 계속 차단한다", () => {
    const plus = context();
    const review = { ...plus.selectedReviews[0]!, text: "여러분께 도움이 됐다는 실제 수강생 경험입니다." };
    const withReview = { ...plus, selectedReviews: [review] };
    const quoteOnly = `### 첫학원\n설명\n> ${review.text} — 출처: ${review.source.label}\n\n### 둘학원\n설명`;
    expect(isLockedLegacyPlusReviewOnlyClicheIssue("ai_cliche_expressions_여러분", quoteOnly, withReview)).toBe(true);
    expect(isLockedLegacyPlusReviewOnlyClicheIssue("ai_cliche_expressions_여러분", `${quoteOnly}\n여러분은 확인하세요.`, withReview)).toBe(false);
    expect(isLockedLegacyPlusReviewOnlyClicheIssue("ai_cliche_expressions_여러분", `### 첫학원\n> 여러분께 도움이 됐다는 임의 문장입니다.`, withReview)).toBe(false);
  });

  it("legacy facts의 후보별 review/theme만 제거하고 나머지 서술 재료는 유지한다", () => {
    const facts = "후기 문구 보유 후보: 2곳\n[1] 첫학원 / 주소: 테스트시 / 수강생 리뷰: ‘후기’ (출처: DrivingPlus 수강생 리뷰) / 긍정 블로그 리뷰글 보충자료: 후기 흐름\n[2] 둘학원 / 주소: 테스트시";
    const result = legacyPlusFactsForPrompt(facts);
    expect(result).toContain("첫학원 / 주소: 테스트시");
    expect(result).toContain("둘학원 / 주소: 테스트시");
    expect(result).not.toContain("수강생 리뷰");
    expect(result).not.toContain("블로그 리뷰");
  });

  it("원천 SEO 설명의 면허 과정은 비교용으로 정규화하고 주소보다 먼저 전달한다", () => {
    const facts = "[1] 첫학원 / 주소: 테스트시 첫학원로 / SEO 설명: 첫학원은 1종·2종 보통, 1종 대형 면허 취득 과정을 운영합니다. / SEO 키워드: 테스트시, 생활권 / 운영 형태: 자동차운전전문학원 / 전화: 031-000-0000";
    const result = legacyPlusFactsForPrompt(facts);
    expect(result).toContain("운영 과정: 1종 보통, 2종 보통, 1종 대형");
    expect(result.indexOf("운영 과정")).toBeLessThan(result.indexOf("주소"));
    expect(result).not.toContain("SEO 설명");
    expect(result).not.toContain("SEO 키워드");
  });

  it("모든 후보의 면허 과정이 있으면 Legacy Plus는 과정 정보를 비교 재료로 쓰되 도입과 모든 후보 소개를 강제하지 않는다", () => {
    const base = context();
    const data = { ...base.data, candidates: base.data.candidates.map((candidate, index) => ({ ...candidate, availableLicenses: index ? ["1종 보통", "2종 보통", "1종 대형"] : ["1종 보통", "2종 보통"] })) };
    const plus = { ...base, data };
    expect(legacyPlusComparisonPlan(plus).focus).toBe("license_course");
    expect(legacyPlusStructureGuide(plus)).toContain("운영 과정");
    expect(legacyPlusComparisonPlan(plus).directive).toContain("자연스럽게 연결될 때만");
    expect(legacyPlusComparisonPlan(plus).directive).not.toContain("도입·비교표·학원별 첫 문장");
    expect(legacyPlusTemplateDirection(plus)).toContain("BEST 표기는 유지");
    expect(legacyPlusAcademyPrinciples()).toContain("주소·전화는 학원을 식별하는 기본 정보");
  });

  it("Legacy Plus는 공통 T01의 주소 우선·인근 후보군 지침을 대체하되 과정 중심 문장 구조를 강제하지 않는다", () => {
    const base = context();
    const data = {
      ...base.data,
      candidates: base.data.candidates.map((candidate) => ({ ...candidate, availableLicenses: ["1종 보통", "2종 보통"] })),
    };
    const plus = { ...base, data };
    const slot = { template_id: "T01", region: target, primary_keyword: `${target} 운전면허학원`, slot_id: "course-flow" };
    const prompt = buildPrompt({ display_name: "테스트" }, slot, "facts", "comparison", getArchetype("local"), legacyPlusTemplateDirection(plus), true, undefined, {
      structureGuide: legacyPlusStructureGuide(plus),
      writingGuide: legacyPlusWritingGuide(plus),
      articlePatternGuide: legacyPlusArticlePatternGuide(plus),
      designGuide: legacyPlusDesignGuide(),
      academyPrinciples: legacyPlusAcademyPrinciples(),
      readerFlow: true,
    });
    expect(prompt).toContain("SEO 제목의 BEST 표기는 유지");
    expect(prompt).toContain("모든 도입의 고정 주제로 삼지 않는다");
    expect(prompt).toContain("후보별 첫 문장과 문단 순서를 기계적으로 같게 맞추지 않는다");
    expect(prompt).not.toContain("취득하려는 면허 과정의 차이에서 시작한다");
    expect(prompt).not.toContain("주소가 주제 지역과 일치하는 후보를 먼저 소개한다");
    expect(prompt).not.toContain("인근/주변 후보를 별도 섹션으로 분리한다");
  });

  it("면허 과정이 희소하면 위치 비교로 바꾸지 않고 짧은 객관 정보 구도를 선택한다", () => {
    const base = context();
    const data = { ...base.data, candidates: base.data.candidates.map((candidate) => ({ ...candidate, availableLicenses: [] })) };
    expect(legacyPlusComparisonPlan({ ...base, data }).focus).toBe("verified_basics");
  });

  it("✅ checklist와 질문형 FAQ의 같은 셔틀 확인 행동은 checklist만 남긴다", () => {
    const markdown = "## 등록 전 체크리스트\n✅ 셔틀 운행 여부와 노선을 문의하세요.\n\n## FAQ\n### Q. 셔틀버스는 운행하나요?\n학원에 문의해야 합니다.\n\n### Q. 주변 지역 후보를 함께 보는 이유는 무엇인가요?\n비교 범위를 설명합니다.";
    const result = dedupeLegacyPlusDecisionSupport(markdown);
    expect((result.match(/셔틀/g) || []).length).toBe(1);
    expect(result).toContain("주변 지역 후보를 함께 보는 이유");
  });

  it("유효 FAQ가 없으면 FAQ heading도 제거하고 emoji checklist는 empty로 오인하지 않는다", () => {
    const markdown = "## 체크리스트\n✅ 수강료를 문의하세요.\n\n## FAQ\n### Q. 수강료는 얼마인가요?\n학원에 문의하세요.";
    const result = dedupeLegacyPlusDecisionSupport(markdown);
    expect(result).not.toMatch(/^## FAQ/m);
    expect(t01LegacyPlusQualityIssues(result, context()).map((issue) => issue.code)).not.toContain("legacy_plus_empty_checklist");
    expect(t01LegacyPlusQualityIssues(result, context()).map((issue) => issue.code)).not.toContain("legacy_plus_empty_faq");
  });

  it("FAQ 답변에만 확인 행동이 있어도 해당 FAQ block 전체를 제거해 빈 H3를 남기지 않는다", () => {
    const markdown = "## 자주 묻는 질문\n안내 문구\n\n### 비용은 상담할 때 어떻게 물어봐야 하나요?\n교육비와 추가 비용을 나누어 확인하세요.\n\n### 수강 기간은 어떻게 비교하나요?\n첫 수업일과 시간표를 확인하세요.\n\n## 상담 전 체크리스트\n- ✅ 총비용과 추가 비용을 분리해 기록하기\n- ✅ 수업 시작일과 시간표 확인하기";
    const result = dedupeLegacyPlusDecisionSupport(markdown);
    expect(result).not.toContain("자주 묻는 질문");
    expect(result).not.toMatch(/^###\s+/m);
    expect(t01LegacyPlusQualityIssues(result, context()).map((issue) => issue.code)).not.toContain("legacy_plus_empty_heading");
  });

  it("100자 이상 review는 100자 이내 말줄임 버전을 사용하고 원문을 그대로 반복하지 않는다", () => {
    const text = "가".repeat(100);
    expect(truncateLegacyPlusReview(text)).toBe(`${"가".repeat(99)}…`);
    expect(Array.from(truncateLegacyPlusReview(text))).toHaveLength(100);
    expect(truncateLegacyPlusReview("가".repeat(99))).toBe("가".repeat(99));
  });

  it("출처가 붙은 100자 말줄임 review는 원천 review를 셔틀 사실 주장으로 오인하지 않는다", () => {
    const base = context();
    const reviewText = `셔틀 운행 여부와 노선을 상담 때 자세히 안내받아 준비하기 편했습니다. ${"추가 안내를 들었습니다. ".repeat(10)}`;
    const first = { ...base.selectedReviews[0]!, text: reviewText };
    const plus = {
      ...base,
      data: { ...base.data, candidates: base.data.candidates.map((candidate, index) => ({
        ...candidate,
        studentReviews: index === 0 ? [{ quote: reviewText, source: "DrivingPlus 수강생 리뷰" as const }] : [],
      })) },
      selectedReviews: [first],
    };
    const markdown = `### ${first.academyName}\n> ${truncateLegacyPlusReview(first.text)} — 출처: ${first.source.label}`;
    expect(t01LegacyPlusQualityIssues(markdown, plus).map((issue) => issue.code)).not.toContain("unverified_shuttle_claim");
  });

  it("원천 review와 같은 인용의 출처 표기를 정규화하고 추출용 거리 문장은 제거한다", () => {
    const plus = context();
    const review = plus.selectedReviews[0]!;
    const markdown = `### ${review.academyName}\n> ${truncateLegacyPlusReview(review.text)} — DrivingPlus 수강생 리뷰\n지역 중심 기준 거리는 약 13.2km입니다.`;
    const result = finalizeLegacyPlusMarkdown(markdown, plus);
    expect(result).toContain(`출처: ${review.source.label}`);
    expect(result).not.toMatch(/13\.2km|지역 중심 기준 거리/u);
    expect(t01LegacyPlusQualityIssues(result, { ...plus, selectedReviews: [review] }).map((issue) => issue.code)).not.toContain("legacy_plus_review_source_missing");
  });

  it("원천 review가 있는 학원에만 정확한 원문과 출처를 결정적으로 붙인다", () => {
    const plus = context();
    const source = "### 첫학원\n1종·2종 보통 과정을 확인할 수 있습니다.\n\n### 둘학원\n운영 형태를 확인하세요.";
    const result = finalizeLegacyPlusMarkdown(source, plus);
    for (const review of plus.selectedReviews) {
      expect(result).toContain(`> ${truncateLegacyPlusReview(review.text)} — 출처: ${review.source.label}`);
    }
    expect(result).toContain("- **주소:** 테스트시 첫학원로");
    expect(result).toContain("- **전화:** 031-000-0000");
    expect(result).toContain("- **운영 형태:** 운전학원");
    expect(t01LegacyPlusQualityIssues(result, plus).map((issue) => issue.code)).not.toEqual(expect.arrayContaining(["legacy_plus_review_count", "legacy_plus_review_source_missing", "legacy_plus_review_wrong_academy"]));
  });

  it("주소가 있는 후보는 서술과 별도로 주소 기본 정보 불릿이 없으면 차단한다", () => {
    const plus = { ...context(), selectedReviews: [] };
    const markdown = "### 첫학원\n테스트시 첫학원로에 있습니다.\n\n### 둘학원\n설명";
    expect(t01LegacyPlusQualityIssues(markdown, plus).map((issue) => issue.code)).toContain("legacy_plus_basic_address_missing");
  });

  it("대상 지역 밖 학원은 확장 후보 문구 없이 실제 소재지만 보강한다", () => {
    const base = context();
    const outside = {
      ...base,
      data: {
        ...base.data,
        selectedVariant: "distance_expanded_comparison",
        candidates: base.data.candidates.map((candidate, index) => index === 1 ? {
          ...candidate,
          storedRegion: "다른시",
          address: "다른시 둘학원로",
          retrievalSource: "nearby_distance_supplement" as const,
        } : candidate),
      },
      selectedReviews: [],
    };
    const result = finalizeLegacyPlusMarkdown("### 첫학원\n설명\n\n### 둘학원\n설명", outside);
    expect(result).toContain("실제 소재지는 다른시입니다.");
    expect(result).not.toMatch(/확장 후보|인근 후보|거리 기준/u);
    const codes = t01LegacyPlusQualityIssues(result, outside).map((issue) => issue.code);
    expect(codes).not.toContain("legacy_plus_actual_region_missing");
    expect(codes).not.toContain("distance_expansion_not_explained");
  });

  it("반복된 후보 H3와 동일 산문 문장은 사실을 더하지 않고 한 번만 남긴다", () => {
    const plus = { ...context(), selectedReviews: [] };
    const source = "### 첫학원\n같은 문장을 충분히 길게 반복해서 쓰면 글의 흐름이 부자연스러워집니다. 같은 문장을 충분히 길게 반복해서 쓰면 글의 흐름이 부자연스러워집니다.\n\n### 첫학원\n추가 설명\n\n### 둘학원\n설명";
    const result = finalizeLegacyPlusMarkdown(source, plus);
    expect((result.match(/### 첫학원/g) || [])).toHaveLength(1);
    expect((result.match(/같은 문장을 충분히 길게 반복해서 쓰면 글의 흐름이 부자연스러워집니다/g) || [])).toHaveLength(1);
  });

  it("부분 이름이 겹치는 학원끼리 review와 실제 소재지를 섞지 않고, 모든 후보의 독립 H3를 요구한다", () => {
    const rows = [
      row("양동상무자동차운전전문학원", "yang", { review_json: JSON.stringify([{ content: "양동 후기입니다." }]) }),
      row("상무자동차운전전문학원", "sang", { region: "다른시", address: "다른시 상무로", review_json: JSON.stringify([{ content: "상무 후기입니다." }]) }),
    ];
    const entries = [
      traceCandidate("양동상무자동차운전전문학원", "yang"),
      traceCandidate("상무자동차운전전문학원", "sang", "nearby_distance_supplement", { storedRegion: "다른시", address: "다른시 상무로", retrievalRank: 2 }),
    ];
    const trace: AcademySelectionTrace = { targetRegion: target, configuredMinimum: 2, candidatePoolLimit: 7, nearbyRadiusKm: 20, farRadiusKm: 50, regionLikeCandidates: [entries[0]!], supplementCandidates: [entries[1]!], farCandidates: [], duplicatesRemoved: [], excludedCandidates: [], mergedCandidatePool: entries };
    const plus = buildT01LegacyPlusContext(buildT01DataGatedContext(target, rows, trace, "name-collision", []), "name-collision");
    const incomplete = "### 양동상무자동차운전전문학원\n설명";
    const finalized = finalizeLegacyPlusMarkdown(incomplete, plus);
    expect(finalized).not.toContain("실제 소재지는 다른시입니다.");
    expect(finalized).not.toContain("상무 후기입니다.");
    expect(t01LegacyPlusQualityIssues(finalized, plus).map((item) => item.code)).toContain("legacy_plus_candidate_heading_missing");
  });

  it("명확한 허위 셔틀 주장과 review metadata는 hard failure로 유지한다", () => {
    const plus = context(); const review = plus.selectedReviews[0]!;
    const other = plus.selectedReviews[1]!;
    const markdown = `## 비교표\n| 항목 | 첫학원 | 둘학원 |\n|---|---|---|\n| 주소 | 테스트시 | 테스트시 |\n\n### ${review.academyName}\n이 학원은 셔틀을 운행합니다.\n> ${truncateLegacyPlusReview(review.text)} — 출처: ${review.source.label}\n작성자: 누구\n\n### ${other.academyName}\n> ${truncateLegacyPlusReview(other.text)} — 출처: ${other.source.label}\n\n## 체크리스트\n✅ 주소를 확인하세요.`;
    const codes = t01LegacyPlusQualityIssues(markdown, plus).map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining(["unverified_shuttle_claim", "legacy_plus_review_metadata_exposed"]));
  });

  it("개별 review를 전체 수강생 평가로 일반화하지 말라는 안전 문장은 hard failure로 오인하지 않는다", () => {
    const plus = context();
    const [first, second] = plus.selectedReviews;
    const markdown = `### ${first!.academyName}\n> ${truncateLegacyPlusReview(first!.text)} — 출처: ${first!.source.label}\n개인의 경험을 전체 수강생에게 일반화할 수는 없습니다.\n\n### ${second!.academyName}\n> ${truncateLegacyPlusReview(second!.text)} — 출처: ${second!.source.label}`;
    expect(t01LegacyPlusQualityIssues(markdown, plus).map((issue) => issue.code)).not.toContain("legacy_plus_review_generalized");
  });

  it("리뷰 자체를 전체 수강생 평가로 확대하면 계속 차단하되 인접한 독립 문장은 오탐하지 않는다", () => {
    const plus = context();
    const [first, second] = plus.selectedReviews;
    const generalized = `### ${first!.academyName}\n> ${truncateLegacyPlusReview(first!.text)} — 출처: ${first!.source.label}\n이 리뷰는 전체 수강생의 높은 합격률을 보여 줍니다.\n\n### ${second!.academyName}\n> ${truncateLegacyPlusReview(second!.text)} — 출처: ${second!.source.label}`;
    expect(t01LegacyPlusQualityIssues(generalized, plus).map((issue) => issue.code)).toContain("legacy_plus_review_generalized");
    const independent = `### ${first!.academyName}\n> ${truncateLegacyPlusReview(first!.text)} — 출처: ${first!.source.label}\n합격률은 제공된 자료에서 확인할 수 없습니다.\n\n### ${second!.academyName}\n> ${truncateLegacyPlusReview(second!.text)} — 출처: ${second!.source.label}`;
    expect(t01LegacyPlusQualityIssues(independent, plus).map((issue) => issue.code)).not.toContain("legacy_plus_review_generalized");
    const sourceQuoteOnly = `### ${first!.academyName}\n> 이 후기에서는 높은 합격률이라는 표현을 들었습니다. — 출처: ${first!.source.label}\n\n### ${second!.academyName}\n> ${truncateLegacyPlusReview(second!.text)} — 출처: ${second!.source.label}`;
    expect(t01LegacyPlusQualityIssues(sourceQuoteOnly, plus).map((issue) => issue.code)).not.toContain("legacy_plus_review_generalized");
  });

  it("각 학원 review를 하나씩 연결하고 다른 학원의 review나 추가 review는 hard failure로 잡는다", () => {
    const plus = context();
    const [first, second] = plus.selectedReviews;
    const valid = `### ${first!.academyName}\n> ${truncateLegacyPlusReview(first!.text)} — 출처: ${first!.source.label}\n\n### ${second!.academyName}\n> ${truncateLegacyPlusReview(second!.text)} — 출처: ${second!.source.label}`;
    expect(t01LegacyPlusQualityIssues(valid, plus).map((issue) => issue.code)).not.toEqual(expect.arrayContaining(["legacy_plus_review_count", "legacy_plus_review_wrong_academy", "legacy_plus_review_source_missing"]));
    const invalid = `### ${first!.academyName}\n> ${truncateLegacyPlusReview(first!.text)} — 출처: ${first!.source.label}\n> ${truncateLegacyPlusReview(second!.text)} — 출처: ${second!.source.label}`;
    expect(t01LegacyPlusQualityIssues(invalid, plus).map((issue) => issue.code)).toEqual(expect.arrayContaining(["legacy_plus_review_wrong_academy"]));
  });

  it("Legacy Plus에서 지역 안팎 H2 분류는 막되, 페르소나가 요구할 수 있는 동선 표현 자체는 금지하지 않는다", () => {
    const plus = context();
    const locationFirst = "## 테스트시 안에서 상담할 후보\n본문\n\n### 첫학원\n설명\n\n### 둘학원\n설명";
    expect(t01LegacyPlusQualityIssues(locationFirst, plus).map((issue) => issue.code)).toContain("legacy_plus_location_first_grouping");
    const regionalSplit = "## 지역 내 후보\n본문\n\n### 첫학원\n설명";
    expect(t01LegacyPlusQualityIssues(regionalSplit, plus).map((issue) => issue.code)).toContain("legacy_plus_location_first_grouping");
    const mobility = "### 첫학원\n직장과의 이동 조건은 상담 전에 확인하세요.\n\n### 둘학원\n설명";
    expect(t01LegacyPlusQualityIssues(mobility, plus).map((issue) => issue.code)).not.toContain("legacy_plus_location_narrative_repetition");
  });
});
