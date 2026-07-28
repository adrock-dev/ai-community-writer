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
  { key: "booking_channel", label: "예약 방법(조사)" },
  { key: "homepage_url", label: "홈페이지(조사)" },
  // 원천이 이기는 항목. 원천이 그 학원 값을 안 줄 때만 빈 자리를 메운다.
  { key: "hours", label: "영업시간(조사)", sourceWins: true },
  { key: "shuttle_summary", label: "셔틀(조사)", sourceWins: true },
  { key: "shuttle_available", label: "셔틀 유무(조사)", sourceWins: true },
  { key: "licenses", label: "면허 과정(조사)", sourceWins: true },
  { key: "fee_summary", label: "수강료(조사)", sourceWins: true },
  { key: "price_disclosed", label: "가격 공개 여부(조사)", sourceWins: true },
  { key: "naver_place_url", label: "네이버 플레이스(조사)" },
];

const BY_KEY = new Map(ARTICLE_RESEARCH_FIELDS.map((f) => [f.key, f]));

export function articleResearchField(key: string): ArticleResearchField | undefined {
  return BY_KEY.get(key);
}

/** 이 필드를 글로 내보낼 수 있는가. 목록에 없으면 무조건 false(허용 목록 방식). */
export function usableInArticle(key: string): boolean {
  return !NEVER_IN_ARTICLE.has(key) && !CROSS_CHECK_ONLY.has(key) && BY_KEY.has(key);
}
