import { describe, expect, it } from "vitest";
import * as qg from "../src/quality-gate.js";
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

  const repeatedSamples = [
    "# 제목\n\n확인된 과정은 1종 보통, 2종 보통입니다.\n\n다른 설명이 이어진다.\n\n확인된 과정은 1종 보통, 2종 보통입니다.",
    "# 제목\n\nA학원은 평택시에 있습니다.\n\nB학원은 안성시에 있습니다.",
  ];
  for (const sample of repeatedSamples) {
    it(`repeatedSentenceIssues 탐지 결과가 일치한다: "${sample.slice(2, 18)}"`, () => {
      expect(detects(qa.repeatedSentenceIssues, sample)).toBe(detects(qg.repeatedSentenceIssues, sample));
    });
  }
});
