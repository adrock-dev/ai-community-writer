import { describe, expect, it } from "vitest";
import {
  extractClaims, fieldTypeIssues, findingNote, hasEvidenceRule, hasFinding, inspectResearchValue, isClaimGrounded,
} from "../src/academy-research-grounding.js";

// 조사값은 여러 출처가 섞인 서술문이라 값 전체를 소스와 대조할 수 없다.
// 숫자 클레임만 뽑아 개별 대조한다 — 날조는 숫자에서 나온다.

const raws = (value: string) => extractClaims(value).map((c) => c.raw);
const norms = (value: string) => extractClaims(value).map((c) => c.norm);

describe("extractClaims — 서술문에서 검증 대상 숫자 뽑기", () => {
  it("실제 저장된 fee_summary 에서 금액을 전부 뽑는다", () => {
    const value = "취득가능면허 1종보통·2종자동 각 680,010원(학과·장내기능·도로주행 및 검정료 포함, 부가세 10% 별도).";
    expect(raws(value)).toEqual(["680,010원", "10%"]);
  });

  it("만·천 단위 표기를 원 단위 정수로 정규화한다", () => {
    expect(norms("기본반 78만원")).toEqual([780000]);
    expect(norms("38만 5천원")).toEqual([385000]);
    expect(norms("820,000원")).toEqual([820000]);
  });

  it("같은 금액이 반복돼도 한 번만 검증한다", () => {
    expect(norms("1종보통 708,190원, 2종자동 708,190원")).toEqual([708190]);
  });

  it("금액·시간·연도·규모를 종류별로 구분한다", () => {
    const value = "1978년 설립, 평일 09:00 - 20:00 운영, 총부지 6,661㎡, 정원 560명";
    expect(extractClaims(value).map((c) => `${c.kind}:${c.norm}`)).toEqual([
      "year:1978", "time:9:00", "time:20:00", "count:6661㎡", "count:560명",
    ]);
  });

  it("숫자가 없으면 검증 대상이 없다", () => {
    expect(extractClaims("셔틀버스 운행 여부는 소스에 없음")).toEqual([]);
    expect(extractClaims(null)).toEqual([]);
  });
});

describe("isClaimGrounded — 표기 차이를 흡수한 대조", () => {
  const claim = (value: string) => extractClaims(value)[0]!;

  it("콤마 유무가 달라도 같은 금액으로 본다", () => {
    expect(isClaimGrounded(claim("680,010원"), "수강료 680010원 입니다")).toBe(true);
    expect(isClaimGrounded(claim("680010원"), "수강료 680,010원 입니다")).toBe(true);
  });

  it("만 단위 표기와 숫자 표기를 서로 인정한다", () => {
    expect(isClaimGrounded(claim("78만원"), "기본반 780,000원")).toBe(true);
    expect(isClaimGrounded(claim("780,000원"), "기본반 78만원")).toBe(true);
    expect(isClaimGrounded(claim("38만 5천원"), "385,000원")).toBe(true);
  });

  it("자릿수가 다른 금액을 같은 값으로 착각하지 않는다", () => {
    // 8,200,000 안에 820,000 이 부분 문자열로 들어있지만 다른 금액이다.
    expect(isClaimGrounded(claim("820,000원"), "총 8,200,000원")).toBe(false);
  });

  it("09:00 은 소스의 9:00·9시와 같은 시각으로 본다", () => {
    expect(isClaimGrounded(claim("09:00"), "평일 9:00 부터")).toBe(true);
    expect(isClaimGrounded(claim("09:00"), "오전 9시 개원")).toBe(true);
    expect(isClaimGrounded(claim("09:00"), "오전 10시 개원")).toBe(false);
  });

  it("소스에 없는 금액은 근거 없음으로 본다", () => {
    expect(isClaimGrounded(claim("999,000원"), "수강료 680,010원")).toBe(false);
  });
});

describe("fieldTypeIssues — 소스에 있어도 그 필드에 담기면 안 되는 값", () => {
  // 아래 값들은 실제 DB(academy_research)에 저장돼 있던 것이다.
  it("합격률에 수치 없는 광고 문구가 들어오면 잡는다", () => {
    const value = "타사보다 더 높은 합격률, 수도권 최고 합격률, 높은 합격률 전국 최고쉬운 도로주행이라고 주장";
    expect(fieldTypeIssues("pass_rate", value)).toEqual([
      "합격률에 수치가 없음(서술만)",
      "광고성 주장 표현 포함(최고)",
    ]);
  });

  it("규모에 들어온 과장 표현을 잡는다", () => {
    expect(fieldTypeIssues("scale", "전국 최대규모 운전학원, 서울/수도권 지역 제일 큰 규모라고 주장"))
      .toEqual(["광고성 주장 표현 포함(최대)"]);
  });

  it("요금에 섞인 개인 거래 플랫폼 가격을 잡는다", () => {
    const value = "1종/2종 총 비용 820,000원. 당근 가격: 1종 수동/자동 710,000원~";
    expect(fieldTypeIssues("fee_summary", value)).toEqual(["개인 거래 플랫폼 가격이 섞임(당근)"]);
  });

  it("정상 값은 통과시킨다", () => {
    expect(fieldTypeIssues("pass_rate", "학과 92%, 장내기능 88%")).toEqual([]);
    expect(fieldTypeIssues("scale", "총부지면적 6,661㎡, 교육생 정원 560명")).toEqual([]);
    expect(fieldTypeIssues("fee_summary", "1종보통 708,190원, 2종자동 708,190원")).toEqual([]);
  });

  it("광고 표현 검사는 해당 필드에만 적용한다", () => {
    // hours 는 과장 claim 리스크가 없는 필드다.
    expect(fieldTypeIssues("hours", "평일 09:00 - 20:00, 가장 늦게까지")).toEqual([]);
  });
});

describe("inspectResearchValue — 두 축을 함께 본 결과", () => {
  const source = "구포북부운전전문학원 수강료 680,010원, 부가세 10% 별도. 총부지 6,661㎡, 정원 560명.";

  it("소스에 근거가 있으면 지적하지 않는다", () => {
    const report = inspectResearchValue("fee_summary", "1종보통·2종자동 각 680,010원(부가세 10% 별도)", source);
    expect(report.ungrounded).toEqual([]);
    expect(report.grounded).toBe(2);
    expect(hasFinding(report)).toBe(false);
    expect(findingNote(report)).toBeUndefined();
  });

  it("소스에 없는 금액만 골라낸다", () => {
    const report = inspectResearchValue("fee_summary", "680,010원, 추가 보험료 5,300원", source);
    expect(report.ungrounded.map((c) => c.raw)).toEqual(["5,300원"]);
    expect(report.grounded).toBe(1);
    expect(findingNote(report)).toBe("소스에서 확인 안 됨: 5,300원");
  });

  it("근거 부족과 필드 타입 위반을 한 사유로 합친다", () => {
    const report = inspectResearchValue("fee_summary", "820,000원. 당근 가격: 710,000원~", source);
    expect(findingNote(report)).toBe(
      "소스에서 확인 안 됨: 820,000원, 710,000원 · 개인 거래 플랫폼 가격이 섞임(당근)",
    );
  });

  it("소스가 비면 모든 숫자가 근거 없음이 된다", () => {
    const report = inspectResearchValue("fee_summary", "680,010원", "");
    expect(report.ungrounded).toHaveLength(1);
  });
});

describe("서술형 근거 검사 — 숫자가 없는 값도 검사한다", () => {
  // 실측(34곳): self_test 13곳 중 11곳, facilities 27곳 중 25곳, shuttle_summary 15곳 중 14곳에
  // 숫자가 아예 없어 그라운딩을 그냥 통과했다. 정작 그 값들이 글의 강조점으로 쓰인다.
  const source = "학원 안내: 야간반 운영, 셔틀버스 매일 운행, 자체시험 실시. 주차 가능.";

  it("근거 낱말이 소스에 있으면 통과한다", () => {
    for (const [field, value] of [["night_class", "야간반/새벽반 운영중"], ["self_test", "yes"], ["shuttle_summary", "셔틀 운행"]] as const) {
      expect(inspectResearchValue(field, value, source).typeIssues).toEqual([]);
    }
  });

  it("근거 낱말이 소스에 없으면 지적한다 — 모델이 지어낸 값", () => {
    const report = inspectResearchValue("night_class", "야간반 운영", "학원 안내: 주차 가능, 자체시험 실시.");
    expect(report.typeIssues.some((i) => i.includes("근거가 없음"))).toBe(true);
    expect(hasFinding(report)).toBe(true);
  });

  it("값이 비어 있으면 검사하지 않는다", () => {
    expect(inspectResearchValue("night_class", "", "관련 없는 본문").typeIssues).toEqual([]);
    expect(inspectResearchValue("night_class", null, "관련 없는 본문").typeIssues).toEqual([]);
  });

  it("규칙 없는 필드는 서술형 검사를 하지 않는다", () => {
    expect(hasEvidenceRule("gu")).toBe(false);
    expect(inspectResearchValue("gu", "북구", "아무 관련 없는 본문").typeIssues).toEqual([]);
  });

  it("새로 추가한 등록 준비물·예약 경로도 검사 대상이다", () => {
    expect(hasEvidenceRule("enrollment_prep")).toBe(true);
    expect(hasEvidenceRule("booking_channel")).toBe(true);
    expect(inspectResearchValue("booking_channel", "온라인 예약 가능", "홈페이지에서 온라인 예약 신청").typeIssues).toEqual([]);
    expect(inspectResearchValue("booking_channel", "온라인 예약 가능", "학원 소개와 오시는 길").typeIssues.length).toBe(1);
  });
});
