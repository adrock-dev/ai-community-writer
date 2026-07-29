import { expect, it } from "vitest";
import { unusedResearchLines } from "../src/post-insight.controller.js";

/**
 * 「보냈지만 본문이 안 쓴 조사 근거」 판정.
 *
 * 완전한 판정은 아니다 — 모델이 값을 바꿔 쓸 수 있다. 그래서 화면도 단정하지 않고
 * 목록으로만 보여준다. 여기서 고정하는 것은 "원문에서 (조사) 줄만 골라낸다" 는 규칙이다.
 */
const SNAPSHOT = [
  "[1] 가나학원 / 주소: 서울시 / 편의시설(조사): 발렛파킹 / 자체 시험장(조사): 매일 자체시험",
  "[2] 다라학원 / 주소: 부산시 / 수강료: 70만원 / 야간반(조사): 평일 19:30~20:20",
].join("\n");

it("본문에 낱말이 하나도 없는 조사 줄만 골라낸다", () => {
  const body = "가나학원은 매일 자체시험을 봅니다. 다라학원은 평일 19:30~20:20 교육이 있어요.";
  expect(unusedResearchLines(SNAPSHOT, body)).toEqual([
    { academy: "가나학원", label: "편의시설(조사)", value: "발렛파킹" },
  ]);
});

it("원천 사실은 대상이 아니다 — (조사) 줄만 본다", () => {
  // 주소·수강료가 본문에 없어도 여기서 다루지 않는다. 조사값이 쓰였는지가 관심사다.
  const rows = unusedResearchLines(SNAPSHOT, "아무 말도 없는 본문");
  expect(rows.map((r) => r.label)).toEqual(["편의시설(조사)", "자체 시험장(조사)", "야간반(조사)"]);
});

it("근거 원문이 없으면 빈 목록", () => {
  expect(unusedResearchLines("", "본문")).toEqual([]);
});
