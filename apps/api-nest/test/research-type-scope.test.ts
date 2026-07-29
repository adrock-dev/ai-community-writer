import { expect, it } from "vitest";
import { knownFactsFromSource } from "../src/academy-research-known-facts.js";

/**
 * 조사 스키마는 운전전문학원 기준인데 목록에는 운전면허시험장(관공서)도 섞여 있다.
 * 시험장에 "자체 시험장이 있나" 를 묻는 것은 동어반복이고, 수강료·야간반·셔틀·면허 과정은
 * 해당이 없다. 실측 27곳에서 모두 빈칸으로 돌아왔고, enrollment_prep 에는 시험장 민원 안내가
 * 학원 등록 준비물로 잘못 담겼다.
 */
const ACADEMY_ONLY = ["self_test", "night_class", "weekend", "fee_summary", "price_disclosed", "shuttle_summary", "shuttle_available", "licenses", "enrollment_prep"];

it("시험장에는 학원 전용 항목을 묻지 않는다", () => {
  const known = knownFactsFromSource({ id: 1, title: "○○ 운전면허시험장", type: "license_test_course" });
  for (const field of ACADEMY_ONLY) {
    expect(known.skipFields.has(field), `${field} 가 빠져야 한다`).toBe(true);
    expect(known.skipReasons.get(field)).toContain("시험장");
  }
  expect(known.skipCourses).toBe(true);
  expect(known.skipShuttleRoutes).toBe(true);
});

it("편의시설·영업시간·휴무일은 시험장에도 뜻이 통하므로 그대로 묻는다", () => {
  const known = knownFactsFromSource({ id: 1, title: "○○ 운전면허시험장", type: "license_test_course" });
  for (const field of ["facilities", "hours", "closed_days", "homepage_url"]) {
    expect(known.skipFields.has(field), `${field} 는 물어야 한다`).toBe(false);
  }
});

it("학원은 종전대로 전부 묻는다", () => {
  const known = knownFactsFromSource({ id: 2, title: "○○자동차운전전문학원", type: "exam_academy" });
  for (const field of ACADEMY_ONLY) {
    expect(known.skipFields.has(field), `${field} 는 물어야 한다`).toBe(false);
  }
});

it("면허센터도 시험장과 같게 다룬다", () => {
  const known = knownFactsFromSource({ id: 3, title: "○○ 면허센터", type: "license_center" });
  expect(known.skipFields.has("self_test")).toBe(true);
});
