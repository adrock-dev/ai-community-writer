import { describe, expect, it } from "vitest";
import { fabricatedPriceAmounts, priceAmountsIn } from "../src/quality-gate.js";

// 실제 태백 후보 2곳의 facts 형태(2026-07-27). 황지학원은 1종 보통 자동 금액이 자료에 없다 —
// 이 구멍에 다른 과정 금액을 갖다 붙이는 것이 실측된 날조 유형이다.
const FACTS = [
  "[1] 황지 자동차운전전문학원 / 수강료: 1종 보통 수동 440,000원, 2종 보통 자동 440,000원 (부가세 별도, 검정료 포함, 2026년 1분기 기준) / 운영 과정: 1종 보통 수동, 1종 보통 자동, 2종 보통 자동",
  "[2] 삼척자동차운전전문학원 / 수강료: 1종 보통 수동 770,000원, 1종 보통 자동 810,000원, 2종 보통 자동 770,000원",
].join("\n");

describe("priceAmountsIn — 금액 표기 정규화", () => {
  it("쉼표·만원 표기를 같은 값으로 읽는다", () => {
    expect(priceAmountsIn("780,000원")).toEqual(new Set([780000]));
    expect(priceAmountsIn("780000원")).toEqual(new Set([780000]));
    expect(priceAmountsIn("78만원")).toEqual(new Set([780000]));
  });

  it("금액이 아닌 숫자는 세지 않는다", () => {
    // 연도·개수·시각·전화번호가 섞여 들어오면 오탐이 난다.
    const amounts = priceAmountsIn("2026년 1분기 기준 · 경유지 15곳 · 08:00~20:00 · 0507-2000-0442");
    expect(amounts.size).toBe(0);
  });
});

describe("fabricatedPriceAmounts", () => {
  it("facts 에 있는 금액만 쓰면 통과한다", () => {
    const markdown = "# 제목\n\n황지학원은 1종 보통 수동 440,000원, 2종 보통 자동 440,000원으로 안내돼 있어요.";
    expect(fabricatedPriceAmounts(markdown, FACTS)).toEqual([]);
  });

  it("자료에 없는 금액을 쓰면 잡는다", () => {
    const markdown = "# 제목\n\n1종 보통 자동은 500,000원으로 안내돼 있습니다.";
    expect(fabricatedPriceAmounts(markdown, FACTS)).toEqual([500000]);
  });

  it("표기만 다른 같은 금액은 날조가 아니다", () => {
    // "44만원"은 440,000원과 같은 값이다. 표기 차이로 실패하면 게이트가 글을 막는다.
    expect(fabricatedPriceAmounts("# 제목\n\n44만원부터 시작합니다.", FACTS)).toEqual([]);
  });

  it("'70만원대' 같은 근사 표현은 그 구간에 실제 금액이 있으면 통과한다", () => {
    expect(fabricatedPriceAmounts("# 제목\n\n두 곳 모두 70만원대로 안내돼 있어요.", FACTS)).toEqual([]);
    // 구간에 해당하는 금액이 아예 없으면 근거 없는 주장이다.
    expect(fabricatedPriceAmounts("# 제목\n\n90만원대로 안내돼 있어요.", FACTS)).toEqual([900000]);
  });

  it("후기 인용 속 금액도 facts 원문에 있으면 통과한다", () => {
    const facts = `${FACTS}\n수강생 리뷰: “저는 440,000원에 등록했어요” (출처: 운전면허PLUS 실제 수강생 리뷰)`;
    const markdown = "# 제목\n\n> “저는 440,000원에 등록했어요” — 출처: 운전면허PLUS 실제 수강생 리뷰";
    expect(fabricatedPriceAmounts(markdown, facts)).toEqual([]);
  });

  it("facts 에 금액이 하나도 없으면 이 검사는 판단하지 않는다", () => {
    // 그 경우는 unverified_specific_price_claim 이 담당한다 — 두 검사가 같은 글을 두 번 때리지 않는다.
    expect(fabricatedPriceAmounts("# 제목\n\n1종 보통 자동은 500,000원입니다.", "[1] 학원 / 주소: A")).toEqual([]);
  });
});
