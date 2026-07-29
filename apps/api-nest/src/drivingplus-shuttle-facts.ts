import { factSafeText } from "./drivingplus-academy-facts.js";
import type { DrivingplusShuttleBus } from "./drivingplus-api.service.js";

/**
 * 셔틀 원본 구조체를 academies.shuttle 텍스트로 바꾼다.
 *
 * 독자가 알고 싶은 것은 "어느 지역으로 셔틀이 오는가"다. 그런데 원천의 노선명은 대부분
 * 학원 내부 편의용 라벨이고(212곳 중 181곳이 `1호차`·`셔틀버스` 류), 정류장명은 지역이
 * 아니라 랜드마크다(`어머니빵집`·`김밥천국`). 그래서 다음 순서로 지역을 확보한다.
 *
 *  1) 학원이 안내문에 직접 적은 행정구역 표기 — 추론이 아니라 원천 진술이라 가장 정확하다
 *     ("안산전지역(단원구, 상록구) 운행", "화성시(마도면, 서신면, 송산면)")
 *  2) 행정구역 사전(region_directory) 매칭 — 학원 좌표 반경 안의 지명만 대조해 동명이지역을 막는다
 *
 * 지명 추출을 정규식으로 하면 안 된다. 한국어 어미가 지명 접미사와 겹쳐
 * `이용시`·`등록시`가 시(市)로, `구름다리`가 리(里)로 잡힌다. 반드시 사전과 대조한다.
 */

export type RegionDirectoryEntry = {
  region: string;
  sido: string;
  sigungu: string | null;
  submunicipal: string | null;
};

/** 노선명이 지역이 아니라 운영 편의용 라벨인 경우. 독자에게 값이 없으므로 버린다. */
const OPERATIONAL_LABEL_RE = /^(?:\d+\s*호차?|\d+호|셔틀\s*(?:버스|노선)?|노선|버스\s*문의|기타|순환|평일|주말|공휴일|일요일)/u;
/** 학원 자체 홍보 문구. 그대로 실으면 광고체가 되고 커버리지 단정("집 앞까지")도 섞인다. */
const PROMOTIONAL_RE = /모시|편안|안전하게|감사합니다|최고|친절히\s*안내|양지하시기|믿고/u;
/** 예약·이용 조건. 사용자가 노출을 허용한 부분이다. */
const RESERVATION_RE = /예약|미리\s*연락|사전\s*(?:연락|문의)|\d+\s*시간\s*전|하루\s*전|전화\s*(?:주|한통|해)|신청/u;
/** 출발지 표기라 경유 지점이 아니다. */
const ORIGIN_STOP_RE = /^(?:학원\s*출발|출발|학원)$/u;
/** 안내문에 섞인 실번호(390개 노선 중 389개가 실번호). 공개 글에는 안심번호만 나간다. */
const PHONE_RE = /(?<![\d-])0\d{1,3}[-\s]?\d{3,4}[-\s]?\d{4}(?![\d-])/g;

const MAX_SIGUNGU = 3;
const MAX_SUBMUNICIPAL = 4;
const MAX_STOPS = 4;
const MAX_CONDITION_CHARS = 60;

function scrub(value: unknown): string {
  return factSafeText(String(value ?? "").replace(PHONE_RE, " "));
}

/** 안내문 계열 텍스트(노선명·운행방향·본문). 예약 조건 추출은 이 범위만 본다. */
function shuttleTexts(buses: DrivingplusShuttleBus[]): string[] {
  return buses.flatMap((bus) => [bus.title, bus.runDirection, bus.content, bus.footContent]).map(scrub).filter(Boolean);
}

/**
 * 지역 매칭용 텍스트. 정류장명까지 포함해야 한다 — 읍·면·동 이름은 안내문이 아니라
 * 정류장명에 들어 있는 경우가 많다("송림동 하이마트", "경서동 태평@").
 */
function regionSearchText(buses: DrivingplusShuttleBus[]): string {
  const stops = buses.flatMap((bus) => (bus.times ?? []).map((stop) => scrub(stop?.runDirection)));
  return [...shuttleTexts(buses), ...stops.filter(Boolean)].join(" | ");
}

/**
 * 사전 토큰이 본문에 문자 그대로 등장할 때만 인정한다. 어느 단위로 확인됐는지도 함께 돌려준다.
 *
 * 이 구분이 중요하다. 시·군·구 하나가 걸렸다고 그 안의 동을 모두 인정하면, "구리·수택·다산
 * 방면" 한 줄로 구리시의 갈매동·교문동·사노동·아천동까지 '확인된 것처럼' 나열하게 된다.
 * 실제로 확인된 것은 "수택" 하나뿐이다. 없는 사실을 만드는 셈이라 반드시 분리한다.
 */
type RegionMatch = { entry: RegionDirectoryEntry; via: "submunicipal" | "sigungu" };
function matchedRegions(text: string, regions: RegionDirectoryEntry[]): RegionMatch[] {
  const found: RegionMatch[] = [];
  for (const entry of regions) {
    const submunicipal = String(entry.submunicipal ?? "").trim();
    const sigungu = String(entry.sigungu ?? "").trim();
    let via: RegionMatch["via"] | null = null;
    if (submunicipal && text.includes(submunicipal)) via = "submunicipal";
    else if (sigungu && text.includes(sigungu)) via = "sigungu";
    else if (sigungu) {
      // "목포 전지역"처럼 접미사를 뗀 형태. 두 글자 이상일 때만, 그리고 지역을 가리키는 말이
      // 뒤따를 때만 인정한다. 이래야 "강남시장"이 강남구로 잡히지 않는다.
      const core = sigungu.replace(/(시|군|구)$/u, "");
      if (core.length >= 2 && new RegExp(`${core}\\s?(?:전\\s?지역|전역|방면|시내|권|일대|[,,·()\\s]|$)`, "u").test(text)) via = "sigungu";
    }
    if (via && !found.some((f) => f.entry.region === entry.region)) found.push({ entry, via });
  }
  return found;
}

/**
 * "서구(경서동·공촌동), 동구" 형태로 시·군·구 단위로 묶는다.
 * 괄호 안 읍·면·동은 그 이름이 본문에 직접 등장한 것만 넣는다(시·군·구만 확인된 곳은 이름만).
 */
function describeRegions(matches: RegionMatch[]): string {
  const grouped = new Map<string, string[]>();
  for (const { entry, via } of matches) {
    const key = String(entry.sigungu ?? entry.sido ?? "").trim() || entry.region;
    if (!grouped.has(key)) grouped.set(key, []);
    if (via !== "submunicipal") continue;
    const sub = String(entry.submunicipal ?? "").trim();
    if (sub && !grouped.get(key)!.includes(sub)) grouped.get(key)!.push(sub);
  }
  const parts: string[] = [];
  for (const [sigungu, subs] of [...grouped].slice(0, MAX_SIGUNGU)) {
    if (!subs.length) { parts.push(sigungu); continue; }
    const shown = subs.slice(0, MAX_SUBMUNICIPAL).join("·");
    parts.push(`${sigungu}(${shown}${subs.length > MAX_SUBMUNICIPAL ? " 등" : ""})`);
  }
  if (grouped.size > MAX_SIGUNGU) parts.push(`외 ${grouped.size - MAX_SIGUNGU}곳`);
  return parts.join(", ");
}

/** 노선명 중 운영 라벨이 아닌 것 — 학원이 지역명을 그대로 쓴 경우다. */
function placeLikeTitles(buses: DrivingplusShuttleBus[]): string[] {
  const titles: string[] = [];
  for (const bus of buses) {
    const title = scrub(bus.title);
    if (title && !OPERATIONAL_LABEL_RE.test(title) && !titles.includes(title)) titles.push(title);
  }
  return titles;
}

function reservationConditions(buses: DrivingplusShuttleBus[]): string[] {
  const found: string[] = [];
  for (const text of shuttleTexts(buses)) {
    for (const sentence of text.split(/(?<=[.!?])\s+|\s*[*•]\s*/u).map((s) => s.trim())) {
      if (sentence.length < 6 || PROMOTIONAL_RE.test(sentence)) continue;
      if (!RESERVATION_RE.test(sentence)) continue;
      const trimmed = sentence.length > MAX_CONDITION_CHARS ? `${sentence.slice(0, MAX_CONDITION_CHARS - 1)}…` : sentence;
      if (!found.includes(trimmed)) found.push(trimmed);
    }
  }
  return found.slice(0, 1);
}

function stopNames(buses: DrivingplusShuttleBus[]): string[] {
  const stops: string[] = [];
  for (const bus of buses) {
    for (const stop of bus.times ?? []) {
      const name = scrub(stop?.runDirection);
      if (!name || ORIGIN_STOP_RE.test(name) || stops.includes(name)) continue;
      stops.push(name);
    }
  }
  return stops;
}

export function formatShuttleFact(
  buses: DrivingplusShuttleBus[] | null | undefined,
  nearbyRegions: RegionDirectoryEntry[] = [],
): string | null {
  const routes = (buses ?? []).filter(Boolean);
  if (!routes.length) return null;

  const segments: string[] = [];

  // 1) 운행 지역 — 사전 매칭이 우선, 없으면 학원이 노선명에 적은 지역명.
  const regions = nearbyRegions.length ? matchedRegions(regionSearchText(routes), nearbyRegions) : [];
  if (regions.length) segments.push(`운행 지역(자료 기준) ${describeRegions(regions)}`);
  else {
    const titles = placeLikeTitles(routes);
    if (titles.length) segments.push(`운행 지역(자료 기준) ${titles.slice(0, MAX_SIGUNGU).join(", ")}`);
  }

  // 2) 예약·이용 조건 — 학원 안내문에 있을 때만.
  const conditions = reservationConditions(routes);
  if (conditions.length) segments.push(`이용 조건 ${conditions[0]}`);

  // 3) 경유지 — 지역이 안 잡힌 학원에서 특히 유용한 보조 정보.
  //
  // 총 개수는 넣지 않는다. 학원끼리 수강료·운영 과정이 거의 같은 지역에서는 경유지 수가
  // 유일하게 눈에 띄는 숫자라, 넣어 두면 모델이 그걸 그 학원의 강점으로 집어 든다
  // (발행 14건 중 3건: "161곳으로 가장 많고", "경유지 100곳", "67곳 경유지").
  //
  // 독자에게 중요한 것은 "내 출발지가 경유지에 있느냐"이지 총 개수가 아니다. 161곳은
  // 내 동네를 지난다는 뜻이 아니고, 오히려 노선이 길어 타는 시간이 길다는 뜻일 수도 있다.
  const stops = stopNames(routes);
  if (stops.length) segments.push(`경유지 ${stops.slice(0, MAX_STOPS).join(", ")} 등`);

  // 셔틀 연락처는 대부분 실번호라 넣지 않는다. 공개 연락처는 학원 안심번호 하나로 통일한다.
  if (!segments.length) return "셔틀 운행(세부 정보는 자료에 없음)";
  return factSafeText(segments.join(" · "));
}
