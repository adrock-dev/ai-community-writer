import { describe, expect, it } from "vitest";
import {
  articleQualityIssues,
  candidateCountFromFacts,
  candidateNamesFromFacts,
  postSurfaceQualityIssues,
} from "../src/quality-gate.js";

// 런타임 품질 게이트의 규칙별 동작을 고정한다. scripts/qa-posts.mjs 의 게이트와
// 규칙이 어긋나지 않도록, 규칙을 바꿀 때 이 테스트도 함께 갱신한다.

describe("articleQualityIssues", () => {
  it("빈 본문은 h1 누락과 길이 부족을 잡아낸다", () => {
    const issues = articleQualityIssues("", "", {});
    expect(issues).toContain("missing_h1_title");
    expect(issues.some((c) => c.startsWith("too_short_"))).toBe(true);
  });

  it("표가 없으면 요약/비교 표 누락을 표시한다", () => {
    const md = "# 제목\n\n## 섹션\n본문 내용이 들어간다.";
    expect(articleQualityIssues(md, "", {})).toContain("missing_summary_table");
  });

  it("'3일만에 합격' 류의 위험 문구를 잡아낸다", () => {
    const md = "# 제목\n\n3일만에 합격 가능합니다.";
    expect(articleQualityIssues(md, "", {})).toContain(
      "risky_duration_or_pass_guarantee_claim",
    );
  });

  it("후보가 2곳 이상인데 H3 후보 소제목이 없으면 잡아낸다", () => {
    const facts = "[1] 강남운전전문학원 / 서울 강남구\n[2] 서초드라이빙스쿨 / 서울 서초구";
    const md = "# 제목\n\n## 섹션\n본문";
    const issues = articleQualityIssues(md, facts, {});
    expect(issues.some((c) => c.startsWith("missing_candidate_h3_headings_"))).toBe(true);
  });

  it("정의되지 않은 이미지 슬롯 키를 잡아낸다", () => {
    const md = "# 제목\n\n[IMAGE:bogus_key]\n본문";
    const issues = articleQualityIssues(md, "", { hero: "https://x/y.jpg" });
    expect(issues.some((c) => c.startsWith("unknown_image_slots_"))).toBe(true);
  });
});

describe("postSurfaceQualityIssues", () => {
  it("실제 후보 수보다 부풀린 개수 주장을 잡아낸다", () => {
    const post = { title: "운전면허학원 BEST 10", body_markdown: "# 운전면허학원 BEST 10\n본문", images: null };
    const issues = postSurfaceQualityIssues(post, 2600, 3);
    expect(issues).toContain("inflated_candidate_count_10_gt_3");
  });

  it("'OO구운전면허학원' 처럼 띄어쓰기가 붙은 키워드를 잡아낸다", () => {
    const post = { title: "강남구운전면허학원 추천", body_markdown: "# 제목\n본문", images: null };
    expect(postSurfaceQualityIssues(post)).toContain("keyword_spacing_issue");
  });

  it("내부 자료 용어 노출을 잡아낸다", () => {
    const post = { title: "제목", body_markdown: "# 제목\nDrivingPlus 내부 데이터 기반", images: null };
    expect(postSurfaceQualityIssues(post)).toContain("exposes_internal_fact_language");
  });
});

describe("데이터 없는 단정 차단", () => {
  it("검증된 가격 자료가 없는데 구체 금액을 쓰면 잡아낸다", () => {
    const md = "# 제목\n\n수강료는 50만원 수준입니다.";
    expect(articleQualityIssues(md, "", {})).toContain("unverified_specific_price_claim");
  });

  it("검증된 가격 자료가 있으면 금액 단정을 허용한다", () => {
    const facts = "수강료: 50만원";
    const md = "# 제목\n\n수강료는 50만원입니다.";
    expect(articleQualityIssues(md, facts, {})).not.toContain("unverified_specific_price_claim");
  });

  it("검증된 후기 자료가 없는데 후기를 인용하면 잡아낸다", () => {
    const md = "# 제목\n\n실제 수강생 후기에 따르면 만족도가 높습니다.";
    expect(articleQualityIssues(md, "", {})).toContain("unverified_review_claim");
  });
});

describe("facts 파서", () => {
  it("'직접 매칭 후보 수'를 우선해서 후보 수를 센다", () => {
    expect(candidateCountFromFacts("직접 매칭 후보 수: 5\n...")).toBe(5);
  });

  it("후보 수 명시가 없으면 [n] 라인 개수로 센다", () => {
    expect(candidateCountFromFacts("[1] 가\n[2] 나\n[3] 다")).toBe(3);
  });

  it("[n] 라인에서 후보명을 추출한다", () => {
    const facts = "[1] 강남운전전문학원 / 서울 강남구\n[2] 서초드라이빙스쿨 / 서울 서초구";
    expect(candidateNamesFromFacts(facts)).toEqual([
      "강남운전전문학원",
      "서초드라이빙스쿨",
    ]);
  });

  it("test/더미 후보명은 제외한다", () => {
    expect(candidateNamesFromFacts("[1] 테스트학원 / 어딘가")).toEqual([]);
  });
});
