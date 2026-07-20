import { describe, expect, it } from "vitest";
import {
  aiClicheIssues,
  articleQualityIssues,
  boilerplatePhraseIssues,
  candidateCountFromFacts,
  candidateNamesFromFacts,
  internalLinkIssues,
  postSurfaceQualityIssues,
  repeatedSentenceIssues,
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

describe("자기 도메인 내부링크 예외(siteHost)", () => {
  const communityLink = "# 제목\n\n자세한 내용은 [의왕시 총정리](https://app.drivingplus.me/community/의왕시-운전면허학원)를 참고하세요.";

  it("siteHost 없으면 자기 도메인 URL도 누출로 잡는다(기존 동작 유지)", () => {
    expect(articleQualityIssues(communityLink, "", {})).toContain("exposes_internal_fact_language");
  });

  it("siteHost 를 주면 자기 공개 도메인 내부링크는 누출로 보지 않는다", () => {
    expect(articleQualityIssues(communityLink, "", {}, [], "app.drivingplus.me")).not.toContain("exposes_internal_fact_language");
  });

  it("siteHost 를 줘도 내부 API host(api-dev.drivingplus.me)는 계속 잡는다", () => {
    const md = "# 제목\n\n내부 경로 https://api-dev.drivingplus.me/get-all-academy 를 쓴다.";
    expect(articleQualityIssues(md, "", {}, [], "app.drivingplus.me")).toContain("exposes_internal_fact_language");
  });

  it("siteHost 를 줘도 산문 속 DrivingPlus 브랜드명은 계속 잡는다", () => {
    const md = "# 제목\n\nDrivingPlus 자료를 근거로 정리했습니다.";
    expect(articleQualityIssues(md, "", {}, [], "app.drivingplus.me")).toContain("exposes_internal_fact_language");
  });

  it("postSurfaceQualityIssues 도 siteHost 로 자기 도메인 링크를 예외 처리한다", () => {
    const post = { title: "제목", body_markdown: communityLink, images: null };
    expect(postSurfaceQualityIssues(post, 2600, 0, [], "app.drivingplus.me")).not.toContain("exposes_internal_fact_language");
  });
});

describe("문장 난이도(가독성)", () => {
  it("150자 이상 run-on 문장이 2개 이상이면 잡아낸다", () => {
    const long = "가".repeat(160) + ".";
    const md = `# 제목\n\n${long} ${long}`;
    const issues = articleQualityIssues(md, "", {});
    expect(issues.some((c) => c.startsWith("hard_sentences_"))).toBe(true);
  });

  it("220자 이상 문장은 하나만 있어도 잡아낸다", () => {
    const md = `# 제목\n\n${"가".repeat(230)}.`;
    const issues = articleQualityIssues(md, "", {});
    expect(issues.some((c) => c.startsWith("overlong_sentence_"))).toBe(true);
  });

  it("링크 URL 때문에 길어진 줄은 오탐하지 않는다", () => {
    const line = "자세한 비교는 [강남 운전학원 BEST 5](https://structure-lab/community/강남-운전학원-BEST-5-3)에서 확인하세요.";
    const md = `# 제목\n\n${line}\n\n${line}`;
    const issues = articleQualityIssues(md, "", {});
    expect(issues.some((c) => c.startsWith("hard_sentences_") || c.startsWith("overlong_sentence_"))).toBe(false);
  });
});

describe("AI 상투표현(자연스러움)", () => {
  it("'이번 글에서는' 블로그 프레임을 잡아낸다", () => {
    const found = aiClicheIssues("이번 글에서는 안성시 운전면허학원을 비교한다.");
    expect(found.some((c) => c.startsWith("ai_cliche_expressions"))).toBe(true);
    expect(found[0]).toContain("이번 글에서는");
  });

  it("'~알아보겠습니다' 메타서술을 잡아낸다(articleQualityIssues 경유)", () => {
    const md = "# 제목\n\n오늘은 운전면허학원에 대해 알아보겠습니다.";
    expect(articleQualityIssues(md, "", {}).some((c) => c.startsWith("ai_cliche_expressions"))).toBe(true);
  });

  it("여러 상투표현이 있으면 매칭 문구를 함께 보고한다", () => {
    const found = aiClicheIssues("이번 글에서는 살펴보겠습니다. 도움이 되셨기를 바랍니다.");
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("살펴보겠습니다");
    expect(found[0]).toContain("이번 글에서는");
  });

  it("상투표현이 없는 자연스러운 글(흔한 부사 포함)은 오탐하지 않는다", () => {
    const md = "안성에는 다양한 학원이 있고, 상담 때 꼭 반드시 확인할 점이 있다.";
    expect(aiClicheIssues(md)).toEqual([]);
  });

  it("surface 게이트에서도 제목의 상투표현을 검사한다", () => {
    const post = { title: "이번 글에서는 정리", body_markdown: "# 제목\n본문", images: null };
    expect(postSurfaceQualityIssues(post).some((c) => c.startsWith("ai_cliche_expressions"))).toBe(true);
  });
});

describe("중복/반복 문구(중복 방지)", () => {
  it("판박이 필러 문장을 잡아낸다", () => {
    const found = boilerplatePhraseIssues("정리하면 선택 기준은 단순합니다. 아래를 보자.");
    expect(found.some((c) => c.startsWith("boilerplate_phrase"))).toBe(true);
  });

  it("도메인 감시 문구(extra)도 함께 검사한다", () => {
    expect(boilerplatePhraseIssues("친절한 상담이 인상적입니다.", ["친절한 상담이 인상적입니다"]).length).toBe(1);
  });

  it("상투 문장이 없으면 통과한다", () => {
    expect(boilerplatePhraseIssues("평택역 인근에서 통학 동선을 먼저 따져보세요.")).toEqual([]);
  });

  it("같은 문장이 글 안에서 2회 이상 반복되면 잡아낸다", () => {
    const s = "확인된 과정은 1종 보통, 2종 보통입니다.";
    const md = `# 제목\n\n${s}\n\n다른 설명이 이어진다.\n\n${s}`;
    expect(repeatedSentenceIssues(md).some((c) => c.startsWith("repeated_sentence"))).toBe(true);
  });

  it("서로 다른 사실 문장(학원별)은 반복으로 보지 않는다", () => {
    const md = "# 제목\n\nA학원은 평택시에 있습니다.\n\nB학원은 안성시에 있습니다.";
    expect(repeatedSentenceIssues(md)).toEqual([]);
  });
});

describe("내부링크 게이트(P3)", () => {
  const relatedFacts = "관련 글 후보(실제 내부 링크, 필요 시 2~4개만 자연스럽게 연결):\n- 평택 운전면허학원 총정리: https://example.com/community/pyeongtaek-guide\n- 안성 운전면허학원 비교: https://example.com/community/anseong-best";

  it("관련 후보가 있는데 내부 링크가 하나도 없으면 잡아낸다", () => {
    const md = "# 제목\n\n본문에 링크가 없다.";
    expect(internalLinkIssues(md, relatedFacts)).toContain("missing_internal_link");
  });

  it("제시된 실제 URL 을 Markdown 링크로 연결하면 통과한다", () => {
    const md = "# 제목\n\n자세한 내용은 [평택 총정리](https://example.com/community/pyeongtaek-guide)를 참고하세요.";
    expect(internalLinkIssues(md, relatedFacts)).toEqual([]);
  });

  it("관련 후보가 없으면(신규 도메인) 내부 링크를 요구하지 않는다", () => {
    const md = "# 제목\n\n본문에 링크가 없다.";
    expect(internalLinkIssues(md, "소개 가능한 후보 수: 3곳")).toEqual([]);
  });

  it("재료에 없는 슬러그를 지어낸 가짜 링크는 통과시키지 않는다", () => {
    const md = "# 제목\n\n[가짜 글](https://example.com/community/made-up-slug)";
    expect(internalLinkIssues(md, relatedFacts)).toContain("missing_internal_link");
  });

  it("비차단 신호이므로 하드 게이트(articleQualityIssues)에는 포함되지 않는다", () => {
    const md = "# 제목\n\n## 섹션\n본문만 있고 링크가 없다.";
    expect(articleQualityIssues(md, relatedFacts, {})).not.toContain("missing_internal_link");
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
