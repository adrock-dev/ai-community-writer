import { expect, it } from "vitest";
import { EXCLUDED_FROM_ARTICLE, researchFactParts } from "../src/academy-research-article-fields.js";

// 조사값이 facts 로 나가는 규칙. 원천과의 우선순위·상한이 어긋나면 프롬프트에서
// 값이 병기되거나(전화번호 사고와 같은 형태) 카드가 산만해진다.

const FULL = {
  facilities: "휴게실, 주차장, 자판기",
  self_test: "자체 시험장 운영",
  night_class: "평일 야간반 운영",
  weekend: "토요일 운영",
  closed_days: "일요일 휴무",
  established_year: "1998년",
  scale: "코스 2면",
  enrollment_prep: "신분증, 증명사진 2매",
  homepage_url: "https://example.test",
  fee_summary: "1종 보통 70만원대",
  hours: "평일 08:00~18:00",
};

it("라벨에 (조사)를 달아 원천 사실과 구분한다", () => {
  const parts = researchFactParts({ facilities: "휴게실" });
  expect(parts).toEqual(["편의시설(조사): 휴게실"]);
});

it("원천이 답을 가진 항목은 조사값을 넘기지 않는다", () => {
  const withSource = researchFactParts(FULL, { sourceHas: new Set(["fee_summary", "hours"]) });
  expect(withSource.some((p) => p.startsWith("수강료(조사)"))).toBe(false);
  expect(withSource.some((p) => p.startsWith("영업시간(조사)"))).toBe(false);
  // 원천이 없으면 그대로 나간다(빈 자리만 메우는 역할)
  const withoutSource = researchFactParts(FULL);
  expect(withoutSource.some((p) => p.startsWith("수강료(조사)"))).toBe(true);
});

it("후보가 여럿이면 중요도 상위만 싣는다", () => {
  const capped = researchFactParts(FULL, { limit: 4 });
  expect(capped).toHaveLength(4);
  // 원천이 0%인 항목이 앞에 온다 — 잘려도 조사의 존재 이유가 남아야 한다
  expect(capped[0]).toContain("편의시설");
  expect(capped.some((p) => p.startsWith("수강료(조사)"))).toBe(false);
  // 단독 소개형은 상한 없이 전부
  expect(researchFactParts(FULL).length).toBe(Object.keys(FULL).length);
});

it("자료 품질 때문에 뺀 필드는 값이 있어도 나가지 않는다", () => {
  // booking_channel 은 189건 중 48건이 값이 그냥 "예약"(네이버 플레이스 편의 태그),
  // naver_place_url 은 제3자 목록 페이지라 글에 링크할 것이 아니다.
  expect([...EXCLUDED_FROM_ARTICLE].length).toBeGreaterThan(0);
  const parts = researchFactParts({ booking_channel: "예약", naver_place_url: "https://m.place.naver.com/x", facilities: "휴게실" });
  expect(parts).toEqual(["편의시설(조사): 휴게실"]);
});

it("사람이 읽을 문장이 아닌 기계값은 거른다", () => {
  // self_test 에 "yes" 가 그대로 저장된 건이 3곳 있었다 — 모델이 문장으로 만들 수 없다.
  expect(researchFactParts({ self_test: "yes" })).toEqual([]);
  expect(researchFactParts({ self_test: "자체시험 실시" })).toEqual(["자체 시험장(조사): 자체시험 실시"]);
});

it("허용 목록에 없는 값은 조사값 묶음에 있어도 나가지 않는다", () => {
  const parts = researchFactParts({
    pass_rate: "수도권 최고 합격률",
    name_researched: "다른이름운전학원",
    facilities: "휴게실",
  });
  expect(parts).toEqual(["편의시설(조사): 휴게실"]);
});

it("값이 없거나 빈 문자열이면 줄을 만들지 않는다", () => {
  expect(researchFactParts(null)).toEqual([]);
  expect(researchFactParts({ facilities: "   ", self_test: null })).toEqual([]);
});
