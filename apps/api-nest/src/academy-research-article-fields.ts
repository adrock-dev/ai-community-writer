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

export interface ArticleResearchField {
  key: string;
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
  { key: "facilities", label: "편의시설(조사)" },
  { key: "self_test", label: "자체 시험장(조사)" },
  { key: "night_class", label: "야간반(조사)" },
  { key: "weekend", label: "주말반(조사)" },
  { key: "closed_days", label: "휴무일(조사)" },
  { key: "established_year", label: "설립연도(조사)" },
  { key: "scale", label: "규모(조사)" },
  { key: "enrollment_prep", label: "등록 준비물(조사)" },
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
    parts.push(`${field.label}: ${value}`);
  }
  return parts;
}
