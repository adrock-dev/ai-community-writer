import type { DrivingplusEducationPerformance, DrivingplusOperateHour, DrivingplusPriceObservation, DrivingplusRoadCourse } from "./drivingplus-api.service.js";

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

// 도로주행 코스(road_courses)는 facts 로 넘기지 않는다.
// 원천이 275곳에 주지만 title 이 "도로주행A~D" 표준 라벨이라 380곳이 같고(개수도 93%가 4개),
// subtitle·content·difficulty 는 전 건 null 이다. 텍스트로 넣으면 모든 글에 같은 문장만 는다.
// 실질 가치는 학원별 실제 코스 사진(imageUrl)이며, 그건 이미지 슬롯 쪽에서 다룰 일이다.

// 공식 수강료(educationPerformance.fees)가 덮는 면허. 관측 가격에서는 이 종류를 다시 적지 않는다.
const FEES_COVERED_LICENSE = /^(1종\s*보통|2종\s*보통)$/;

/**
 * 공식 수강료가 덮지 못하는 과정의 요금(대형·특수·소형·원동기·도로연수). 실측 146곳(38%).
 *
 * priceObservations 는 원래 "외부 수집값이라 신뢰도·수집시점이 제각각" 이라는 이유로 통째
 * 제외돼 있었다. 실측(1,717건) 결과 91%가 학원 공식 홈페이지 출처이고 전 건에 수집시점이
 * 있어 출처를 가려 쓸 수 있다. 그래서 제외를 유지하되 범위를 좁힌다.
 *
 * - 공식 홈페이지 출처만 쓴다(naver_place·naver_blog 는 제외 — 원래 우려가 향하던 대상이다)
 * - **priceUnit 이 hour 인 값은 전부 버린다.** 라벨 오류가 구조적이다 — 제일학원의
 *   "도로연수(6시간)" 총액 360,000원이 hour 로 붙어 있어, 그대로 쓰면 "시간당 36만원" 이 된다.
 *   상위 값 대부분이 "10시간 총액"·"12시간(10%할인)" 처럼 총액이었다.
 * - 공식 수강료가 이미 주는 1종·2종 보통은 적지 않는다(두 값이 본문에서 충돌한다)
 * - 같은 과정에 값이 여러 개면 최저가만 적고 "부터" 를 붙인다(단정하지 않는다)
 */
export function formatExtraCourseFeeFact(
  observations: DrivingplusPriceObservation[] | null | undefined,
  performance: DrivingplusEducationPerformance | null | undefined,
): string | null {
  const hasOfficialFees = Boolean(performance?.fees);
  const buckets = new Map<string, { label: string; unit: string; amounts: number[] }>();
  // 수집 시점. 학원 원칙이 "금액은 자료의 기준 시점 값" 임을 밝히라고 요구하는데,
  // 공식 수강료는 연·분기를 달고 가는 반면 관측 가격은 시점 없이 나가고 있었다.
  let collectedAt = "";
  for (const row of observations ?? []) {
    if (!row || row.source !== "homepage") continue;
    // 시간당 표기는 총액에도 붙어 있어 신뢰할 수 없다(위 주석).
    if (row.priceUnit !== "course") continue;
    const amount = Number(row.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const license = factSafeText(row.licenseType);
    const isTraining = row.courseType === "driving_training";
    if (!isTraining) {
      if (!license) continue;
      // 공식 수강료가 있는데 같은 종류를 또 적으면 본문에서 두 금액이 부딪힌다.
      if (hasOfficialFees && FEES_COVERED_LICENSE.test(license)) continue;
    }
    const gear = factSafeText(row.gearType);
    const label = isTraining ? "도로연수" : [license, gear].filter(Boolean).join(" ");
    const unit = "";
    const key = label;
    const bucket = buckets.get(key) ?? { label, unit, amounts: [] };
    bucket.amounts.push(amount);
    buckets.set(key, bucket);
    const at = String(row.collectedAt ?? "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(at) && at > collectedAt) collectedAt = at;
  }
  if (!buckets.size) return null;

  const parts: string[] = [];
  for (const bucket of buckets.values()) {
    const min = Math.min(...bucket.amounts);
    const won = wonAmount(min);
    if (!won) continue;
    const many = new Set(bucket.amounts).size > 1;
    parts.push(`${[bucket.label, bucket.unit].filter(Boolean).join(" ")} ${won}${many ? "부터" : ""}`);
  }
  if (!parts.length) return null;
  const basis = collectedAt ? `학원 홈페이지 게시 기준, ${collectedAt.replace("-", "년 ")}월 수집` : "학원 홈페이지 게시 기준";
  return factSafeText(`${parts.slice(0, 8).join(" · ")} (${basis})`);
}
