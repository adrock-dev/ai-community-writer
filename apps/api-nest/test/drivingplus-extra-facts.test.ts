import { describe, expect, it } from "vitest";
import { formatExtraCourseFeeFact } from "../src/drivingplus-academy-facts.js";

// 공식 수강료(educationPerformance)는 1·2종 보통만 덮는다. 대형·특수·소형·원동기·도로연수
// 가격은 원천 관측값(price_observations)에만 있어 글에 들어갈 길이 없었다. 실측 146곳(38%).
//
// road_courses 는 일부러 쓰지 않는다 — title 이 "도로주행A~D" 표준 라벨이라 380곳이 같고,
// 개수도 93%가 4개다. 실질 가치인 코스 사진은 이미지 슬롯 쪽 일이다.

describe("formatExtraCourseFeeFact — 공식 수강료가 덮지 못하는 과정", () => {
  const obs = (over: Record<string, unknown>) => ({
    source: "homepage", sourceUrl: "https://x", licenseType: null, courseType: "license_acquisition",
    gearType: null, applicantType: null, priceUnit: "course", priceKind: "fixed",
    amount: null, amountMax: null, amountVatIncluded: null, vatIncluded: true, examFeeIncluded: true, ...over,
  }) as any;
  const fees = { year: 2026, quarter: 1, fees: { type1Manual: 700000, type1Auto: 700000, type2Auto: 700000 } } as any;

  it("공식 수강료가 있으면 1·2종 보통은 적지 않는다(두 금액이 본문에서 부딪힌다)", () => {
    const text = formatExtraCourseFeeFact([
      obs({ licenseType: "1종 보통", amount: 627000 }),
      obs({ licenseType: "1종 대형", amount: 720000 }),
    ], fees)!;
    expect(text).not.toContain("627,000");
    expect(text).toContain("1종 대형 720,000원");
  });

  it("공식 수강료가 없으면 보통 면허도 적는다", () => {
    const text = formatExtraCourseFeeFact([obs({ licenseType: "1종 보통", amount: 627000 })], null)!;
    expect(text).toContain("1종 보통 627,000원");
  });

  it("도로연수는 면허 종류와 무관하게 항상 적는다 — 공식 수강료가 다루지 않는다", () => {
    const text = formatExtraCourseFeeFact([
      obs({ licenseType: null, courseType: "driving_training", amount: 297000 }),
    ], fees)!;
    expect(text).toContain("도로연수 297,000원");
  });

  it("시간당 표기는 전부 버린다 — 총액에도 hour 가 붙어 있어 신뢰할 수 없다", () => {
    // 실측: 제일학원 "도로연수(6시간)" 총액 360,000원이 priceUnit=hour 로 들어온다.
    // 그대로 쓰면 "시간당 36만원" 이 되어 6시간에 216만원짜리 문장이 나온다.
    expect(formatExtraCourseFeeFact([
      obs({ licenseType: null, courseType: "driving_training", priceUnit: "hour", amount: 360000 }),
      obs({ licenseType: "1종 대형", priceUnit: "hour", amount: 660000 }),
    ], fees)).toBeNull();
  });

  it("학원 홈페이지 출처만 쓴다 — 플레이스·블로그 수집값은 제외", () => {
    expect(formatExtraCourseFeeFact([
      obs({ source: "naver_place", licenseType: "1종 대형", amount: 720000 }),
      obs({ source: "naver_blog", licenseType: "2종 소형", amount: 350000 }),
    ], fees)).toBeNull();
  });

  it("같은 과정에 값이 여러 개면 최저가에 '부터' 를 붙여 단정하지 않는다", () => {
    const text = formatExtraCourseFeeFact([
      obs({ licenseType: "1종 대형", amount: 720000 }),
      obs({ licenseType: "1종 대형", amount: 800000 }),
    ], fees)!;
    expect(text).toContain("1종 대형 720,000원부터");
  });

  it("값이 하나뿐이면 '부터' 를 붙이지 않는다", () => {
    const text = formatExtraCourseFeeFact([obs({ licenseType: "1종 대형", amount: 720000 })], fees)!;
    expect(text).toContain("1종 대형 720,000원");
    expect(text).not.toContain("부터");
  });

  it("수집 시점을 붙인다 — 학원 원칙이 '자료의 기준 시점 값' 을 밝히라고 요구한다", () => {
    const text = formatExtraCourseFeeFact([
      obs({ licenseType: "1종 대형", amount: 720000, collectedAt: "2026-07-14T01:40:47.000Z" }),
      obs({ licenseType: "2종 소형", amount: 350000, collectedAt: "2026-05-02T00:00:00.000Z" }),
    ], fees)!;
    // 여러 시점이 섞이면 가장 최근 것을 적는다.
    expect(text).toContain("(학원 홈페이지 게시 기준, 2026년 07월 수집)");
  });

  it("수집 시점이 없으면 시점 없이 출처만 적는다", () => {
    const text = formatExtraCourseFeeFact([obs({ licenseType: "1종 대형", amount: 720000 })], fees)!;
    expect(text).toContain("(학원 홈페이지 게시 기준)");
  });

  it("금액이 없거나 0 이하면 버린다", () => {
    expect(formatExtraCourseFeeFact([
      obs({ licenseType: "1종 대형", amount: null }),
      obs({ licenseType: "2종 소형", amount: 0 }),
    ], fees)).toBeNull();
  });
});
