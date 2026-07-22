import type { DrivingplusEducationPerformance, DrivingplusOperateHour } from "./drivingplus-api.service.js";

/**
 * DrivingPlus 원천 구조체를 academies 의 price/shuttle/hours 텍스트 컬럼으로 바꾸는 포맷터.
 *
 * 이 값들은 그대로 생성 프롬프트의 "확인된 콘텐츠 재료"에 들어가고(worker.buildFacts 가
 * `수강료: …` / `영업시간: …` 라벨로 붙인다), T01 데이터 게이트의 후보 필드
 * (t01-data-gated.normalizeCandidate)로도 읽힌다. 따라서 두 가지를 반드시 지킨다.
 *
 * 1) 자료에 있는 사실만 적는다. 커버리지·편의성·합격 가능성을 추정하지 않는다.
 * 2) facts 한 줄은 " / " 로 필드를 잇고 품질 게이트가 `[^/\n]+` 로 값을 읽으므로,
 *    값 안에 슬래시·개행이 남으면 필드 경계가 깨진다(노선명 "공휴일/일요일 노선" 등 실재).
 *
 * 셔틀은 지역 사전 매칭이 필요해 drivingplus-shuttle-facts.ts 로 분리했다.
 */

/** facts 한 줄에 안전하게 담기도록 슬래시·개행·중복 공백을 제거한다. */
export function factSafeText(value: unknown): string {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\//g, "·")
    .replace(/\s+/g, " ")
    .trim();
}

function wonAmount(value: number | null | undefined): string | null {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return `${Math.round(amount).toLocaleString("ko-KR")}원`;
}

/**
 * 공시 성격의 교육실적 수강료(educationPerformance.fees)만 사용한다.
 * priceObservations 는 외부 수집값(naver_place 등)이라 신뢰도·수집시점이 제각각이므로
 * 본문에서 단정하지 않도록 extra 에만 보관하고 이 컬럼에는 넣지 않는다.
 */
export function formatTuitionFact(performance: DrivingplusEducationPerformance | null | undefined): string | null {
  const fees = performance?.fees;
  if (!fees) return null;
  const parts: string[] = [];
  for (const [label, amount] of [
    ["1종 보통 수동", fees.type1Manual],
    ["1종 보통 자동", fees.type1Auto],
    ["2종 보통 자동", fees.type2Auto],
  ] as const) {
    const won = wonAmount(amount);
    if (won) parts.push(`${label} ${won}`);
  }
  if (!parts.length) return null;
  const conditions: string[] = [];
  if (typeof fees.vatIncluded === "boolean") conditions.push(fees.vatIncluded ? "부가세 포함" : "부가세 별도");
  if (typeof fees.examFeeIncluded === "boolean") conditions.push(fees.examFeeIncluded ? "검정료 포함" : "검정료 별도");
  const year = Number(performance?.year);
  const quarter = Number(performance?.quarter);
  if (Number.isFinite(year) && Number.isFinite(quarter)) conditions.push(`${year}년 ${quarter}분기 기준`);
  const suffix = conditions.length ? ` (${conditions.join(", ")})` : "";
  return factSafeText(`${parts.join(", ")}${suffix}`);
}

const DAY_FIELDS = [
  ["월", "monOpenTime", "monCloseTime", "monIsHoliday"],
  ["화", "tueOpenTime", "tueCloseTime", "tueIsHoliday"],
  ["수", "wedOpenTime", "wedCloseTime", "wedIsHoliday"],
  ["목", "thuOpenTime", "thuCloseTime", "thuIsHoliday"],
  ["금", "friOpenTime", "friCloseTime", "friIsHoliday"],
  ["토", "satOpenTime", "satCloseTime", "satIsHoliday"],
  ["일", "sunOpenTime", "sunCloseTime", "sunIsHoliday"],
] as const;

function dayText(hour: DrivingplusOperateHour, open: string, close: string, holiday: string): string | null {
  if ((hour as unknown as Record<string, unknown>)[holiday] === true) return "휴무";
  const from = factSafeText((hour as unknown as Record<string, unknown>)[open]);
  const to = factSafeText((hour as unknown as Record<string, unknown>)[close]);
  if (!from || !to) return null;
  return `${from}~${to}`;
}

/** 같은 값이 이어지는 요일은 "월~금" 으로 묶어 프롬프트에 들어갈 길이를 줄인다. */
export function formatOperatingHoursFact(hour: DrivingplusOperateHour | null | undefined): string | null {
  if (!hour) return null;
  const days = DAY_FIELDS.map(([label, open, close, holiday]) => ({ label, text: dayText(hour, open, close, holiday) }));
  const groups: Array<{ from: string; to: string; text: string }> = [];
  for (const day of days) {
    if (!day.text) continue;
    const last = groups[groups.length - 1];
    if (last && last.text === day.text) last.to = day.label;
    else groups.push({ from: day.label, to: day.label, text: day.text });
  }
  const segments = groups.map((group) => `${group.from === group.to ? group.from : `${group.from}~${group.to}`} ${group.text}`);
  const holidayText = dayText(hour, "holidayOpenTime", "holidayCloseTime", "holidayIsHoliday");
  if (holidayText) segments.push(`공휴일 ${holidayText}`);
  const notice = factSafeText(hour.notice);
  if (notice) segments.push(notice);
  if (!segments.length) return null;
  return factSafeText(segments.join(" · "));
}
