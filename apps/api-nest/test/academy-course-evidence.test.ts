import { describe, expect, it } from "vitest";
import { availableLicensesFromSource, courseFactText } from "../src/academy-course-evidence.js";

// 원천이 licenseTypes 를 구조화해 내려주므로 그 값을 우선 쓴다.
// 정규식 폴백은 자동·수동을 구분하지 못하고 소개 문구에 안 적힌 과정을 놓친다.

const description = "한미자동차운전전문학원은 경기도 양주시에 자리한 양주 운전면허학원입니다. 1종·2종 보통, 1종 대형 면허 취득 과정을 운영합니다.";
const extra = (types: Array<{ code: string; label: string }>) => JSON.stringify({ license_types: types });

describe("availableLicensesFromSource — 구조화 필드 우선", () => {
  it("license_types 가 있으면 그 값을 쓰고 소개 문구를 파싱하지 않는다", () => {
    const row = {
      seo_description: description,
      extra: extra([
        { code: "type1_normal_auto", label: "1종 보통 자동" },
        { code: "type1_normal_manual", label: "1종 보통 수동" },
      ]),
    };
    // 정규식이라면 "1종 보통, 2종 보통, 1종 대형" 이 나온다.
    expect(availableLicensesFromSource(row)).toEqual(["1종 보통 수동", "1종 보통 자동"]);
  });

  it("입력 순서와 무관하게 표준 순서로 정렬한다(같은 입력 → 같은 문장)", () => {
    const shuffled = extra([
      { code: "type1_special_rescue", label: "1종 특수 구난" },
      { code: "type2_normal_auto", label: "2종 보통 자동" },
      { code: "type1_large", label: "1종 대형" },
      { code: "type1_normal_manual", label: "1종 보통 수동" },
    ]);
    expect(availableLicensesFromSource({ extra: shuffled })).toEqual([
      "1종 보통 수동", "2종 보통 자동", "1종 대형", "1종 특수 구난",
    ]);
  });

  it("중복 라벨은 한 번만 남긴다", () => {
    const duplicated = extra([
      { code: "type1_large", label: "1종 대형" },
      { code: "type1_large", label: "1종 대형" },
    ]);
    expect(availableLicensesFromSource({ extra: duplicated })).toEqual(["1종 대형"]);
  });

  it("문자열이 아닌 객체 형태의 extra 도 읽는다", () => {
    const row = { extra: { license_types: [{ code: "type2_small", label: "2종 소형" }] } };
    expect(availableLicensesFromSource(row)).toEqual(["2종 소형"]);
  });

  it("알 수 없는 코드는 버리지 않고 뒤에 붙인다", () => {
    const row = { extra: extra([{ code: "future_code", label: "신설 과정" }, { code: "type1_large", label: "1종 대형" }]) };
    expect(availableLicensesFromSource(row)).toEqual(["1종 대형", "신설 과정"]);
  });
});

describe("availableLicensesFromSource — 정규식 폴백", () => {
  it("license_types 가 없으면 소개 문구에서 추출한다", () => {
    expect(availableLicensesFromSource({ seo_description: description })).toEqual(["1종 보통", "2종 보통", "1종 대형"]);
  });

  it("license_types 가 빈 배열이면 폴백한다(시험장처럼 과정이 없는 행 포함)", () => {
    expect(availableLicensesFromSource({ seo_description: description, extra: extra([]) })).toEqual(["1종 보통", "2종 보통", "1종 대형"]);
    expect(availableLicensesFromSource({ extra: extra([]) })).toEqual([]);
  });

  it("깨진 extra JSON 때문에 동기화 결과 전체가 날아가지 않는다", () => {
    expect(availableLicensesFromSource({ seo_description: description, extra: "{not json" })).toEqual(["1종 보통", "2종 보통", "1종 대형"]);
  });

  it("학원명·지역만으로 과정을 추론하지 않는다", () => {
    expect(availableLicensesFromSource({ name: "대형운전전문학원", region: "경기도 양주시" })).toEqual([]);
  });
});

describe("courseFactText", () => {
  it("과정이 없으면 null 이다(빈 문자열로 단정하지 않는다)", () => {
    expect(courseFactText({})).toBeNull();
  });

  it("facts 라벨에 그대로 쓸 수 있는 문자열을 만든다", () => {
    const row = { extra: extra([{ code: "type1_normal_manual", label: "1종 보통 수동" }, { code: "type1_large", label: "1종 대형" }]) };
    expect(courseFactText(row)).toBe("1종 보통 수동, 1종 대형");
  });
});
