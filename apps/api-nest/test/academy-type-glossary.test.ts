import { describe, expect, it } from "vitest";
import { academyTypeGlossary } from "../src/worker.service.js";

// academy(운전학원) vs exam_academy(자동차운전전문학원)의 차이를 LLM 이 배경으로 알도록
// facts 헤더에 넣는 용어 설명. 글이 반드시 이 차이를 설명해야 하는 건 아니다(배경 지식).

const A = (academy_type: string) => ({ name: "x", academy_type });

describe("운영 형태 용어 설명", () => {
  it("등장하는 유형만 설명한다", () => {
    expect(academyTypeGlossary([A("exam_academy"), A("exam_academy")]))
      .toContain("자동차운전전문학원: 학원 안에 시험 코스가 있어");
    expect(academyTypeGlossary([A("exam_academy"), A("exam_academy")]))
      .not.toContain("운전학원: 차량 연습");

    const both = academyTypeGlossary([A("exam_academy"), A("academy")]);
    expect(both).toContain("자동차운전전문학원");
    expect(both).toContain("운전학원: 차량 연습");
  });

  it("학원이 없으면 빈 문자열", () => {
    expect(academyTypeGlossary([])).toBe("");
    expect(academyTypeGlossary([A("license_test_course")])).toBe("");
  });

  it("배경 지식임을 명시한다 — 본문 강제 설명이 아니다", () => {
    expect(academyTypeGlossary([A("academy")])).toContain("반드시 본문에 설명할 필요는 없음");
  });

  it("비교글 out-of-scope 게이트('시험 접수·응시')를 회피하는 표현을 쓴다", () => {
    const text = academyTypeGlossary([A("exam_academy"), A("academy")]);
    expect(/시험\s*(?:접수|응시)/u.test(text)).toBe(false);
    expect(text).toContain("치르는");
  });
});
