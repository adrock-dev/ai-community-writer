import { describe, expect, it } from "vitest";
import {
  aiClicheIssues,
  articleQualityIssues,
  boilerplatePhraseIssues,
  candidateCountFromFacts,
  unlistedPhoneNumbers,
  candidateNamesFromFacts,
  internalLinkIssues,
  postSurfaceQualityIssues,
  repeatedSentenceIssues,
  stripUnofferedInternalLinks,
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

describe("지어낸 내부링크 해제(stripUnofferedInternalLinks)", () => {
  const relatedFacts = "관련 글 후보:\n- 평택: https://example.com/community/pyeongtaek-guide\n- 안성: https://example.com/community/anseong-best";

  it("제공 목록에 있는 내부링크는 그대로 둔다", () => {
    const md = "자세한 내용은 [평택 총정리](https://example.com/community/pyeongtaek-guide)를 참고하세요.";
    expect(stripUnofferedInternalLinks(md, relatedFacts)).toBe(md);
  });

  it("제공 목록에 없는(지어낸) 내부링크는 링크를 해제해 텍스트만 남긴다", () => {
    const md = "관련 글 [없는 글](https://example.com/community/made-up-slug)도 보세요.";
    expect(stripUnofferedInternalLinks(md, relatedFacts)).toBe("관련 글 없는 글도 보세요.");
  });

  it("offered 슬러그로 시작만 하는 다른 슬러그(…-3)는 서로 다른 글이므로 해제한다", () => {
    const md = "[가짜](https://example.com/community/pyeongtaek-guide-3)";
    expect(stripUnofferedInternalLinks(md, relatedFacts)).toBe("가짜");
  });

  it("관련 글 후보가 없으면 모든 /community/ 링크를 해제한다", () => {
    const md = "[지어낸 글](https://example.com/community/whatever)";
    expect(stripUnofferedInternalLinks(md, "소개 가능한 후보 수: 3곳")).toBe("지어낸 글");
  });

  it("/community/ 가 아닌 외부 링크(블로그·공신력 출처)는 건드리지 않는다", () => {
    const md = "[네이버](https://blog.naver.com/x/123) 와 [공단](https://www.koroad.or.kr)";
    expect(stripUnofferedInternalLinks(md, relatedFacts)).toBe(md);
  });

  it("URL 인코딩된 제공 링크(한글 슬러그)도 유지한다", () => {
    const facts = "관련 글 후보:\n- 강릉: https://example.com/community/강릉-학원";
    const md = "[강릉](https://example.com/community/%EA%B0%95%EB%A6%89-%ED%95%99%EC%9B%90)";
    expect(stripUnofferedInternalLinks(md, facts)).toBe(md);
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

  it("콜론형 리뷰 facts(T16/academy-review-evidence)가 있으면 후기 인용을 허용한다", () => {
    // academy-review-evidence.ts 가 emit 하는 실제 형식. 번호형(수강생 리뷰 1)만 인정하던 탓에
    // 실제 리뷰가 있는 T16 글이 오탐·격리됐다(2026-07-23).
    const facts = '[1] OO학원 / 수강생 리뷰: "강사님이 친절하세요" (출처: 운전면허PLUS 실제 수강생 리뷰)';
    const md = "# 제목\n\n> “강사님이 친절하세요” — 출처: 운전면허PLUS 실제 수강생 리뷰\n\n실제 수강생 후기에서 확인할 수 있는 점을 정리했습니다.";
    expect(articleQualityIssues(md, facts, {})).not.toContain("unverified_review_claim");
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

// 공개 글에 실릴 전화번호는 facts 가 준 안심번호뿐이다. 실번호는 facts 에 넣지 않지만
// 셔틀 안내문(131건)·블로그 후기(5건) 본문에 섞여 들어와 그대로 실릴 수 있다.
// 프롬프트 지시만으로는 새어 나간 전력이 있어(발행 글 20편 중 9편) 게이트로 막는다.
describe("facts 밖 전화번호 노출 차단", () => {
  const facts = "[1] 가나다운전전문학원 / 주소: 서울시 어딘가 / 전화: 0507-2000-0240";

  it("facts 에 있는 번호는 통과시킨다", () => {
    expect(unlistedPhoneNumbers("문의는 0507-2000-0240 으로 하세요.", facts)).toEqual([]);
  });

  it("facts 에 없는 실번호를 잡는다", () => {
    expect(unlistedPhoneNumbers("학원문의 : 032-446-1199", facts)).toEqual(["032-446-1199"]);
  });

  it("여러 번호가 섞이면 facts 밖 번호만 골라낸다", () => {
    expect(unlistedPhoneNumbers("대표 0507-2000-0240, 일반 031-595-2900", facts)).toEqual(["031-595-2900"]);
  });

  it("같은 번호가 여러 번 나와도 한 번만 보고한다", () => {
    expect(unlistedPhoneNumbers("063-547-6200 그리고 063-547-6200", facts)).toEqual(["063-547-6200"]);
  });

  it("전화번호가 없으면 빈 배열이다", () => {
    expect(unlistedPhoneNumbers("전화번호 언급이 없는 본문", facts)).toEqual([]);
  });
});

describe("전화번호 추출 경계", () => {
  it("안심번호를 잘라서 읽지 않는다(0507-… 에서 07-… 로 매칭되면 안 됨)", () => {
    // 경계가 없으면 facts 의 0507 번호가 07 번호로 잘려 실번호와 구분이 무너진다.
    expect(unlistedPhoneNumbers("전화: 0507-2000-0297", "전화: 0507-2000-0297")).toEqual([]);
    expect(unlistedPhoneNumbers("전화: 0507-2000-0297", "전화: 0507-2000-0111")).toEqual(["0507-2000-0297"]);
  });

  it("지역번호 실번호는 온전히 잡는다", () => {
    expect(unlistedPhoneNumbers("문의 031-595-2900", "전화: 0507-2000-0297")).toEqual(["031-595-2900"]);
  });
});
