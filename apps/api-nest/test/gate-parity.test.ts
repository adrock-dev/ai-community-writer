import { describe, expect, it } from "vitest";
import * as qg from "../src/quality-gate.js";
import { renderMarkdown } from "../src/post-rendering.js";
// 렌더 인식 게이트(scripts/qa-posts.mjs)는 런타임 게이트(quality-gate.ts)의 품질 규칙을 미러링한다.
// 두 곳이 어긋나면(P6 드리프트 가드) 이 테스트가 실패한다. qa-posts.mjs 는 CLI 진입점에서만 main() 을
// 돌리므로 import 는 부수효과가 없다(DB 를 열지 않는다).
import * as qa from "../../../scripts/qa-posts.mjs";

describe("게이트 미러 드리프트 가드(P6)", () => {
  it("AI 상투표현 목록이 두 게이트에서 동일하다", () => {
    expect(qa.AI_CLICHE_PHRASES).toEqual(qg.AI_CLICHE_PHRASES);
  });

  it("판박이 필러 목록이 두 게이트에서 동일하다", () => {
    expect(qa.BOILERPLATE_PHRASES).toEqual(qg.BOILERPLATE_PHRASES);
  });

  it("문장 난이도 임계값이 두 게이트에서 동일하다", () => {
    expect(qa.HARD_SENTENCE_CHARS).toBe(qg.HARD_SENTENCE_CHARS);
    expect(qa.OVERLONG_SENTENCE_CHARS).toBe(qg.OVERLONG_SENTENCE_CHARS);
  });

  // 데이터뿐 아니라 로직 드리프트(문단/문장 분리 등)도 잡도록, 같은 시그니처의 공유 함수를 표본으로 대조한다.
  const detects = (fn: (t: string, e?: string[]) => string[], text: string, extra?: string[]) =>
    (extra ? fn(text, extra) : fn(text)).length > 0;

  const aiClicheSamples = [
    "이번 글에서는 안성 운전학원을 살펴보겠습니다.",
    "평택역 인근 통학 동선을 먼저 따져보세요.",
    "여러분 안녕하세요.",
    "",
  ];
  for (const sample of aiClicheSamples) {
    it(`aiClicheIssues 탐지 결과가 일치한다: "${sample.slice(0, 16)}"`, () => {
      expect(detects(qa.aiClicheIssues, sample)).toBe(detects(qg.aiClicheIssues, sample));
    });
  }

  const boilerplateSamples: [string, string[] | undefined][] = [
    ["정리하면 선택 기준은 단순합니다.", undefined],
    ["평택 통학 동선을 확인하세요.", undefined],
    ["친절한 상담이 인상적입니다.", ["친절한 상담이 인상적입니다"]],
  ];
  for (const [sample, extra] of boilerplateSamples) {
    it(`boilerplatePhraseIssues 탐지 결과가 일치한다: "${sample.slice(0, 16)}"`, () => {
      expect(detects(qa.boilerplatePhraseIssues, sample, extra)).toBe(detects(qg.boilerplatePhraseIssues, sample, extra));
    });
  }

  // 내부 누출 검사 공유 조각. 이 두 개가 어긋나 있어서 발행 글 13/13 이 qa:posts 에서만 떨어졌다
  // (런타임은 리뷰 출처 표기를 예외 처리했으나 qa 미러는 하지 않음). 재발을 여기서 막는다.
  it("리뷰 출처 표기 예외 패턴이 두 게이트에서 동일하다", () => {
    expect(qa.PUBLIC_REVIEW_ATTRIBUTION_PATTERN).toBe(qg.PUBLIC_REVIEW_ATTRIBUTION_PATTERN);
  });

  it("리뷰 보충자료 누출 패턴이 두 게이트에서 동일하다", () => {
    expect(qa.REVIEW_SUPPLEMENT_LEAK_PATTERN).toBe(qg.REVIEW_SUPPLEMENT_LEAK_PATTERN);
  });

  const attributionSamples = [
    "> 강사님이 친절했어요 — 출처: DrivingPlus 수강생 리뷰",
    "> 연습장이 넓어요 — 출처:DrivingPlus  수강생   리뷰",
    "내부 자료는 DrivingPlus API 에서 가져왔다",
    "",
  ];
  for (const sample of attributionSamples) {
    it(`stripPublicReviewAttribution 결과가 일치한다: "${sample.slice(0, 16)}"`, () => {
      expect(qa.stripPublicReviewAttribution(sample)).toBe(qg.stripPublicReviewAttribution(sample));
    });
  }

  // "긍정" 접두어를 필수로 두면 모델이 그 단어만 빼도 양쪽을 통과한다(실제로 평가 산출물에서 관측됨).
  const supplementSamples = [
    "긍정 수강생 리뷰 보충자료에는 친절한 상담이 언급됐습니다",
    "수강생 리뷰 보충자료에는 친절한 상담이 언급됐습니다",
    "블로그 리뷰글 보충자료를 참고했다",
    "수강생 리뷰를 한 건 인용했습니다",
  ];
  for (const sample of supplementSamples) {
    it(`리뷰 보충자료 패턴 탐지가 일치한다: "${sample.slice(0, 16)}"`, () => {
      const detect = (pattern: string) => new RegExp(pattern, "i").test(sample);
      expect(detect(qa.REVIEW_SUPPLEMENT_LEAK_PATTERN)).toBe(detect(qg.REVIEW_SUPPLEMENT_LEAK_PATTERN));
    });
  }

  // "여러분"은 하드 실패에서 반복 금지로 완화했다. 두 게이트의 임계값이 어긋나면
  // 한쪽에서만 통과하는 글이 생기므로 값과 동작을 함께 잠근다.
  it("2인칭 호칭 임계값이 두 게이트에서 동일하다", () => {
    expect(qa.SECOND_PERSON_ADDRESS).toBe(qg.SECOND_PERSON_ADDRESS);
    expect(qa.SECOND_PERSON_ADDRESS_LIMIT).toBe(qg.SECOND_PERSON_ADDRESS_LIMIT);
  });

  const secondPersonSamples = [
    "여러분 안녕하세요.",
    "여러분 안녕하세요. 여러분 반갑습니다.",
    "여러분 안녕하세요. 여러분 반갑습니다. 여러분 또 만나요.",
    "2인칭 호칭이 없는 문장입니다.",
  ];
  for (const sample of secondPersonSamples) {
    it(`overusedSecondPersonIssues 탐지 결과가 일치한다: "${sample.slice(0, 20)}"`, () => {
      expect(detects(qa.overusedSecondPersonIssues, sample)).toBe(detects(qg.overusedSecondPersonIssues, sample));
    });
  }

  // 상위→하위 헤딩(`## 주제` → `### 항목`)은 정상 구조다. 두 게이트가 어긋나면 한쪽만
  // 통과하는 글이 생기고, 예전처럼 후처리가 의미 없는 문장을 끼워 넣게 된다.
  const headingSamples = [
    "## 후보별 차이\n### 가나다학원\n본문입니다.",
    "### 가나다학원\n### 라마바학원\n본문입니다.",
    "## 첫 섹션\n## 둘째 섹션\n본문입니다.",
    "## 섹션\n본문이 바로 옵니다.",
  ];
  for (const sample of headingSamples) {
    it(`adjacentHeadingCount 가 두 게이트에서 같다: "${sample.slice(0, 18).replace(/\n/g, "⏎")}"`, () => {
      expect(qa.adjacentHeadingCount(sample)).toBe(qg.adjacentHeadingCount(sample));
    });
  }

  const repeatedSamples = [
    "# 제목\n\n확인된 과정은 1종 보통, 2종 보통입니다.\n\n다른 설명이 이어진다.\n\n확인된 과정은 1종 보통, 2종 보통입니다.",
    "# 제목\n\nA학원은 평택시에 있습니다.\n\nB학원은 안성시에 있습니다.",
  ];
  for (const sample of repeatedSamples) {
    it(`repeatedSentenceIssues 탐지 결과가 일치한다: "${sample.slice(2, 18)}"`, () => {
      expect(detects(qa.repeatedSentenceIssues, sample)).toBe(detects(qg.repeatedSentenceIssues, sample));
    });
  }

  // 품질 규칙뿐 아니라 렌더러도 qa-posts.mjs 에 미러돼 있다. 이쪽이 어긋나 있어서 loose list 렌더 버그가
  // 두 곳에 똑같이 남아 있었고 게이트가 자기 버그를 못 잡았다. 유일한 의도적 차이는 학원 카드 래퍼다.
  const stripCardWrapper = (html: string) => html.replace(/<section class="academy-card">/g, "").replace(/<\/section>/g, "");
  const renderSamples: [string, Record<string, string>][] = [
    ["- 첫째\n- 둘째\n\n- 셋째", {}],
    ["본문 문단\n\n- 유일한 항목", {}],
    ["본문\n\n✅ 확인이 필요합니다", {}],
    ["- 항목\n\n이어지는 문단입니다", {}],
    ["첫 문단\n\n둘째 문단", {}],
    ["# 제목\n\n## 소제목\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- 항목\n\n- 항목2", {}],
    ["### 학원명\n\n[IMAGE:academy_1]\n\n> 후기 — 출처: DrivingPlus 수강생 리뷰", { academy_1: "https://example.test/a.jpg" }],
  ];
  for (const [sample, images] of renderSamples) {
    it(`renderMarkdown 결과가 두 렌더러에서 동일하다: "${sample.slice(0, 16).replace(/\n/g, "⏎")}"`, () => {
      expect(qa.renderMarkdown(sample, images)).toBe(stripCardWrapper(renderMarkdown(sample, images)));
    });
  }

  // T16 게이트도 두 구현이 갈라지면 안 된다 — 런타임은 막고 qa 는 통과시키는(또는 반대) 드리프트 방지.
  describe("distanceClaimIssues", () => {
    const samples = ["학원까지 13.2km 거리입니다.", "약 5 km 안에 있습니다.", "직선 거리로 가깝습니다.", "차로 15분 걸립니다.", "도보 10분 거리입니다.", "거리와 상관없이 상담에서 확인하세요."];
    for (const sample of samples) {
      it(`탐지 결과가 일치한다: "${sample.slice(0, 16)}"`, () => {
        expect(qa.distanceClaimIssues(sample)).toEqual(qg.distanceClaimIssues(sample));
      });
    }
  });

  describe("titleAxisEvidenceIssues", () => {
    const cases: Array<[string, string]> = [
      ["○○시 운전면허학원 BEST 5! 수강생 후기로 확인하는", "[1] 가 / 주소: 서울"],
      ["○○시 운전면허학원 BEST 5! 수강생 후기로 확인하는", "[1] 가 / 수강생 리뷰: “좋아요”"],
      ["○○시 운전면허학원 BEST 5! 셔틀 운행 지역과 면허 과정 고르기", "[1] 가 / 주소: 서울"],
      ["○○시 운전면허학원 BEST 5! 수강료 비교와 운영 시간까지", "[1] 가 / 수강료: 70만원 / 영업시간: 09-18"],
      ["○○시 운전면허학원 BEST 5! 상담 전 체크와 면허 과정 고르기", "[1] 가 / 주소: 서울"],
    ];
    for (const [title, facts] of cases) {
      it(`탐지 결과가 일치한다: "${title.slice(-14)}"`, () => {
        expect(qa.titleAxisEvidenceIssues(title, facts)).toEqual(qg.titleAxisEvidenceIssues(title, facts));
      });
    }
  });

});
