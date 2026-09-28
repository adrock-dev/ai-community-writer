// 키워드로 글 유형(article_type)을 추정한다. 유사도 비교(같은 유형의 기존 글 피하기)와
// 프롬프트의 글 구조 선택에 쓴다. 위에서부터 먼저 맞는 규칙을 쓴다.

export const ARTICLE_TYPES = [
  { type: "review", label: "후기·경험담", pattern: /후기|경험|떨어|탈출|솔직/ },
  { type: "cost", label: "비용·가격", pattern: /비용|가격|학원비|수강료|요금|얼마|저렴|할인/ },
  {
    type: "recommend",
    label: "추천·비교",
    pattern: /추천|순위|비교|잘하는|좋은|best|베스트|유명/i,
  },
  { type: "test_center", label: "시험장 안내", pattern: /시험장/ },
  { type: "academy", label: "학원 정보", pattern: /학원/ },
  {
    type: "howto",
    label: "절차·방법",
    pattern: /따는법|방법|순서|절차|기간|준비물|신청|접수|예약|갱신|재발급/,
  },
  { type: "tips", label: "합격 팁", pattern: /합격|팁|요령|코스|노하우|꿀팁|주의/ },
  { type: "training", label: "연수·운전 연습", pattern: /연수|장롱|주차|초보|운전연습/ },
  {
    type: "exam",
    label: "시험 정보",
    pattern: /필기|기능시험|도로주행|시험|적성검사|신체검사|모의고사|문제|연습면허/,
  },
  { type: "license_type", label: "면허 종류", pattern: /1종|2종|대형|소형|원동기|면허종류/ },
  { type: "guide", label: "일반 정보", pattern: /./ },
] as const;

export type ArticleType = (typeof ARTICLE_TYPES)[number]["type"];

export function inferArticleType(keyword: string): ArticleType {
  const k = keyword.replace(/\s+/g, "");
  return (ARTICLE_TYPES.find((t) => t.pattern.test(k)) ?? ARTICLE_TYPES[ARTICLE_TYPES.length - 1]!)
    .type;
}

export function articleTypeLabel(type: string): string {
  return ARTICLE_TYPES.find((t) => t.type === type)?.label ?? type;
}
