/**
 * 후보 학원들을 **서로 대조해** 각 학원이 실제로 두드러지는 점을 계산한다.
 *
 * 왜 코드가 계산하는가: 프롬프트로 "카드마다 다른 항목을 앞세워라"라고만 하면 모델이 카드를
 * 순서대로 쓰면서 항목을 선점해, 뒤 카드는 남은 항목으로 밀린다(실측: 흥업이 '유일한 연중무휴'를
 * 못 쓰고 앞 카드가 가져간 영업시간 항목 때문에 셔틀로 밀렸다). 전체를 한 번에 보고 배분하는 일은
 * 코드가 정확하고, 모델은 주어진 문구를 문장으로 풀기만 하면 된다.
 *
 * 원칙:
 * - **제공된 자료로 검증되는 비교만** 만든다. 값이 없는 학원은 그 항목의 비교에서 빠진다(약점을
 *   "자료 없음"으로 서술하지 않기 위함 — 그건 내부 처리 노출이다).
 * - 동점이면 만들지 않는다. "가장 ~"은 **유일할 때만** 성립한다.
 * - 순위·우열 단정이 아니라 확인된 값의 차이다. 문구에 근거 값을 함께 담아 모델이 지어내지 않게 한다.
 */
import { availableLicensesFromSource } from "./academy-course-evidence.js";

type Row = Record<string, any>;

/** 학원 1곳의 두드러지는 점(최대 MAX_POINTS개). 없으면 빈 문자열. */
export type DistinguishingPoints = string[];

const MAX_POINTS = 3;

export function academyDistinguishingPoints(academies: Row[]): DistinguishingPoints[] {
  const rows = Array.isArray(academies) ? academies : [];
  const points: string[][] = rows.map(() => []);
  if (rows.length < 2) return points;
  const total = rows.length;
  const scope = `${total}곳 중`;

  const push = (index: number, text: string) => {
    const bucket = points[index];
    if (bucket && text && !bucket.includes(text)) bucket.push(text);
  };

  // 1) 영업시간 — 개점/마감/주말 운영. 실제로 네 곳이 모두 다른 경우가 많은데도 지금까지 한 번도
  //    글에 안 나온 항목이라 가장 먼저 본다.
  const hours = rows.map((row) => parseBusinessHours(row.hours));
  const opensAllWeek = hours.map((hour) => Boolean(hour?.opensSaturday && hour?.opensSunday));
  const opensWeekend = hours.map((hour) => Boolean(hour?.opensSaturday || hour?.opensSunday));
  const uniqueAllWeek = onlyIndexWith(opensAllWeek);
  const uniqueWeekend = onlyIndexWith(opensWeekend);
  if (uniqueAllWeek !== null) push(uniqueAllWeek, `${scope} 유일한 연중무휴(월~일 운영)`);
  else if (uniqueWeekend !== null) push(uniqueWeekend, `${scope} 유일하게 주말에도 운영`);

  const earliest = uniqueExtremeIndex(hours.map((hour) => hour?.openMinutes ?? null), "min");
  if (earliest !== null) push(earliest, `개점이 ${scope} 가장 이름(${formatClock(hours[earliest]?.openMinutes)})`);
  const latest = uniqueExtremeIndex(hours.map((hour) => hour?.closeMinutes ?? null), "max");
  if (latest !== null) push(latest, `마감이 ${scope} 가장 늦음(${formatClock(hours[latest]?.closeMinutes)})`);

  // 2) 운영 과정 — 종수 최다 / 보통면허 집중.
  const courses = rows.map((row) => availableLicensesFromSource(row));
  const courseCounts = courses.map((list) => (list.length ? list.length : null));
  const mostCourses = uniqueExtremeIndex(courseCounts, "max");
  if (mostCourses !== null) push(mostCourses, `운영 과정이 ${scope} 가장 많음(${courses[mostCourses]?.length}종)`);
  const fewestCourses = uniqueExtremeIndex(courseCounts, "min");
  if (fewestCourses !== null && (courses[fewestCourses] ?? []).every((label) => /보통/u.test(label))) {
    push(fewestCourses, `보통면허 과정(${(courses[fewestCourses] ?? []).join("·")})에 집중`);
  }

  // 3) 수강료 — 모든 후보가 함께 표시한 과정에서만 비교한다. 과정이 다르면 금액 비교 자체가 오도한다.
  //    같은 학원이라도 과정마다 순위가 다르므로(횡성신진은 1종 자동 최저·1종 수동 최고) 문구에
  //    반드시 과정명을 함께 담는다. 그래야 "수강료가 가장 싼 학원"이라는 잘못된 일반화가 안 된다.
  //    동점인 과정은 건너뛰고 유일한 최저가 나오는 첫 과정을 쓴다.
  const priceMaps = rows.map((row) => parseCoursePrices(row.price));
  for (const course of sharedCourses(priceMaps)) {
    const amounts = priceMaps.map((map) => map.get(course) ?? null);
    const cheapest = uniqueExtremeIndex(amounts, "min");
    if (cheapest === null) continue;
    push(cheapest, `표시 수강료가 ${scope} 가장 낮음(${course} ${formatWon(amounts[cheapest])})`);
    break;
  }

  // 4) 셔틀 — 경유지 수가 자료에 명시된 경우에만. 없는 학원은 비교에서 빠진다.
  //    값을 가진 곳이 하나뿐이면 '가장 많음'(비교)은 성립하지 않지만 '유일하게 안내'(유일성)는
  //    성립한다. 이걸 빼면 혼자만 상세한 학원이 오히려 아무 특징도 없는 카드가 된다(실측: 흥업).
  const stops = rows.map((row) => shuttleStopCount(row.shuttle));
  const mostStops = uniqueExtremeIndex(stops, "max");
  if (mostStops !== null) push(mostStops, `셔틀 경유지가 ${scope} 가장 많음(${stops[mostStops]}곳)`);
  else {
    // 문구는 비교형이 아니라 그 학원의 사실로 쓴다. "유일하게 안내됨"이라고 쓰면 모델이 그 근거로
    // "다른 곳은 자료가 없어서"를 서술하게 되고, 그건 내부 처리 노출(exposes_internal_fact_language)이다.
    const onlyStops = onlyIndexWith(stops.map((count) => count !== null));
    if (onlyStops !== null) push(onlyStops, `셔틀 경유지 ${stops[onlyStops]}곳까지 안내됨`);
  }

  // 5) 그 학원에서만 운영하는 과정 — 독자가 그 면허를 원하면 선택지가 하나로 좁혀진다.
  for (const [index, list] of courses.entries()) {
    const onlyHere = list.filter((label) => courses.every((other, otherIndex) => otherIndex === index || !other.includes(label)));
    if (onlyHere.length) push(index, `${onlyHere.join("·")} 과정은 ${scope} 여기만 운영`);
  }

  // 6) 소재지 — 혼자만 다른 시·군·구에 있으면 그 자체가 독자에게 중요한 차이다.
  const districts = rows.map((row) => districtOf(row.address));
  const lone = onlyIndexWithUniqueValue(districts);
  if (lone !== null) push(lone, `혼자 다른 시·군에 있음(${districts[lone]})`);

  return points.map((list) => list.slice(0, MAX_POINTS));
}

/** facts 줄에 붙일 한 줄 문구. 두드러지는 점이 없으면 null. */
export function distinguishingPointsFactLine(points: string[] | undefined): string | null {
  const list = (points ?? []).filter(Boolean);
  return list.length ? `이 학원이 두드러지는 점: ${list.join(" · ")}` : null;
}

// ---------- 영업시간 파싱 ----------

const DAY_ORDER = ["월", "화", "수", "목", "금", "토", "일"];

export type BusinessHours = { openMinutes: number; closeMinutes: number; opensSaturday: boolean; opensSunday: boolean };

/**
 * "월~금 07:00~21:00 · 토~일 휴무" 형태를 읽는다.
 * 휴게시간 구간("매일 12:00 ~ 13:00 휴게시간")은 영업 구간이 아니므로 제외한다.
 */
export function parseBusinessHours(value: unknown): BusinessHours | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  let openMinutes = Number.POSITIVE_INFINITY;
  let closeMinutes = Number.NEGATIVE_INFINITY;
  let opensSaturday = false;
  let opensSunday = false;
  for (const rawSegment of text.split(/[·|]/)) {
    const segment = rawSegment.trim();
    if (!segment || /휴게/u.test(segment)) continue;
    const days = segmentDays(segment);
    if (/휴무|휴업|휴일/u.test(segment)) continue;
    const range = segment.match(/(\d{1,2}):(\d{2})\s*~\s*(\d{1,2}):(\d{2})/u);
    if (!range) {
      // "연중무휴"처럼 시간 없이 운영 여부만 알려주는 구간.
      if (/연중무휴|매일/u.test(segment)) { opensSaturday = true; opensSunday = true; }
      continue;
    }
    const start = Number(range[1]) * 60 + Number(range[2]);
    const end = Number(range[3]) * 60 + Number(range[4]);
    if (Number.isFinite(start)) openMinutes = Math.min(openMinutes, start);
    if (Number.isFinite(end)) closeMinutes = Math.max(closeMinutes, end);
    if (days.includes("토")) opensSaturday = true;
    if (days.includes("일")) opensSunday = true;
  }
  if (!Number.isFinite(openMinutes) || !Number.isFinite(closeMinutes)) return null;
  return { openMinutes, closeMinutes, opensSaturday, opensSunday };
}

function segmentDays(segment: string): string[] {
  if (/연중무휴|매일/u.test(segment)) return [...DAY_ORDER];
  const range = segment.match(/([월화수목금토일])\s*~\s*([월화수목금토일])/u);
  if (range) {
    const from = DAY_ORDER.indexOf(range[1] ?? "");
    const to = DAY_ORDER.indexOf(range[2] ?? "");
    if (from !== -1 && to !== -1 && from <= to) return DAY_ORDER.slice(from, to + 1);
  }
  const singles = Array.from(segment.matchAll(/[월화수목금토일]/gu)).map((match) => match[0]);
  return singles.length ? singles : [];
}

function formatClock(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return "";
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

// ---------- 수강료 파싱 ----------

/** "1종 보통 수동 780,000원, 1종 보통 자동 900,000원" → Map(과정 → 금액). */
export function parseCoursePrices(value: unknown): Map<string, number> {
  const map = new Map<string, number>();
  const text = String(value ?? "");
  for (const match of text.matchAll(/([12]종\s*[가-힣]+(?:\s*[가-힣]+)?)\s*([\d,]{4,})\s*원/gu)) {
    const course = String(match[1] ?? "").replace(/\s+/g, " ").trim();
    const amount = Number(String(match[2] ?? "").replace(/,/g, ""));
    if (course && Number.isFinite(amount) && !map.has(course)) map.set(course, amount);
  }
  return map;
}

/** 모든 후보가 함께 표시한 과정들. 하나도 없으면 금액 비교를 아예 하지 않는다. */
function sharedCourses(maps: Map<string, number>[]): string[] {
  const first = maps[0];
  if (!maps.length || !first) return [];
  return [...first.keys()].filter((course) => maps.every((map) => map.has(course)));
}

function formatWon(amount: number | null | undefined): string {
  return amount === null || amount === undefined ? "" : `${amount.toLocaleString("en-US")}원`;
}

// ---------- 셔틀 / 주소 ----------

/** 셔틀 문구의 "경유지 … 등 15곳"에서 경유지 수를 읽는다. 없으면 null. */
export function shuttleStopCount(value: unknown): number | null {
  const match = String(value ?? "").match(/경유지[^]*?등\s*(\d+)\s*곳/u);
  const count = match ? Number(match[1]) : NaN;
  return Number.isFinite(count) ? count : null;
}

/** 주소에서 시·군·구 토큰을 뽑는다. */
export function districtOf(value: unknown): string | null {
  const match = String(value ?? "").match(/([가-힣]+(?:시|군|구))/gu);
  // "강원특별자치도 원주시 흥업면" → 마지막 시/군/구가 아니라 첫 번째(원주시)가 소재 시·군이다.
  return match?.[0] ?? null;
}

// ---------- 비교 도우미 ----------

/** 값이 있는 후보 중 최소/최대가 **유일**하면 그 인덱스, 아니면 null. */
function uniqueExtremeIndex(values: (number | null)[], mode: "min" | "max"): number | null {
  const present = values.map((value, index) => ({ value, index })).filter((entry): entry is { value: number; index: number } => entry.value !== null && Number.isFinite(entry.value));
  if (present.length < 2) return null;
  const best = present.reduce((left, right) => (mode === "min" ? (right.value < left.value ? right : left) : (right.value > left.value ? right : left)));
  const ties = present.filter((entry) => entry.value === best.value);
  return ties.length === 1 ? best.index : null;
}

/** true 가 **하나뿐**이면 그 인덱스, 아니면 null. */
function onlyIndexWith(flags: boolean[]): number | null {
  const hits = flags.map((flag, index) => (flag ? index : -1)).filter((index) => index !== -1);
  return hits.length === 1 ? (hits[0] ?? null) : null;
}

/** 값이 혼자만 다른 후보의 인덱스. 나머지가 모두 같은 값일 때만 성립한다. */
function onlyIndexWithUniqueValue(values: (string | null)[]): number | null {
  const present = values.map((value, index) => ({ value, index })).filter((entry): entry is { value: string; index: number } => Boolean(entry.value));
  if (present.length < 3) return null;
  const counts = new Map<string, number>();
  for (const entry of present) counts.set(entry.value, (counts.get(entry.value) ?? 0) + 1);
  if (counts.size !== 2) return null;
  const lone = [...counts.entries()].find(([, count]) => count === 1);
  if (!lone) return null;
  return present.find((entry) => entry.value === lone[0])?.index ?? null;
}
