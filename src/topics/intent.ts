import { findChannel } from "../channels.ts";

// 키워드로 글 유형(article_type)을 추정한다. 유사도 비교(같은 유형의 기존 글 피하기)와
// 프롬프트의 글 구조 선택에 쓴다. 위에서부터 먼저 맞는 규칙을 쓴다.
// channels 가 있는 유형은 그 채널에서만 쓴다. 연수 블로그는 키워드 대부분이 "연수·운전 연습"으로
// 떨어져 글이 한 가지 구성으로만 나왔기 때문에(2026-10-28) 연수 안의 세부 유형을 따로 둔다.
// 채널 전용 유형에는 `prompts/channels/<채널>/<유형>.md` 가 있어야 한다.

const TRAINING_CHANNELS = ["dztraining-blog"] as const;

export const ARTICLE_TYPES = [
  { type: "review", label: "후기·경험담", pattern: /후기|경험|떨어|솔직/ },
  { type: "cost", label: "비용·가격", pattern: /비용|가격|학원비|수강료|요금|얼마|저렴|할인/ },
  {
    type: "recommend",
    label: "추천·비교",
    pattern: /추천|순위|비교|잘하는(곳|데|학원)|좋은|best|베스트|유명/i,
  },
  {
    type: "parking",
    label: "주차 연습",
    pattern: /주차/,
    channels: TRAINING_CHANNELS,
  },
  {
    type: "road_skill",
    label: "도로 운전 요령",
    pattern: /고속도로|차선|끼어들|합류|좌회전|우회전|유턴|비보호|회전교차로|야간운전|빗길|눈길/,
    channels: TRAINING_CHANNELS,
  },
  {
    type: "training_fear",
    label: "장롱면허 극복",
    pattern: /탈출|극복|공포|무서|두려|겁|자신감|트라우마/,
    channels: TRAINING_CHANNELS,
  },
  {
    type: "training_course",
    label: "연수 방식·기간",
    pattern: /방문|자차|시간제|무제한|몇시간|기간|며칠|여성|일대일|1:1/,
    channels: TRAINING_CHANNELS,
  },
  {
    // 키워드로는 판정하지 않는다. 수집이 "직영점은 없지만 가까운 직영점이 있는 지역"에 붙인다(regional.ts).
    type: "pre_road",
    label: "실차연수 전 준비(지역)",
    pattern: /(?!)/,
    channels: TRAINING_CHANNELS,
    regionalOnly: true,
  },
  { type: "test_center", label: "시험장 안내", pattern: /시험장/ },
  {
    type: "license_admin",
    label: "면허 관리(갱신·적성검사)",
    pattern: /적성검사|갱신|재발급|면허취소|재취득|벌점|면허정지/,
  },
  { type: "academy", label: "학원 정보", pattern: /학원/ },
  {
    type: "howto",
    label: "절차·방법",
    pattern: /따는법|방법|순서|절차|기간|준비물|신청|접수|예약/,
  },
  { type: "tips", label: "팁·요령", pattern: /합격|팁|요령|코스|노하우|꿀팁|주의/ },
  { type: "training", label: "연수·운전 연습", pattern: /연수|장롱|주차|초보|운전연습/ },
  {
    type: "exam",
    label: "시험 정보",
    pattern: /필기|기능시험|도로주행|시험|신체검사|모의고사|문제|연습면허/,
  },
  { type: "license_type", label: "면허 종류", pattern: /1종|2종|대형|소형|원동기|면허종류/ },
  { type: "guide", label: "일반 정보", pattern: /./ },
] as const;

export type ArticleType = (typeof ARTICLE_TYPES)[number]["type"];

/** 이 채널에서 쓸 수 있는 유형인가. 채널을 모르면 모든 채널 공통 유형만 본다. */
export function isTypeForChannel(type: string, channelId?: string): boolean {
  const t = ARTICLE_TYPES.find((x) => x.type === type);
  if (!t) return false;
  if (!("channels" in t)) return true;
  return channelId !== undefined && (t.channels as readonly string[]).includes(channelId);
}

export function inferArticleType(keyword: string, channelId?: string): ArticleType {
  const k = keyword.replace(/\s+/g, "");
  return (
    ARTICLE_TYPES.find((t) => isTypeForChannel(t.type, channelId) && t.pattern.test(k)) ??
    ARTICLE_TYPES[ARTICLE_TYPES.length - 1]!
  ).type;
}

/** 채널 전용 유형이면 그 채널 이름을 붙인 선택지 이름. 여러 채널에 한 번에 추가하는 화면용. */
export function articleTypeOptionLabel(type: (typeof ARTICLE_TYPES)[number]): string {
  if (!("channels" in type)) return type.label;
  const channels = type.channels.map((id) => findChannel(id)?.label ?? id).join(", ");
  return `${type.label} (${channels} 전용)`;
}

export function articleTypeLabel(type: string): string {
  return ARTICLE_TYPES.find((t) => t.type === type)?.label ?? type;
}
