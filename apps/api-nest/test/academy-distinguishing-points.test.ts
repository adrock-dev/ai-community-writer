import { describe, expect, it } from "vitest";
import {
  academyDistinguishingPoints, districtOf, distinguishingPointsFactLine,
  parseBusinessHours, parseCoursePrices, shuttleStopCount,
} from "../src/academy-distinguishing-points.js";
import { t16FactsForPrompt } from "../src/t16-axis-comparison.js";

// 실제 원주시 T16 후보 4곳(data/admin.db 값). 이 조합에서 네 곳의 영업시간이 모두 다르고
// 수강료는 12만원 차이가 나는데도 생성 글이 한 번도 그 차이를 쓰지 못했다 — 그래서 만든 계층이다.
const WONJU = [
  {
    name: "흥업 자동차운전전문학원", address: "강원특별자치도 원주시 흥업면 승안동길 43",
    price: "1종 보통 수동 780,000원, 1종 보통 자동 900,000원, 2종 보통 자동 780,000원 (부가세 별도, 검정료 포함, 2026년 1분기 기준)",
    hours: "월~일 08:00~20:00",
    shuttle: "운행 지역(자료 기준) 원주시(개운동·단계동·단구동·명륜동 등) · 경유지 명륜동, 개운동, 구곡택지, 봉산동 등 15곳",
    extra: JSON.stringify({ license_types: [{ code: "c1m", label: "1종 보통 수동" }, { code: "c1a", label: "1종 보통 자동" }, { code: "c2a", label: "2종 보통 자동" }, { code: "l1", label: "1종 대형" }, { code: "m2", label: "2종 소형" }] }),
  },
  {
    name: "원주자동차운전전문학원", address: "강원특별자치도 원주시 행구로 199",
    price: "1종 보통 수동 780,000원, 1종 보통 자동 830,000원, 2종 보통 자동 780,000원",
    hours: "월~금 07:00~21:00 · 토~일 휴무",
    shuttle: "운행 지역(자료 기준) 학원셔틀",
    extra: JSON.stringify({ license_types: [{ code: "c1m", label: "1종 보통 수동" }, { code: "c1a", label: "1종 보통 자동" }, { code: "c2a", label: "2종 보통 자동" }] }),
  },
  {
    name: "매지자동차운전전문학원", address: "강원특별자치도 원주시 흥업면 북원로 1476-9",
    price: "1종 보통 수동 780,000원, 1종 보통 자동 830,000원, 2종 보통 자동 780,000원",
    hours: "월~금 08:00~21:00 · 토~일 08:00~17:00",
    shuttle: "운행 지역(자료 기준) 원주시(가현동·개운동·관설동·귀래면 등)",
    extra: JSON.stringify({ license_types: [{ code: "c1m", label: "1종 보통 수동" }, { code: "c1a", label: "1종 보통 자동" }, { code: "c2a", label: "2종 보통 자동" }] }),
  },
  {
    name: "횡성신진자동차운전전문학원", address: "강원특별자치도 횡성군 횡성읍 입석로 118",
    price: "1종 보통 수동 820,000원, 1종 보통 자동 780,000원, 2종 보통 자동 780,000원",
    hours: "월~금 08:00~20:00 · 토~일 08:00~17:00",
    shuttle: "",
    extra: JSON.stringify({ license_types: [{ code: "c1m", label: "1종 보통 수동" }, { code: "c1a", label: "1종 보통 자동" }, { code: "c2a", label: "2종 보통 자동" }, { code: "l1", label: "1종 대형" }] }),
  },
];

describe("parseBusinessHours", () => {
  it("주말 휴무와 주말 운영을 구분한다", () => {
    expect(parseBusinessHours("월~금 07:00~21:00 · 토~일 휴무")).toEqual({ openMinutes: 7 * 60, closeMinutes: 21 * 60, opensSaturday: false, opensSunday: false });
    expect(parseBusinessHours("월~일 08:00~20:00")).toEqual({ openMinutes: 8 * 60, closeMinutes: 20 * 60, opensSaturday: true, opensSunday: true });
  });

  it("토요일만 여는 경우 일요일은 운영으로 보지 않는다", () => {
    const hours = parseBusinessHours("월~금 08:00~18:00 · 토 08:00~12:00 · 일 휴무");
    expect(hours?.opensSaturday).toBe(true);
    expect(hours?.opensSunday).toBe(false);
  });

  it("휴게시간 구간은 영업 시간 계산에서 제외한다", () => {
    // 휴게 구간(12:00~13:00)을 세면 개점이 12:00 으로 밀려 '가장 이른 곳' 판정이 뒤집힌다.
    expect(parseBusinessHours("월~일 09:00~18:00 · 매일 12:00 ~ 13:00 휴게시간")).toEqual({ openMinutes: 9 * 60, closeMinutes: 18 * 60, opensSaturday: true, opensSunday: true });
  });

  it("값이 없으면 null", () => {
    expect(parseBusinessHours("")).toBeNull();
    expect(parseBusinessHours(null)).toBeNull();
  });
});

describe("parseCoursePrices / shuttleStopCount / districtOf", () => {
  it("과정별 금액을 읽는다", () => {
    const prices = parseCoursePrices("1종 보통 수동 780,000원, 1종 보통 자동 900,000원");
    expect(prices.get("1종 보통 수동")).toBe(780000);
    expect(prices.get("1종 보통 자동")).toBe(900000);
  });

  it("경유지 수는 명시된 경우에만 읽는다", () => {
    expect(shuttleStopCount("운행 지역(자료 기준) 원주시(개운동 등) · 경유지 명륜동, 개운동 등 15곳")).toBe(15);
    expect(shuttleStopCount("운행 지역(자료 기준) 학원셔틀")).toBeNull();
  });

  it("주소에서 시·군을 뽑는다", () => {
    expect(districtOf("강원특별자치도 원주시 흥업면 승안동길 43")).toBe("원주시");
    expect(districtOf("강원특별자치도 횡성군 횡성읍 입석로 118")).toBe("횡성군");
  });
});

describe("academyDistinguishingPoints", () => {
  const points = academyDistinguishingPoints(WONJU);

  it("주말 운영이 여러 곳이면 '유일'을 만들지 않는다", () => {
    // 흥업(월~일)·매지(토~일 08:00~17:00)·횡성신진(토~일)이 모두 주말에 열어 유일하지 않다.
    // 원주 한 곳만 주말 휴무라고 해서 나머지 셋에게 '유일한 연중무휴'를 줄 수는 없다.
    expect(points.flat().some((point) => point.includes("연중무휴"))).toBe(false);
    expect(points.flat().some((point) => point.includes("유일하게 주말에도 운영"))).toBe(false);
  });

  it("개점이 가장 이른 곳과 마감이 가장 늦은 곳을 찾는다", () => {
    expect(points[1]?.some((point) => point.includes("개점이 4곳 중 가장 이름(07:00)"))).toBe(true);
    // 21:00 마감이 원주·매지 둘이라 동점 — 동점이면 '가장 늦음'을 만들지 않는다.
    expect(points.flat().some((point) => point.includes("마감이"))).toBe(false);
  });

  it("모든 후보가 함께 표시한 과정에서만 수강료를 비교한다", () => {
    // 1종 보통 수동: 780/780/780/820 → 최저가 셋이라 동점, 만들지 않는다.
    // 1종 보통 자동: 900/830/830/780 → 횡성신진만 780,000원으로 유일한 최저.
    expect(points[3]?.some((point) => point.includes("표시 수강료가 4곳 중 가장 낮음"))).toBe(true);
    expect(points[3]?.join(" ")).toContain("780,000원");
  });

  it("혼자 다른 시·군에 있는 학원을 짚는다", () => {
    expect(points[3]?.some((point) => point.includes("혼자 다른 시·군에 있음(횡성군)"))).toBe(true);
  });

  it("경유지 수를 밝힌 학원이 하나뿐이면 비교형 대신 사실형으로 쓴다", () => {
    // 흥업만 "등 15곳"으로 경유지 수를 밝혔다. 비교 대상이 없으니 '가장 많음'은 성립하지 않지만,
    // 그렇다고 빼면 혼자만 상세한 학원이 아무 특징 없는 카드가 된다 — 비교 없는 사실로 남긴다.
    expect(points[0]?.some((point) => point === "셔틀 경유지 15곳까지 안내됨")).toBe(true);
    expect(points.flat().some((point) => point.includes("가장 많음(15곳)"))).toBe(false);
    // 둘 이상이 밝히면 그때 비교한다.
    const withTwo = academyDistinguishingPoints([
      { ...WONJU[0], shuttle: "경유지 A, B 등 15곳" },
      { ...WONJU[1], shuttle: "경유지 C 등 3곳" },
    ]);
    expect(withTwo[0]?.some((point) => point.includes("셔틀 경유지가 2곳 중 가장 많음(15곳)"))).toBe(true);
  });

  it("과정이 가장 많은 곳과 보통면허에 집중한 곳을 구분한다", () => {
    expect(points[0]?.some((point) => point.includes("운영 과정이 4곳 중 가장 많음(5종)"))).toBe(true);
    // 3종이 원주·매지 둘이라 '가장 적음'은 동점 — 억지로 만들지 않는다.
    expect(points.flat().some((point) => point.includes("집중"))).toBe(false);
  });

  it("그 학원에서만 운영하는 과정을 짚는다", () => {
    // 2종 소형은 흥업만 운영한다. 1종 대형은 횡성신진도 운영하므로 '여기만'이 될 수 없다.
    const onlyHere = points[0]?.find((point) => point.includes("여기만 운영"));
    expect(onlyHere).toBe("2종 소형 과정은 4곳 중 여기만 운영");
    // 세 곳이 함께 가진 보통면허 과정은 '여기만 운영'이 될 수 없다.
    expect(points.flat().some((point) => point.includes("1종 보통 자동 과정은"))).toBe(false);
  });

  it("후보가 1곳이면 비교 자체를 하지 않는다", () => {
    expect(academyDistinguishingPoints([WONJU[0]!])).toEqual([[]]);
  });

  it("한 학원에 최대 3개까지만 준다", () => {
    for (const list of points) expect(list.length).toBeLessThanOrEqual(3);
  });
});

describe("t16FactsForPrompt", () => {
  it("후보 줄에 '이 학원이 두드러지는 점'을 붙인다", () => {
    const facts = ["[1] 흥업 자동차운전전문학원 / 주소: A / 좌표: 1, 2", "[2] 원주자동차운전전문학원 / 주소: B"].join("\n");
    const out = t16FactsForPrompt(facts, WONJU);
    expect(out).toContain("[1] 흥업 자동차운전전문학원 / 주소: A / 이 학원이 두드러지는 점: ");
    expect(out).toContain("운영 과정이 4곳 중 가장 많음(5종)");
    // 기존 동작(좌표·SEO 필드 제거)은 유지한다.
    expect(out).not.toContain("좌표");
  });

  it("후보를 넘기지 않으면 기존 동작 그대로다", () => {
    const facts = "[1] 흥업 자동차운전전문학원 / 주소: A / SEO 키워드: x";
    expect(t16FactsForPrompt(facts)).toBe("[1] 흥업 자동차운전전문학원 / 주소: A");
  });
});

describe("distinguishingPointsFactLine", () => {
  it("점이 없으면 null", () => {
    expect(distinguishingPointsFactLine([])).toBeNull();
    expect(distinguishingPointsFactLine(undefined)).toBeNull();
  });
});
