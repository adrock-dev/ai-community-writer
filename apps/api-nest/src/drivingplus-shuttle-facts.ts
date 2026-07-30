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
/** "성문학원 출발"·"부산대성학원출발"처럼 앞에 학원명이 붙은 출발지 표기. */
const ORIGIN_SUFFIX_RE = /출발$/u;
/** 안내문에 섞인 실번호(390개 노선 중 389개가 실번호). 공개 글에는 안심번호만 나간다. */
const PHONE_RE = /(?<![\d-])0\d{1,3}[-\s]?\d{3,4}[-\s]?\d{4}(?![\d-])/g;

/** 셔틀 노선은 있으나 지역·경유지·이용 조건이 하나도 안 잡혔을 때의 값. */
export const SHUTTLE_NO_DETAIL_FACT = "셔틀 운행(세부 정보는 자료에 없음)";

/**
 * 독자가 실제로 쓸 수 있는 셔틀 내용(운행 지역·경유지·이용 조건)이 담겼는가.
 *
 * 프롬프트에 넣을지 판단하는 데 쓴다. `SHUTTLE_NO_DETAIL_FACT`는 "셔틀이 있다"는
 * 내부 신호일 뿐이라 카드 불릿·비교표의 값 자리에 들어가면 `- **셔틀 운행 지역:** 셔틀 운행`
 * 같은 빈 칸이 된다. 라벨이 「셔틀 운행 지역」인데 지역이 없으니 어떤 문자열을 줘도
 * 빈 칸이 되는 구조다 — 값을 아예 주지 않는 것 말고는 막을 방법이 없다.
 */
export function hasShuttleDetail(value: unknown): boolean {
  const text = String(value ?? "").trim();
  return Boolean(text) && text !== SHUTTLE_NO_DETAIL_FACT;
}

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
/**
 * 사전의 `submunicipal`은 구를 둔 일반시에서 `"서북구 두정동"` 복합형으로 저장된다
 * (`db.service.ts`의 `upsertRegionDirectory`가 `region`을 공백으로 쪼개 3번째 조각부터
 * 이어 붙이기 때문이다). 그런데 정류장명에는 `"두정동"`만 적히므로 복합형 그대로는
 * 절대 걸리지 않는다 — 실측 결과 사전 5,068건 중 736건(14.5%)이 이 형태였고,
 * 그 토큰으로 매칭에 성공한 학원은 0곳이었다. 그 도시 학원들은 운행 지역이 시 단위
 * ("천안시")로만 남고 동 단위 상세는 경유지에만 있었다(23곳).
 *
 * 그래서 복합형에서는 뒤쪽 지명만 떼어 대조·표기한다. 같은 시 안의 동명이지역은 반경
 * 25km 제한(`SHUTTLE_REGION_RADIUS_KM`)이 이미 걸러 주고, 걸러지지 않더라도 묶는 키가
 * 같은 시·군이라 표기가 달라지지 않는다. 광역시는 `sigungu`가 "강남구"라 무관하다.
 */
function submunicipalName(entry: RegionDirectoryEntry): string {
  const raw = String(entry.submunicipal ?? "").trim();
  // 공백이 있을 때만 복합형이다. "동남구"처럼 구 이름만 있는 행은 그대로 둔다.
  return (raw.match(/^\S+구\s+(\S.*)$/u)?.[1] ?? raw).trim();
}

/**
 * 지명 토큰은 낱말 앞머리에서 시작해야 인정한다. 앞에 한글이 붙어 있으면 더 긴 지명의
 * 꼬리를 잘라 읽은 것이다 — 복합형 토큰을 열자 "오산 방면(세교동·청호동)" 한 줄이
 * 수원시 교동(세**교동**)과 용인시 호동(청**호동**)으로 잡혔다.
 *
 * 뒤쪽은 막지 않는다. 지명 뒤에 말이 이어붙는 것은 정상이라("교동시가지", "두정동 우체국")
 * 뒤를 막으면 실제 매칭이 사라진다. 강릉 교동이 이 경우다.
 */
function includesRegionToken(text: string, token: string): boolean {
  if (!token) return false;
  return new RegExp(`(?<![가-힣])${token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u").test(text);
}

type RegionMatch = { entry: RegionDirectoryEntry; via: "submunicipal" | "sigungu" };
function matchedRegions(text: string, regions: RegionDirectoryEntry[]): RegionMatch[] {
  const found: RegionMatch[] = [];
  for (const entry of regions) {
    const submunicipal = submunicipalName(entry);
    const sigungu = String(entry.sigungu ?? "").trim();
    let via: RegionMatch["via"] | null = null;
    if (submunicipal && includesRegionToken(text, submunicipal)) via = "submunicipal";
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
    const sub = submunicipalName(entry);
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

/**
 * 노선명을 운행 지역으로 승격할 최소 조건 — 행정구역이나 운행 범위를 가리키는 말이어야 한다.
 *
 * `OPERATIONAL_LABEL_RE`는 앞머리만 보기 때문에 "학원셔틀"처럼 다른 글자가 앞에 붙으면
 * 그대로 통과했고, 요일("토요일")과 랜드마크("GTX-A 킨텍스")도 지역으로 실렸다(실측 3곳).
 * 글에는 `- **셔틀 운행 지역:** 학원셔틀` 로 나가 독자에게는 오류로 읽힌다.
 */
const REGION_LIKE_RE = /[가-힣]{2,}(?:시|군|구|읍|면|동|리)|전\s?지역|전역|방면|시내|일대/u;
const NON_REGION_TITLE_RE = /셔틀|버스|노선|요일|학원/u;

/** 노선명 중 운영 라벨이 아닌 것 — 학원이 지역명을 그대로 쓴 경우다. */
function placeLikeTitles(buses: DrivingplusShuttleBus[]): string[] {
  const titles: string[] = [];
  for (const bus of buses) {
    const title = scrub(bus.title);
    if (!title || OPERATIONAL_LABEL_RE.test(title) || titles.includes(title)) continue;
    if (NON_REGION_TITLE_RE.test(title) || !REGION_LIKE_RE.test(title)) continue;
    titles.push(title);
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

/**
 * 경유지로 인정할 값 — 독자가 자기 출발지를 찾는 데 쓸 수 있는 생활권·랜드마크·지역 정보여야 한다.
 *
 * 원천의 정류장 필드에는 지점이 아닌 값이 섞여 들어온다(실측 735개 중 25개):
 * 시각표("06:50 09:40 12:40 15:40"), 노선 조각("3지구"·"4출구)"·"6단지"), 상호 약어("BYC"·"NC"),
 * 학원 출발지("성문학원 출발"). 그대로 실으면 공개 글에 오류로 읽히고, 특히 운행 지역이
 * 잡히지 않아 경유지가 셔틀 정보의 전부인 학원에서 치명적이다.
 */
function isPlaceLikeStop(name: string): boolean {
  if (ORIGIN_STOP_RE.test(name) || ORIGIN_SUFFIX_RE.test(name)) return false;
  const hangul = (name.match(/[가-힣]/gu) ?? []).length;
  if (hangul >= 3) return true;
  // 두 글자는 지명 접미사로 끝날 때만 인정한다("학동"은 지명, "3지구"·"6단지"는 조각이다).
  return hangul === 2 && /[동읍면리역가]$/u.test(name);
}

function stopNames(buses: DrivingplusShuttleBus[]): string[] {
  const stops: string[] = [];
  for (const bus of buses) {
    for (const stop of bus.times ?? []) {
      const name = scrub(stop?.runDirection);
      if (!name || !isPlaceLikeStop(name) || stops.includes(name)) continue;
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
  let hasRegion = false;
  if (regions.length) { segments.push(`운행 지역(자료 기준) ${describeRegions(regions)}`); hasRegion = true; }
  else {
    const titles = placeLikeTitles(routes);
    if (titles.length) { segments.push(`운행 지역(자료 기준) ${titles.slice(0, MAX_SIGUNGU).join(", ")}`); hasRegion = true; }
  }

  // 2) 예약·이용 조건 — 학원 안내문에 있을 때만.
  const conditions = reservationConditions(routes);
  if (conditions.length) segments.push(`이용 조건 ${conditions[0]}`);

  // 3) 경유지 — 운행 지역을 만들지 못한 학원에서만 낸다.
  //
  // 둘을 함께 내면 같은 사실이 두 번 실린다. 운행 지역은 별도 원천이 아니라 이 정류장
  // 텍스트를 사전과 대조해 만든 값이라(`regionSearchText`가 정류장명을 포함한다), 정류장이
  // 동 이름이면 그 동이 운행 지역으로 올라간 뒤 여기서 또 나열된다. 실제로 발행 글에
  // "원주시 개운동·단계동·단구동·명륜동 등을 운행 지역으로 안내하고, 명륜동·개운동·구곡택지·
  // 봉산동 등을 경유지로 제시하고"가 그대로 나갔다. 프롬프트에 "대표 지역 몇 곳만" 지시가
  // 이미 있었지만 지시로는 막히지 않았다 — 입력에서 하나만 주는 것이 유일한 방법이다.
  //
  // 어느 쪽을 남길지는 해상도가 정한다. 운행 지역은 동 단위로 커버리지를 말하고 잘리지
  // 않는 반면, 경유지는 최대 4개만 실린다(실측: 170곳 중 149곳이 상한에 걸렸고 실제 정류장은
  // 67~161곳까지 간다). 그래서 운행 지역이 있으면 그쪽이 낫다.
  //
  // 반대로 운행 지역이 비는 학원에서는 경유지가 셔틀 정보의 전부다. 반경 25km 밖에서
  // 태워 오는 원거리 픽업(포천 학원의 강남 경유지, 가평 학원의 잠실 경유지)이 대표적인데,
  // 사전 대조가 구조적으로 닿지 못하는 자리라 여기서 지우면 그 사실이 사라진다.
  //
  // 총 개수는 어느 경우에도 넣지 않는다. 학원끼리 수강료·운영 과정이 거의 같은 지역에서는
  // 경유지 수가 유일하게 눈에 띄는 숫자라, 넣어 두면 모델이 그걸 강점으로 집어 든다
  // (발행 14건 중 3건: "161곳으로 가장 많고", "경유지 100곳", "67곳 경유지"). 독자에게
  // 중요한 것은 "내 출발지가 경유지에 있느냐"이지 총 개수가 아니다.
  if (!hasRegion) {
    const stops = stopNames(routes);
    if (stops.length) segments.push(`경유지 ${stops.slice(0, MAX_STOPS).join(", ")} 등`);
  }

  // 셔틀 연락처는 대부분 실번호라 넣지 않는다. 공개 연락처는 학원 안심번호 하나로 통일한다.
  if (!segments.length) return SHUTTLE_NO_DETAIL_FACT;
  return factSafeText(segments.join(" · "));
}
