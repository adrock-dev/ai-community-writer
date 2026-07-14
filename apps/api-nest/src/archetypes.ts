// 아키타입 레지스트리: 글유형의 "동작 원형"(코드가 소유하는 재사용 단위). docs/archetype-audit.md 참조.
// 글유형(TEMPLATE_SPECS)은 `kind`로 아키타입을 참조하고, 레시피 파라미터(use_persona/axis_tags/direction 등)만 갖는다.
// 즉 아키타입 = "고르는 대상(registry)", 글유형 = "아키타입 참조 + 레시피 파라미터".
// Phase 2에서 글유형(파라미터)이 DB화·편집 대상이 되고, 아키타입은 코드 registry로 남아 품질을 보장한다.

import { ACADEMY_MAX_CANDIDATES, ACADEMY_MIN_FOR_BEST, TEMPLATE_SPECS } from "./constants.js";

type Row = Record<string, any>;

// 주키워드 생성 규칙 (slot.service 의 buildPrimaryKeyword + region 오버라이드 통합).
export type KeywordRule =
  | { format: "plain" }                                            // 키워드 축 값 그대로
  | { format: "pick"; pattern: RegExp; fallback: string | "@value" } // 정규식 매칭 키워드, 없으면 fallback(@value=현재 값)
  | { format: "region_plus_fixed"; fixed: string }                 // "지역 + 고정어"
  | { format: "region_plus_pick"; pattern: RegExp };               // "지역 + 정규식 매칭 키워드(없으면 첫 키워드)"

// writing_guide: 지역 중립 core(항상 주입) + region_overlay(이 조합이 region-primary 일 때만 추가).
// 이 분해로 writing_guide↔region 연성결합을 끊는다 — 같은 아키타입을 지역 있는/없는 글유형에
// 써도 지침이 헛돌지 않으므로, primary_override(지역 결합 자유)가 안전해진다.
export type WritingGuide = { core: string[]; region_overlay?: string[] };

export type Archetype = {
  id: string;                     // 아키타입 정체성 (= 글유형의 kind). 재사용 가능한 키.
  primary: "region" | "keyword";  // free 모드에서 primary_override 없을 때의 기본 주축. (골든 load-bearing)
  keyword_rule: KeywordRule;      // keyword_filter 없는 커스텀 글유형의 폴백 주키워드 규칙. 빌트인은 전부 free 모드라 미참조.
  academy_centric: boolean;       // worker: 학원 facts+이미지 수집(lead). slot: BEST 근거 경고. (골든과 무관하나 생성 load-bearing)
  academy_min?: number;           // 충분/보장/차단 기준 = 이 아키타입이 최소로 필요로 하는 학원 수. 미지정 시 ACADEMY_MIN_FOR_BEST(2).
  academy_pool?: number;          // 한 글이 모으는 학원 후보 풀 크기(=단독형이면 1). 미지정 시 ACADEMY_MAX_CANDIDATES(7).
  writing_guide: WritingGuide;    // 유형별 작성 지침(프롬프트 주입). 글 품질을 좌우.
};

// 아키타입이 요구하는 최소 학원 수 / 후보 풀 크기. 미지정 아키타입은 비교형 기본값(2 / 7).
export function academyMin(a: Archetype | undefined): number { return a?.academy_min ?? ACADEMY_MIN_FOR_BEST; }
export function academyPool(a: Archetype | undefined): number { return a?.academy_pool ?? ACADEMY_MAX_CANDIDATES; }

// 빌트인 아키타입 registry (kind 키). 14종을 작성 방식 기준으로 통합했고, '지역 비교(local)'와
// '지역 단독 소개(local_single)'는 요구 학원 수·프레이밍이 달라 분리했다(6종).
// primary/academy_centric 은 흡수한 글유형 클러스터 내에서 보존 → 골든 0-diff.
export const ARCHETYPES: Record<string, Archetype> = {
  // 지역 학원 여러 곳 비교(academy-lead). 흡수: local_best(T01). 학원 2곳 이상 필요.
  local: {
    id: "local", primary: "region", keyword_rule: { format: "region_plus_pick", pattern: /운전면허학원|자동차운전전문학원|자동차학원/u }, academy_centric: true,
    writing_guide: {
      core: [
        "확인된 후보 시설(학원·시험장 등)만 사진과 요약표로 소개하고, 실제 후보 수보다 큰 숫자는 만들지 않는다",
        "후보가 여럿이면 비교표와 추천 기준으로 정리하고, 1곳이면 그 시설의 과정·위치·상담 때 확인할 질문을 깊게 다룬다",
        "가격·셔틀·합격률·후기는 자료가 있을 때만 단정하고, 없으면 상담 때 확인할 질문으로 구체화한다",
      ],
      region_overlay: [
        "도입에서 지역 생활권과 출퇴근/통학 동선을 짚고, 후보별로 '### 후보명' 소제목과 위치/생활권을 붙인다",
        "후보별 사진과 지역 기준 거리를 비교표에 반영한다",
      ],
    },
  },
  // 지역 시설 1곳 단독 심층 소개(academy-lead, 비교 아님). 흡수: academy_profile(T14)·test_center(T11).
  // 학원 1곳이면 성립(min 1), 후보 풀도 1곳 — 비교표/BEST 프레이밍을 만들지 않는다.
  local_single: {
    id: "local_single", primary: "region", keyword_rule: { format: "region_plus_pick", pattern: /운전면허학원|자동차운전전문학원|자동차학원|운전면허시험장/u }, academy_centric: true,
    academy_min: 1, academy_pool: 1,
    writing_guide: {
      core: [
        "그 지역의 대상 시설 1곳을 단독으로 깊게 소개한다 — 비교표·BEST·'후보 N곳' 같은 비교 프레이밍을 쓰지 않는다",
        "그 시설의 과정·위치·운영 형태·후기 같은 확인된 자료만 쓰고, 가격·셔틀·합격률은 자료가 있을 때만 단정하고 없으면 상담 때 확인할 질문으로 구체화한다",
      ],
      region_overlay: [
        "도입에서 그 시설의 위치·생활권·출발지별 방문 동선을 짚고, 상담 예약·비용·일정 확인 질문으로 전환을 연결한다",
      ],
    },
  },
  // 지역 종합·혼합(academy-support). 흡수: regional_hub(T07)·local_exam_mix(T15).
  local_hub: {
    id: "local_hub", primary: "region", keyword_rule: { format: "region_plus_pick", pattern: /운전면허|운전면허학원/u }, academy_centric: false,
    writing_guide: {
      core: [
        "한 주제를 좁게 파지 말고 학원 선택·시험장·접수·비용·준비물을 넓게 연결하는 허브형으로 쓴다",
        "관련 글 후보가 있으면 실제 내부 링크로 묶어 다음 글로 이어지게 한다",
      ],
      region_overlay: [
        "지역 후보와 시험장·생활권을 축으로 삼고, 필기/기능/도로주행 준비 팁을 지역 정보와 엮는다",
      ],
    },
  },
  // 종합 가이드·총정리(keyword). 흡수: general_guide(T03)·license_complete(T12)·persona_target(T13).
  guide: {
    id: "guide", primary: "keyword", keyword_rule: { format: "plain" }, academy_centric: false,
    writing_guide: {
      core: [
        "검색자가 전체 흐름을 한 번에 이해하도록 준비 순서 → 비용 확인 → 시험 단계(교육·필기·기능·도로주행·면허발급) → 선택 기준을 이어서 총정리한다",
        "표는 '단계/확인할 것/놓치기 쉬운 점' 형태가 적합하다",
        "페르소나가 주어지면 그 대상의 시간표·예산·이동수단을 기준으로 추천 기준을 조정한다",
      ],
    },
  },
  // 선택지·비용 비교(keyword). 흡수: license_compare(T04)·cost_strategy(T05).
  compare: {
    id: "compare", primary: "keyword", keyword_rule: { format: "pick", pattern: /1종|2종|대형|소형|종보통|비용|가격|수강료|절약/u, fallback: "@value" }, academy_centric: false,
    writing_guide: {
      core: [
        "헷갈리는 선택지(면허 종류·옵션·비용안)를 비교해, 독자가 자기 상황에 맞게 고르도록 추천 대상과 주의점을 표로 정리한다",
        "비용을 다룰 땐 총액·추가비·재시험 가능성·셔틀 동선을 구체 질문으로 풀고, 확정 금액은 자료가 있을 때만 쓰며 없으면 '상담 때 물을 질문'으로 대체한다",
        "과장된 합격 보장은 피한다",
      ],
    },
  },
  // 시험 단계 공략(keyword). 흡수: exam_best(T06)·written_registration(T08)·written_tips(T09)·written_app(T10).
  exam: {
    id: "exam", primary: "keyword", keyword_rule: { format: "pick", pattern: /필기시험|기능시험|도로주행|시험/u, fallback: "@value" }, academy_centric: false,
    writing_guide: {
      core: [
        "필기/기능/도로주행 중 하나의 시험 단계를 집중 공략하고, 자주 틀리는 포인트·연습 순서·체크리스트를 앞쪽에 둔다",
        "접수를 다룰 땐 온라인/현장 접수·준비물·사진·신분증·수수료 확인 항목을 절차형으로 쓰고, 공식 정보는 '최신 확인 필요'로 보수적으로 처리한다",
        "공부·팁은 문제 유형·앱/모의고사 활용·시험 당일 체크를 경험형으로 쓰되, 앱·도구는 임의로 꾸며내지 말고 선택 기준과 기능 체크리스트 중심으로 다룬다",
      ],
    },
  },
};

// 옛 kind(14종) → 새 kind(5종) 별칭. DB custom_templates.kind 가 옛 kind 를 참조하는 기존 행을
// 무마이그레이션으로 새 아키타입에 매핑한다(getArchetype 이 resolve). 없으면 general 폴백 회귀.
export const KIND_ALIASES: Record<string, string> = {
  local_best: "local", academy_profile: "local_single", test_center: "local_single",
  regional_hub: "local_hub", local_exam_mix: "local_hub",
  general_guide: "guide", license_complete: "guide", persona_target: "guide",
  license_compare: "compare", cost_strategy: "compare",
  exam_best: "exam", written_registration: "exam", written_tips: "exam", written_app: "exam",
};

// 아키타입 id(kind)로 조회. 옛 kind 는 KIND_ALIASES 로 resolve.
export function getArchetype(archetypeId: string): Archetype | undefined {
  return ARCHETYPES[archetypeId] ?? ARCHETYPES[KIND_ALIASES[archetypeId] ?? ""];
}

// 글유형(template_id)의 아키타입 조회 — 글유형의 `kind`가 아키타입 참조다.
export function getArchetypeForTemplate(templateId: string): Archetype | undefined {
  const spec = (TEMPLATE_SPECS as Record<string, any>)[templateId];
  return spec ? ARCHETYPES[String(spec.kind || "")] : undefined;
}

// 아키타입 writing_guide 를 평탄한 줄 배열로. isRegionPrimary 면 region_overlay 를 core 뒤에 붙인다.
// 미상 아키타입은 guide 로 폴백. (프롬프트 주입·AI 축 제안이 공유)
export function writingGuideLines(archetype: Archetype | undefined, isRegionPrimary = false): string[] {
  const guide = archetype?.writing_guide ?? ARCHETYPES.guide!.writing_guide;
  return [...guide.core, ...(isRegionPrimary ? (guide.region_overlay ?? []) : [])];
}

// 아키타입 작성 지침 텍스트(프롬프트 주입). 커스텀 글유형은 참조 아키타입의 writing_guide 를 그대로 쓴다.
// isRegionPrimary: 이 슬롯이 지역형이면(slot.region 존재) region_overlay 도 주입한다.
export function writingGuideForArchetype(archetype: Archetype | undefined, isRegionPrimary = false): string {
  return writingGuideLines(archetype, isRegionPrimary).map((line) => `- ${line}`).join("\n");
}

// 유형별 작성 지침 텍스트 (worker.originalTemplateGuide 대체). 알 수 없는 유형은 guide 로 폴백.
export function writingGuideText(templateId: string): string {
  return writingGuideForArchetype(getArchetypeForTemplate(templateId));
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
