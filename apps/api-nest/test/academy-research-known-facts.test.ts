import { describe, expect, it } from "vitest";
import { knownFactsFromSource } from "../src/academy-research-known-facts.js";
import { buildExtractionPrompt } from "../src/academy-research-web.js";

// 파일럿 실측(26곳): 겹치는 영역에서 웹 조사가 원천을 이기지 못한다
// (수강료 23% vs 87% · 셔틀 노선 23% vs 56% · 운영시간 42% vs 67% · 면허과정 46% vs 88%).
// 그런데도 프롬프트가 23개 필드를 전부 요구해 이미 아는 값을 다시 캐고 있었다.

const source = {
  educationPerformance: {
    year: 2026, quarter: 1,
    fees: { type1Manual: 676366, type1Auto: 676366, type2Auto: 676366, vatIncluded: false, examFeeIncluded: true },
    capacity: 299, graduates: 1316,
  },
  operateHour: {
    monOpenTime: "08:00", monCloseTime: "18:30", monIsHoliday: false,
    satOpenTime: "08:00", satCloseTime: "12:00", satIsHoliday: false,
    sunOpenTime: null, sunCloseTime: null, sunIsHoliday: true,
  },
  licenseTypes: [{ code: "type1_normal_manual", label: "1종 보통 수동" }, { code: "type2_normal_auto", label: "2종 보통 자동" }],
  shuttleBuses: [{ title: "1호차", runDirection: "덕포동·삼락동 방면", content: "매일 08:00~18:30 운행" }],
};

const ref = { external_id: "1", name: "테스트운전전문학원", address: "부산광역시 북구 구남로15번길 25", phone: "051-332-4511", region: "부산" };
const webSources = [{ url: "https://example.co.kr", title: "학원", text: "본문" }];

describe("knownFactsFromSource — 원천이 준 값은 조사에서 뺀다", () => {
  it("수강료가 있으면 요금 필드와 과정 배열을 뺀다", () => {
    const known = knownFactsFromSource(source);
    expect(known.skipFields.has("fee_summary")).toBe(true);
    expect(known.skipFields.has("price_disclosed")).toBe(true);
    expect(known.skipCourses).toBe(true);
    expect(known.lines.some((l) => l.startsWith("- 수강료:"))).toBe(true);
  });

  it("운영시간이 있으면 시간·주말·휴무일을 함께 뺀다(요일별 값이 다 들어있다)", () => {
    const known = knownFactsFromSource(source);
    for (const key of ["hours", "weekend", "closed_days"]) expect(known.skipFields.has(key)).toBe(true);
  });

  it("셔틀 노선이 있으면 셔틀 필드와 노선 배열을 뺀다", () => {
    const known = knownFactsFromSource(source);
    expect(known.skipFields.has("shuttle_available")).toBe(true);
    expect(known.skipShuttleRoutes).toBe(true);
  });

  it("면허 과정은 라벨을 그대로 확정 사실로 넘긴다", () => {
    const known = knownFactsFromSource(source);
    expect(known.skipFields.has("licenses")).toBe(true);
    expect(known.lines.some((l) => l.includes("1종 보통 수동, 2종 보통 자동"))).toBe(true);
  });

  it("야간반은 빼지 않는다 — 원천에 필드가 없고 운영시간으로 추론하면 없는 과정을 만든다", () => {
    expect(knownFactsFromSource(source).skipFields.has("night_class")).toBe(false);
  });

  it("원천에 값이 없으면 원천 기반 항목은 빼지 않는다(항상 제외 필드만 남는다)", () => {
    for (const empty of [null, undefined, {}, "", { educationPerformance: null, shuttleBuses: [], licenseTypes: [] }]) {
      const known = knownFactsFromSource(empty);
      expect([...known.skipFields].sort()).toEqual(["kakao_url", "pass_rate", "pass_rate_scope"]);
      expect(known.skipCourses).toBe(false);
      expect(known.lines).toEqual([]);
    }
  });

  it("합격률·카카오맵은 원천과 무관하게 항상 조사에서 뺀다", () => {
    // 합격률 원천이 없어 웹에서 긁으면 홍보 문구가 들어온다(실측 1건이 "수도권 최고 합격률").
    // 카카오맵은 수집 경로가 네이버 플레이스라 나올 자리가 없다(34곳 전부 0건).
    for (const key of ["pass_rate", "pass_rate_scope", "kakao_url"]) {
      expect(knownFactsFromSource(source).skipFields.has(key)).toBe(true);
      expect(knownFactsFromSource(source).skipReasons.get(key)).toContain("조사 대상 제외");
    }
  });

  it("왜 뺐는지 사유를 남긴다 — 값이 빈 것과 조사 대상이 아닌 것은 다르다", () => {
    const known = knownFactsFromSource(source);
    expect(known.skipReasons.get("fee_summary")).toBe("원천 자료(수강료)가 있어 조사하지 않음");
    expect(known.skipReasons.get("hours")).toBe("원천 자료(운영시간)가 있어 조사하지 않음");
    expect(known.skipReasons.get("licenses")).toBe("원천 자료(면허 종별)가 있어 조사하지 않음");
  });
});

describe("buildExtractionPrompt — 뺀 필드는 스키마에서 사라진다", () => {
  it("원천이 없으면 전체 스키마를 요구한다", () => {
    const prompt = buildExtractionPrompt(ref, webSources);
    for (const key of ["fee_summary", "hours", "licenses", "shuttle_summary", "courses", "shuttle_routes", "night_class"]) {
      expect(prompt).toContain(`"${key}"`);
    }
    // 합격률·카카오맵은 원천이 없어도 조사하지 않는다.
    for (const gone of ['"pass_rate"', '"kakao_url"']) expect(prompt).not.toContain(gone);
    expect(prompt).not.toContain("이미 확정된 사실");
  });

  it("원천이 있으면 그 필드가 스키마에서 빠지고 확정 사실로 제시된다", () => {
    const prompt = buildExtractionPrompt(ref, webSources, knownFactsFromSource(source));
    for (const gone of ['"fee_summary"', '"price_disclosed"', '"hours"', '"weekend"', '"closed_days"', '"shuttle_available"', '"shuttle_summary"', '"licenses"', '"courses"', '"shuttle_routes"']) {
      expect(prompt).not.toContain(gone);
    }
    // 원천에 없는 항목은 그대로 남는다
    for (const kept of ['"night_class"', '"self_test"', '"facilities"', '"established_year"', '"homepage_url"']) {
      expect(prompt).toContain(kept);
    }
    expect(prompt).toContain("이미 확정된 사실");
    expect(prompt).toContain("- 수강료:");
  });

  it("필드는 하나씩 빠진다 — 묶인 줄이 통째로 남지 않는다", () => {
    // 원천이 홈페이지 URL 을 주기 시작하는 순간 바로 겪을 상황이다.
    // 예전 구현은 homepage_url·naver_place_url·kakao_url 이 한 줄이라 셋 다 남았다.
    const known = knownFactsFromSource(null);
    known.skipFields.add("homepage_url");
    const prompt = buildExtractionPrompt(ref, webSources, known);
    expect(prompt).not.toContain('"homepage_url"');
    expect(prompt).toContain('"naver_place_url"');
  });

  it("모든 필드가 빠져도 sources 맵은 남아 JSON 형태가 깨지지 않는다", () => {
    const everything = knownFactsFromSource(source);
    for (const key of [
      "name_researched", "address_researched", "phone_researched", "gu", "dong", "jibun_address",
      "night_class", "self_test", "facilities",
      "established_year", "scale", "homepage_url", "naver_place_url",
      "enrollment_prep", "booking_channel",
    ]) {
      everything.skipFields.add(key);
    }
    const prompt = buildExtractionPrompt(ref, webSources, everything);
    expect(prompt).toContain('{\n  "sources": { "<field_key>": "<근거 소스 URL>" }\n}');
  });
});
