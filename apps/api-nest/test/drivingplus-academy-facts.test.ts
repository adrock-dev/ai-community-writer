import { describe, expect, it } from "vitest";
import { factSafeText, formatOperatingHoursFact, formatShuttleFact, formatTuitionFact } from "../src/drivingplus-academy-facts.js";

// 표본은 실제 DrivingPlus dev 응답에서 그대로 가져왔다.
// 이 세 값은 생성 프롬프트의 facts 로 그대로 들어가므로 사실 왜곡·필드 경계 붕괴를 막는 게 목적이다.

describe("factSafeText", () => {
  it("facts 필드 경계를 깨는 슬래시와 개행을 제거한다", () => {
    // 실재 노선명: "공휴일/일요일 노선". facts 는 " / " 로 필드를 잇는다.
    expect(factSafeText("공휴일/일요일 노선")).toBe("공휴일·일요일 노선");
    expect(factSafeText("첫째 줄\n둘째  줄")).toBe("첫째 줄 둘째 줄");
  });
});

describe("formatTuitionFact", () => {
  const performance = {
    year: 2026, quarter: 1,
    fees: { type1Manual: 712000, type1Auto: 824000, type2Auto: 712000, vatIncluded: true, examFeeIncluded: true },
    capacity: 140, graduates: 481, injuryAccidents: 2, accidentRate: 0.0042,
  };

  it("면허별 금액과 포함 조건, 기준 분기를 함께 적는다", () => {
    expect(formatTuitionFact(performance)).toBe(
      "1종 보통 수동 712,000원, 1종 보통 자동 824,000원, 2종 보통 자동 712,000원 (부가세 포함, 검정료 포함, 2026년 1분기 기준)",
    );
  });

  it("별도 조건을 포함으로 뒤집지 않는다", () => {
    const separate = { ...performance, fees: { ...performance.fees, vatIncluded: false, examFeeIncluded: false } };
    expect(formatTuitionFact(separate)).toContain("부가세 별도, 검정료 별도");
  });

  it("값이 없는 면허 종류는 만들지 않는다", () => {
    const partial = { ...performance, fees: { ...performance.fees, type1Auto: null, type2Auto: 0 } };
    const text = formatTuitionFact(partial);
    expect(text).toContain("1종 보통 수동 712,000원");
    expect(text).not.toContain("1종 보통 자동");
    expect(text).not.toContain("2종 보통 자동");
  });

  it("수강료 자료가 없으면 null 이다(빈 문자열로 단정하지 않는다)", () => {
    expect(formatTuitionFact(null)).toBeNull();
    expect(formatTuitionFact({ ...performance, fees: null })).toBeNull();
    expect(formatTuitionFact({ ...performance, fees: { type1Manual: null, type1Auto: null, type2Auto: null, vatIncluded: true, examFeeIncluded: true } })).toBeNull();
  });
});

describe("formatShuttleFact", () => {
  it("노선 수·노선명·경유지·문의처를 자료 그대로 적는다", () => {
    const text = formatShuttleFact([
      { title: "1호차", runDirection: "신제주", content: null, footContent: null, phone: "064-000-0000", times: [{ time: "", runDirection: "학원출발" }, { time: "7분", runDirection: "연동" }] },
      { title: "2호차", runDirection: "구제주", content: null, footContent: null, phone: null, times: [{ time: "9분", runDirection: "노형" }] },
    ]);
    expect(text).toBe("운행 노선 2개(1호차, 2호차) · 자료 기준 경유지 3곳(학원출발, 연동, 노형 등) · 셔틀 문의 064-000-0000");
  });

  it("노선이 많아도 프롬프트가 부풀지 않게 앞의 몇 개만 나열하고 나머지는 개수로 적는다", () => {
    const many = ["1호차", "2호차", "3호차", "4호차", "5호차"].map((title) => ({ title, runDirection: null, content: null, footContent: null, phone: null, times: [] }));
    expect(formatShuttleFact(many)).toBe("운행 노선 5개(1호차, 2호차, 3호차 외 2개)");
  });

  it("시간표가 없는 노선도 운행 사실만 적고 경유지를 만들지 않는다", () => {
    const text = formatShuttleFact([{ title: "목포 전지역", runDirection: "예약 시 운행", content: null, footContent: null, phone: null, times: [] }]);
    expect(text).toBe("운행 노선 1개(목포 전지역)");
    expect(text).not.toContain("경유지");
  });

  it("셔틀 자료가 없으면 null 이다", () => {
    expect(formatShuttleFact([])).toBeNull();
    expect(formatShuttleFact(null)).toBeNull();
  });
});

describe("formatOperatingHoursFact", () => {
  const base = {
    monOpenTime: "08:00", monCloseTime: "18:00", monIsHoliday: false,
    tueOpenTime: "08:00", tueCloseTime: "18:00", tueIsHoliday: false,
    wedOpenTime: "08:00", wedCloseTime: "18:00", wedIsHoliday: false,
    thuOpenTime: "08:00", thuCloseTime: "18:00", thuIsHoliday: false,
    friOpenTime: "08:00", friCloseTime: "18:00", friIsHoliday: false,
    satOpenTime: "08:00", satCloseTime: "12:00", satIsHoliday: false,
    sunOpenTime: "", sunCloseTime: "", sunIsHoliday: true,
    holidayOpenTime: "", holidayCloseTime: "", notice: "",
  };

  it("같은 값이 이어지는 요일을 묶고 휴무일을 명시한다", () => {
    expect(formatOperatingHoursFact(base)).toBe("월~금 08:00~18:00 · 토 08:00~12:00 · 일 휴무");
  });

  it("연중 동일하면 한 구간으로 묶는다", () => {
    const always = Object.fromEntries(Object.entries(base).map(([key, value]) => {
      if (key.endsWith("OpenTime")) return [key, "06:00"];
      if (key.endsWith("CloseTime")) return [key, "22:00"];
      if (key.endsWith("IsHoliday")) return [key, false];
      return [key, value];
    })) as typeof base;
    expect(formatOperatingHoursFact({ ...always, holidayOpenTime: "", holidayCloseTime: "" })).toBe("월~일 06:00~22:00");
  });

  it("휴게시간 같은 공지를 함께 적는다", () => {
    expect(formatOperatingHoursFact({ ...base, notice: "매일 12:00 ~ 13:00 휴게시간" })).toContain("매일 12:00 ~ 13:00 휴게시간");
  });

  it("운영시간 자료가 없으면 null 이다", () => {
    expect(formatOperatingHoursFact(null)).toBeNull();
    const empty = Object.fromEntries(Object.keys(base).map((key) => [key, key.endsWith("IsHoliday") ? false : ""])) as typeof base;
    expect(formatOperatingHoursFact(empty)).toBeNull();
  });
});
