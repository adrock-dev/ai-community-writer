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
