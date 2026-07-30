/**
 * 조사 25필드 중 **글에 실릴 수 있는 것**만 정의한다.
 *
 * 조사 스키마는 두 목적을 겸한다 — (1) 원천에 없는 사실을 채우는 것, (2) 원천 값이 맞는지
 * 교차검증하는 것. 후자는 운영자가 보라고 모은 것이지 글에 넣을 것이 아니다. 학원명·주소·
 * 전화를 조사값으로 다시 쓰면 원천보다 부정확한 값이 글에 실린다(원천은 100% 채워져 있다).
 *
 * 여기 없는 필드는 도메인으로 투영되지 않는다. 프롬프트에서 "쓰지 마라"로 막는 방식은
 * 강제력이 없다는 것을 블로그리뷰에서 확인했다 — 근거로 못 쓸 자료는 입력에서 끊는다.
 */

/** 절대 조사하지도, 글에 싣지도 않는 항목. */
export const NEVER_IN_ARTICLE = new Set([
  // 합격률 원천이 어디에도 없다. 웹 조사가 긁어오는 것은 학원 자기 주장뿐이고,
  // 실제로 #612 에서 "수도권 최고 합격률 … 이라고 주장" 이 ai_draft 로 저장돼 있었다.
  // 「AI 초안까지」 설정이면 그대로 프롬프트에 닿았을 값이다.
  "pass_rate",
  "pass_rate_scope",
  "kakao_url",
]);

/** 원천 값을 교차검증하려고 모은 것 — 운영자용이고 글에는 쓰지 않는다. */
export const CROSS_CHECK_ONLY = new Set([
  "name_researched",
  "address_researched",
  "phone_researched",
  "gu",
  "dong",
  "jibun_address",
]);

/**
 * 네이버 플레이스가 업종 구분 없이 붙이는 태그 중 **편의시설이 아닌 것**.
 *
 * 조사가 플레이스의 편의 태그를 그대로 옮겨 담아, facilities 281건 중 212건(75%)에
 * 예약 방식·결제 수단이 섞여 있었다. "예약"만 들어 있어 글에 쓸 것이 하나도 없는 값도 2건.
 * 소스에 실제로 있는 낱말이라 근거 검사는 통과한다 — "그 필드에 담길 내용인가" 는
 * 검사가 보지 않는 축이다.
 *
 * 값은 건드리지 않고 **글로 나갈 때만** 뺀다. 조사 원문은 검수 근거로 남아야 한다.
 */
const NON_FACILITY_TAGS = [
  "예약", "방문접수", "출장", "단체 이용 가능", "간편결제", "반려동물 동반",
  "무인계산", "포장", "배달", "무료주차 " /* 정책 표기 */,
];

/**
 * **대부분이 가진 편의시설** — 있고 없고가 갈려도 학원 선택의 판단 근거가 못 된다.
 *
 * 실측(2026-07-29, 277곳): 주차 89% · 남녀 화장실 81% · 무선 인터넷 70% · 대기공간 42%.
 * 그리고 이 넷만 든 값이 84%다. 실제 생성 4건(서울·부산·광주·제주)에서 편의시설은
 * **한 번도 본문에 쓰이지 않았다** — 모델이 버린 것이고, 그 판단이 맞다. 5곳이 다 "주차 가능"
 * 이면 비교 정보가 아니다.
 *
 * 빼고 나면 45곳(16%)이 남는데 전부 진짜 차별점이다 —
 * 장애인 편의시설 11 · 발렛파킹 14 · 유아시설(놀이방) 4 · 실내 시뮬레이터 · 지문인식 출결 등.
 *
 * "주차 불가" 처럼 **없다는 정보는 남긴다.** 표기 흔들림(무선인터넷/무선 인터넷,
 * 남녀화장실/남/녀 화장실 구분)이 있어 공백·마침표를 지우고 대조한다.
 */
const COMMON_FACILITY_TAGS = new Set([
  "주차", "주차가능", "무료주차",
  "남녀화장실구분", "남/녀화장실구분", "남녀화장실", "남녀구분화장실", "남/녀구분화장실",
  "무선인터넷", "대기공간",
]);

function isCommonFacility(part: string): boolean {
  return COMMON_FACILITY_TAGS.has(part.replace(/[\s.]/g, ""));
}

/**
 * 쉼표로 나열된 편의시설에서 시설이 아닌 조각을 뺀다.
 *
 * 쉼표가 없는 값(서술형 한 문장)은 손대지 않는다 — 가운뎃점으로 나누면
 * "기능·도로·셔틀 대기실" 같은 하나의 시설명이 셋으로 찢어진다.
 */
export function cleanFacilities(value: string): string {
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) {
    const single = value.trim();
    // 태그 하나짜리 값이 시설이 아니면 남길 것이 없다(실측: "예약" 만 있는 값 2건).
    // 길이로 태그와 서술형 문장을 가른다 — 문장 안에 "예약" 이 들어갔다고 통째로 버리면 안 된다.
    if (isCommonFacility(single)) return "";
    return single.length <= 12 && NON_FACILITY_TAGS.some((tag) => single.includes(tag)) ? "" : single;
  }
  return parts
    .filter((part) => !NON_FACILITY_TAGS.some((tag) => part.includes(tag)))
    .filter((part) => !isCommonFacility(part))
    .join(", ");
}

/**
 * 공단이 전 시험장 페이지에 똑같이 붙여 놓은 주차 정형구. 26곳 중 16곳은 이 문장이
 * 값의 전부다 — 남겨 두면 16곳이 다 같은 말로 시작한다(편의시설 공통태그와 같은 문제).
 *
 * 그 시험장의 사실도 아니다. 강서는 이 문장 뒤에 "무료 주차 가능, 주차용량 200대"가
 * 붙어 있어 앞뒤가 모순된다. 정형구를 걷어내야 진짜 주차 사정이 드러난다.
 */
const COMMON_PARKING_NOTICE = /주차\s*공간이?\s*매우\s*협소하?[오요]?니?\s*가급적\s*대중교통을?\s*이용(?:해|하여)?\s*주시기?\s*바랍니다\.?/gu;

export function cleanParkingNote(value: string): string {
  return value.replace(COMMON_PARKING_NOTICE, " ").replace(/\s+/g, " ").trim();
}

/**
 * 대중교통 경로는 출발지별로 여러 개가 나열된다(광양 494자 — 다른 조사 필드의 10배).
 * DB 에는 통째로 남겨 검수 근거로 쓰고, 글에 나갈 때만 첫 경로로 줄인다. 안 줄이면
 * 학원 카드 하나가 프롬프트를 다 먹어 다른 학원 사실이 밀린다.
 */
const TRANSIT_MAX_CHARS = 140;

export function shortenTransit(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= TRANSIT_MAX_CHARS) return trimmed;
  // 경로 한 건은 대개 "…에서 …승차 후 …하차 → 약 N분 소요" 로 끝난다.
  const firstRoute = trimmed.match(/^.*?(?:소요|하차)/u)?.[0] ?? "";
  if (firstRoute && firstRoute.length <= TRANSIT_MAX_CHARS) return firstRoute;
  return `${trimmed.slice(0, TRANSIT_MAX_CHARS).trim()}…`;
}

/**
 * 주변 시설 값에서 **거리와 판단을 걷어낸다.** 남는 것은 "무엇이 곁에 있는가"뿐이다.
 *
 * 수집 프롬프트에서도 막지만 소스에 그렇게 적혀 있으면 모델이 옮겨 적는다. 글로 나갈 때
 * 한 번 더 거르는 이유는 셋 다 우리가 오래 막아 온 종류라서다.
 *  - 거리·소요시간(`약 2km`, `도보 5분`) — T16 계약이 본문에서 금지한다
 *  - 근접 판단(`가까운`, `바로 앞`) — 통학 편의 단정이 된다
 *  - 이용자 구성 추정(`대학생 비중이 높은`) — 검증할 수 없다. 참고 기사가 실제로 이렇게 썼다
 *
 * 셋을 걷어내고 남은 지명이 없으면 빈 문자열을 돌려 그 줄을 아예 내보내지 않는다.
 */
export function cleanLandmarks(value: string): string {
  const stripped = String(value || "")
    // 이용자 구성 추정은 구절째 버린다(낱말만 지우면 문장이 무너진다).
    .split(/[,·;]/u)
    .filter((part) => !/(?:비중|많이\s*(?:이용|찾)|주로\s*(?:이용|찾)|선호|수요가)/u.test(part))
    .join(" · ")
    .replace(/(?:약\s*)?\d+(?:\.\d+)?\s*(?:km|㎞|m|미터|분|시간)\s*(?:거리|이내|소요|권)?/gu, " ")
    .replace(/(?:도보|차량|차로|버스로|지하철로)\s*/gu, " ")
    .replace(/(?:매우\s*)?(?:가까(?:운|워|움|이|은)|인접한?|근접한?|바로\s*(?:앞|옆|근처)|위치해?)/gu, " ")
    .replace(/\s*[·,]\s*(?=[·,])/gu, " ")
    .replace(/^[\s·,]+|[\s·,]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  // 지명이 하나도 안 남으면(전부 거리·판단이었다면) 내보내지 않는다.
  return /[가-힣A-Za-z]{2,}/u.test(stripped) ? stripped : "";
}

export interface ArticleResearchField {
  key: string;
  /** 글로 내보내기 직전에 값을 다듬는다. 빈 문자열을 돌려주면 그 줄은 나가지 않는다. */
  clean?: (value: string) => string;
  /** facts 에 붙일 라벨. 원천 사실과 구분되도록 「(조사)」를 단다. */
  label: string;
  /**
   * true = 원천이 이미 답을 가진 항목. 원천 값이 있으면 조사값은 버린다.
   * (2026-07-27 실측: 수강료·셔틀·운영시간·면허과정은 원천이 압승)
   */
  sourceWins?: boolean;
}

/**
 * 글에 실릴 수 있는 조사 필드. 순서는 facts 에 나가는 순서이자 **중요도 순**이다 —
 * 후보가 많은 글유형에서는 앞쪽 몇 개만 싣는다(카드가 산만해지고 프롬프트가 부푼다).
 */
export const ARTICLE_RESEARCH_FIELDS: ArticleResearchField[] = [
  // 원천이 0% 인 항목들. 조사가 존재하는 이유이자 그 학원만의 강조점이 되는 자리다.
  { key: "facilities", label: "편의시설(조사)", clean: cleanFacilities },
  { key: "self_test", label: "자체 시험장(조사)" },
  { key: "night_class", label: "야간반(조사)" },
  { key: "weekend", label: "주말반(조사)" },
  { key: "closed_days", label: "휴무일(조사)" },
  { key: "established_year", label: "설립연도(조사)" },
  { key: "scale", label: "규모(조사)" },
  { key: "enrollment_prep", label: "등록 준비물(조사)" },
  { key: "transit_access", label: "대중교통 접근(조사)", clean: shortenTransit },
  { key: "parking_note", label: "주차(조사)", clean: cleanParkingNote },
  // 주변 시설 — 그 학원이 어느 생활권에 있는지를 지명으로 보여준다. 주소만으로는 안 되는 자리다
  // (도로명·번지는 카드 불릿이 이미 담고, 독자는 "무엇 근처"인지로 위치를 가늠한다).
  // **거리·소요시간·"가깝다"·이용자 구성 추정은 값에서 걷어낸다** — 수집 프롬프트에서도 막지만,
  // 소스에 그렇게 적혀 있으면 모델이 옮겨 적을 수 있어 글로 나갈 때 한 번 더 거른다.
  { key: "nearby_landmarks", label: "주변 시설(조사)", clean: cleanLandmarks },
  // 원천이 이기는 항목. 원천이 그 학원 값을 안 줄 때만 빈 자리를 메운다.
  { key: "hours", label: "영업시간(조사)", sourceWins: true },
  { key: "shuttle_summary", label: "셔틀(조사)", sourceWins: true },
  { key: "shuttle_available", label: "셔틀 유무(조사)", sourceWins: true },
  { key: "licenses", label: "면허 과정(조사)", sourceWins: true },
];

/**
 * 글에 넣지 않기로 한 필드와 그 이유. 지웠다가 "왜 뺐더라" 로 되돌아오는 것을 막는다.
 *
 * - booking_channel: 189건 중 48건이 값이 그냥 "예약" 이고 6자 이하가 73건(39%)이다.
 *   네이버 플레이스의 편의 태그를 그대로 가져온 탓이라 독자에게 알려줄 내용이 없다.
 * - naver_place_url: 제3자 목록 페이지다. 글에 링크하면 독자를 밖으로 내보내는 셈이고,
 *   학원 자체 정보도 아니다.
 * - homepage_url: 값 자체는 멀쩡하다(207곳 중 83%가 학원 자체 도메인, 11%는 시험장이라
 *   도로교통공단이 맞고, 블로그·카페는 6%뿐이다). 문제는 **글이 쓰지 않는다**는 것이다 —
 *   160곳에 facts 로 나갔지만 모델이 링크로 쓴 적이 없다. 안 쓰이는 값은 프롬프트를 희석할
 *   뿐이다. 링크를 쓰기로 하면(프롬프트에 쓰임새를 주면) 이 목록에 한 줄 넣으면 된다.
 *
 * 셋 다 조사 DB 에는 그대로 남아 학원 상세 화면에서 검수 근거로 쓰인다.
 */
export const EXCLUDED_FROM_ARTICLE = new Set([
  "booking_channel", "naver_place_url", "homepage_url",
  // 금액은 원천만 쓴다. 파일럿 실측에서 수강료 채움률이 원천 87% vs 조사 23% 였고,
  // 무엇보다 **게이트가 조사 금액을 가격 근거로 인정하지 않는다** — hasVerifiedPriceFacts 는
  // `수강료:` 를 찾는데 라벨이 `수강료(조사):` 라 걸리지 않는다. 그런데 fabricatedPriceAmounts
  // 는 facts 원문에서 금액을 긁어 허용해 버린다. 두 검사가 어긋나 있어, 모델이 조사 금액을
  // 쓰면 unverified_specific_price_claim 으로 차단된다 — 값을 주고 쓰지 말라는 덫이다.
  // 라벨을 `수강료:` 로 바꿔 게이트를 통과시키는 방향은 택하지 않았다. 사람이 확인하지 않은
  // AI 금액을 원천 금액과 같은 자격으로 올리는 셈이라, 게이트가 막으려던 바로 그것이 된다.
  "fee_summary", "price_disclosed",
]);

/**
 * 사람이 읽을 문장이 아닌 기계값. "yes" 를 그대로 실으면 모델이 문장으로 못 만든다
 * (self_test 에 "yes" 가 3건 있었다).
 */
const MACHINE_VALUES = new Set(["yes", "no", "true", "false", "unknown", "n/a", "na", "-"]);

const BY_KEY = new Map(ARTICLE_RESEARCH_FIELDS.map((f) => [f.key, f]));

/** 글에 실릴 수 있는 항목의 라벨. 목록에 없는 항목은 빠져도 알릴 일이 아니다. */
export const RESEARCH_FIELD_LABEL = new Map(ARTICLE_RESEARCH_FIELDS.map((f) => [f.key, f.label]));

export function articleResearchField(key: string): ArticleResearchField | undefined {
  return BY_KEY.get(key);
}

/** 이 필드를 글로 내보낼 수 있는가. 목록에 없으면 무조건 false(허용 목록 방식). */
export function usableInArticle(key: string): boolean {
  return !NEVER_IN_ARTICLE.has(key) && !CROSS_CHECK_ONLY.has(key) && BY_KEY.has(key);
}

/**
 * 학원 1곳의 조사값을 facts 줄로 만든다.
 *
 * 원천 사실과 섞지 않고 라벨에 「(조사)」를 달아 내보낸다. 모델이 출처를 구분할 수 있어야
 * "학원 홈페이지에 게시된 바로는" 같은 표현을 고를 수 있고, 검수자도 어디서 온 값인지 안다.
 *
 * @param sourceHas 원천이 이미 답을 가진 필드(수강료·셔틀·영업시간 등)의 키. 그쪽이 이긴다 —
 *   두 값을 다 보내면 모델이 둘을 병기한다(전화번호에서 겪었다: 20편 중 9편이 병기).
 * @param limit 실을 항목 수 상한. 후보가 많은 글유형(비교형 5곳)에서 학원마다 10줄씩 붙으면
 *   프롬프트가 부풀고 카드가 산만해진다. 단독 소개형은 전부 싣는다.
 */
export function researchFactParts(
  research: Record<string, unknown> | null | undefined,
  opts: { sourceHas?: Set<string>; limit?: number } = {},
): string[] {
  if (!research || typeof research !== "object") return [];
  const sourceHas = opts.sourceHas ?? new Set<string>();
  const limit = opts.limit ?? Number.POSITIVE_INFINITY;
  const parts: string[] = [];
  // ARTICLE_RESEARCH_FIELDS 순서 = 중요도 순. 잘릴 때 뒤쪽부터 빠진다.
  for (const field of ARTICLE_RESEARCH_FIELDS) {
    if (parts.length >= limit) break;
    const value = String(research[field.key] ?? "").trim();
    if (!value) continue;
    if (MACHINE_VALUES.has(value.toLowerCase())) continue;
    if (field.sourceWins && sourceHas.has(field.key)) continue;
    const cleaned = field.clean ? field.clean(value).trim() : value;
    if (!cleaned) continue;
    parts.push(`${field.label}: ${cleaned}`);
  }
  return parts;
}
