// 아키타입 레지스트리: 글유형의 "동작 원형"(코드가 소유하는 재사용 단위). docs/archetype-audit.md 참조.
// 글유형(TEMPLATE_SPECS)은 `kind`로 아키타입을 참조하고, 레시피 파라미터(use_persona/axis_tags/direction 등)만 갖는다.
// 즉 아키타입 = "고르는 대상(registry)", 글유형 = "아키타입 참조 + 레시피 파라미터".
// Phase 2에서 글유형(파라미터)이 DB화·편집 대상이 되고, 아키타입은 코드 registry로 남아 품질을 보장한다.

import { TEMPLATE_SPECS } from "./constants.js";

type Row = Record<string, any>;

// 주키워드 생성 규칙 (slot.service 의 buildPrimaryKeyword + region 오버라이드 통합).
export type KeywordRule =
  | { format: "plain" }                                            // 키워드 축 값 그대로
  | { format: "pick"; pattern: RegExp; fallback: string | "@value" } // 정규식 매칭 키워드, 없으면 fallback(@value=현재 값)
  | { format: "region_plus_fixed"; fixed: string }                 // "지역 + 고정어"
  | { format: "region_plus_pick"; pattern: RegExp };               // "지역 + 정규식 매칭 키워드(없으면 첫 키워드)"

export type Archetype = {
  id: string;                     // 아키타입 정체성 (= 글유형의 kind). 재사용 가능한 키.
  primary: "region" | "keyword";
  keyword_rule: KeywordRule;
  academy_centric: boolean;       // worker: 학원 facts+이미지 수집
  article_type: string;           // 패턴 선택용 분류 (articleTypeForSlot 의 ID 기준 기본값)
  writing_guide: string[];        // 유형별 작성 지침(프롬프트 주입). 글 품질을 좌우.
};

// 빌트인 아키타입 registry (kind 키). 현재 구현에서 그대로 추출 — 동작 불변, 골든으로 검증.
export const ARCHETYPES: Record<string, Archetype> = {
  local_best: {
    id: "local_best", primary: "region", keyword_rule: { format: "region_plus_pick", pattern: /운전면허학원|자동차학원/u }, academy_centric: true, article_type: "local_best_comparison",
    writing_guide: [
      "제목은 '지역 + 운전면허학원/BEST/가격 비교/셔틀' 축으로 잡되, 실제 후보 수보다 큰 숫자는 금지",
      "도입에서 지역 생활권·출퇴근/통학 동선을 짚고, 후보별 사진과 비교표를 넣는다",
      "가격·셔틀·후기는 자료가 있을 때만 단정하고 없으면 상담 질문으로 구체화한다",
    ],
  },
  general_guide: {
    id: "general_guide", primary: "keyword", keyword_rule: { format: "plain" }, academy_centric: false, article_type: "general_best",
    writing_guide: [
      "검색자가 전체 흐름을 한 번에 이해하도록 준비 순서, 비용 확인, 시험 단계, 학원 선택 기준을 이어 쓴다",
      "표는 '단계/확인할 것/놓치기 쉬운 점' 형태가 적합하다",
    ],
  },
  license_compare: {
    id: "license_compare", primary: "keyword", keyword_rule: { format: "pick", pattern: /1종|2종|대형|소형|종보통/u, fallback: "@value" }, academy_centric: false, article_type: "cost_comparison",
    writing_guide: [
      "1종/2종/자동/수동/대형 등 선택지가 헷갈리는 상황을 비교한다",
      "추천 대상과 주의점을 표로 정리하고 과장된 합격 보장은 피한다",
    ],
  },
  cost_strategy: {
    id: "cost_strategy", primary: "keyword", keyword_rule: { format: "pick", pattern: /비용|가격|수강료|절약/u, fallback: "@value" }, academy_centric: false, article_type: "cost_comparison",
    writing_guide: [
      "원본의 비용·시간 절약 전략형처럼 총액, 추가비, 재시험 가능성, 셔틀 동선을 구체 질문으로 풀어낸다",
      "확정 가격이 없으면 '상담 때 물을 질문'을 상세히 적어 빈말을 줄인다",
    ],
  },
  exam_best: {
    id: "exam_best", primary: "keyword", keyword_rule: { format: "pick", pattern: /필기시험|기능시험|도로주행|시험/u, fallback: "@value" }, academy_centric: false, article_type: "exam_best",
    writing_guide: [
      "필기/기능/도로주행 중 하나의 시험 단계를 집중 공략한다",
      "자주 틀리는 포인트, 연습 순서, 체크리스트를 앞쪽에 둔다",
    ],
  },
  regional_hub: {
    id: "regional_hub", primary: "region", keyword_rule: { format: "region_plus_pick", pattern: /운전면허|운전면허학원/u }, academy_centric: false, article_type: "local_access",
    writing_guide: [
      "지역 허브 글처럼 학원 선택, 시험장/접수/비용/준비물을 넓게 연결한다",
      "관련 글 후보가 있으면 내부 링크를 묶어 다음 글로 이어지게 한다",
    ],
  },
  written_registration: {
    id: "written_registration", primary: "keyword", keyword_rule: { format: "pick", pattern: /필기시험.*접수|접수.*필기시험/u, fallback: "운전면허 필기시험 접수" }, academy_centric: false, article_type: "exam_best",
    writing_guide: [
      "운전면허 필기시험 접수형. 온라인/현장 접수, 준비물, 사진, 신분증, 수수료 확인 항목을 절차형으로 쓴다",
      "공식 정보는 최신 확인 필요 문장으로 보수적으로 처리한다",
    ],
  },
  written_tips: {
    id: "written_tips", primary: "keyword", keyword_rule: { format: "pick", pattern: /필기시험.*(?:팁|문제|공부|합격)/u, fallback: "운전면허 필기시험 팁" }, academy_centric: false, article_type: "exam_best",
    writing_guide: [
      "필기시험 팁형. 공부 순서, 문제 유형, 앱/모의고사 활용, 시험 당일 체크를 경험형으로 쓴다",
    ],
  },
  written_app: {
    id: "written_app", primary: "keyword", keyword_rule: { format: "pick", pattern: /필기시험.*(?:어플|앱)/u, fallback: "운전면허 필기시험 어플" }, academy_centric: false, article_type: "exam_best",
    writing_guide: [
      "필기시험 앱 추천형. 앱을 임의로 꾸며내지 말고, 앱 선택 기준과 기능 체크리스트 중심으로 쓴다",
    ],
  },
  test_center: {
    id: "test_center", primary: "region", keyword_rule: { format: "region_plus_fixed", fixed: "운전면허시험장" }, academy_centric: true, article_type: "exam_best",
    writing_guide: [
      "지역 운전면허시험장 소개형. 시험장 위치/동선/방문 전 확인사항 중심으로 작성하고 학원 글과 구분한다",
    ],
  },
  license_complete: {
    id: "license_complete", primary: "keyword", keyword_rule: { format: "pick", pattern: /취득|총정리|준비물/u, fallback: "@value" }, academy_centric: false, article_type: "general_best",
    writing_guide: [
      "운전면허 취득 총정리형. 교육→필기→기능→도로주행→면허발급 순서로 큰 그림을 제공한다",
    ],
  },
  persona_target: {
    id: "persona_target", primary: "keyword", keyword_rule: { format: "plain" }, academy_centric: false, article_type: "general_best",
    writing_guide: [
      "특정 타겟 맞춤형. 페르소나의 시간표·예산·이동수단을 기준으로 추천 기준을 달리한다",
    ],
  },
  academy_profile: {
    id: "academy_profile", primary: "region", keyword_rule: { format: "region_plus_pick", pattern: /운전면허학원|자동차운전전문학원|자동차학원/u }, academy_centric: true, article_type: "local_access",
    writing_guide: [
      "전문학원 단독 소개형. 가장 적합한 1곳을 중심으로 사진, 과정, 위치, 상담 질문을 깊게 쓴다",
    ],
  },
  local_exam_mix: {
    id: "local_exam_mix", primary: "region", keyword_rule: { format: "region_plus_pick", pattern: /필기시험|기능시험|도로주행|운전면허학원/u }, academy_centric: false, article_type: "local_access",
    writing_guide: [
      "지역+시험단계 혼합형. 지역 후보와 필기/기능/도로주행 준비 팁을 연결한다",
    ],
  },
};

// 아키타입 id(kind)로 조회.
export function getArchetype(archetypeId: string): Archetype | undefined {
  return ARCHETYPES[archetypeId];
}

// 글유형(template_id)의 아키타입 조회 — 글유형의 `kind`가 아키타입 참조다.
export function getArchetypeForTemplate(templateId: string): Archetype | undefined {
  const spec = (TEMPLATE_SPECS as Record<string, any>)[templateId];
  return spec ? ARCHETYPES[String(spec.kind || "")] : undefined;
}

// 유형별 작성 지침 텍스트 (worker.originalTemplateGuide 대체). 알 수 없는 유형은 general_guide 로 폴백.
export function writingGuideText(templateId: string): string {
  const guide = getArchetypeForTemplate(templateId)?.writing_guide ?? ARCHETYPES.general_guide!.writing_guide;
  return guide.map((line) => `- ${line}`).join("\n");
}

// 주키워드 인터프리터 — 흩어진 buildPrimaryKeyword + chooseKeywordForTemplate + region 오버라이드를 하나로.
// primaryValue: region-primary면 지역 값, keyword-primary면 키워드 축 값.
// 반환 ""은 "이 조합 스킵"(기존 `if (!primaryKeyword) continue` / chooseKeyword null 과 동일 의미).
// ⚠️ keywordAxis 는 반드시 listAxes 정렬(weight DESC, value)로 넘겨야 한다. pick/region_plus_pick 의
//    "첫 매칭"이 순서에 의존하므로, 순서가 다르면 주키워드(→slug/제목)가 달라진다. (골든 검증으로 확인됨)
export function buildKeyword(arch: Archetype, primaryValue: string, keywordAxis: Row[]): string {
  const value = String(primaryValue || "").trim();
  if (!value) return "";
  const r = arch.keyword_rule;
  switch (r.format) {
    case "plain":
      return value;
    case "pick":
      return pick(keywordAxis, r.pattern, r.fallback === "@value" ? value : r.fallback);
    case "region_plus_fixed":
      return joinRegion(value, r.fixed);
    case "region_plus_pick": {
      const kw = keywordAxis.find((k) => r.pattern.test(String(k.value || ""))) || keywordAxis[0];
      if (!kw) return ""; // chooseKeywordForTemplate 이 null 반환하던 경우
      return joinRegion(value, String(kw.value));
    }
  }
}

function pick(keywords: Row[], pattern: RegExp, fallback: string): string {
  return String((keywords.find((kw) => pattern.test(String(kw.value || ""))) || {}).value || fallback);
}
function joinRegion(region: string, keyword: string): string {
  return `${String(region || "").trim()} ${String(keyword || "").trim()}`.replace(/\s+/g, " ").trim();
}
