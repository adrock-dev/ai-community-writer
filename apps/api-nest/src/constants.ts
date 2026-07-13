export type AxisName = "region" | "keyword" | "intent" | "persona" | "modifier";
export type ProviderName = "claude" | "codex";
export type JobKind = "generate" | "dedup" | "indexing" | "prune";

export const AXES: AxisName[] = ["region", "keyword", "intent", "persona", "modifier"];
export const DRIVING_VERTICALS = ["driving"] as const;
export const DEFAULT_DRIVING_VERTICAL = "driving";
export const DEFAULT_DRIVING_DESIGN_TEMPLATE = "local-guide";
// 도메인 design_template_id가 이 값이면 글마다 슬롯의 글 유형 기본 디자인(default_design)을 자동 선택한다.
export const AUTO_DESIGN_TEMPLATE_ID = "auto";
export const DEFAULT_DRIVING_BRAND_COLOR = "#2563eb";
// 공통원칙: 모든 글유형에 공통으로 적용되는 안전·데이터 원칙(방향성 제외). buildPrompt 상단에 주입된다.
// 도메인 편집 보이스(운영자가 도메인마다 조정하는 톤·정책). 데이터 검증·내부흔적 금지 등
// 안전/데이터 규칙은 buildPrompt '절대 원칙'에 하드코딩돼 있으므로 여기서 중복하지 않는다.
export const DEFAULT_DRIVING_COMMON_PRINCIPLES = [
  "운전면허를 처음 준비하는 독자도 이해할 수 있는 쉬운 표현과, 신뢰감 있는 전문가 톤을 유지한다.",
  "검색으로 들어온 실사용자가 바로 다음 행동(비교·상담·예약)으로 이어지도록 실용적이고 친절하게 쓴다.",
  "경쟁 브랜드나 특정 학원 비방, 낚시성·과장 표현을 피한다."
].join("\n");

// 구버전 통합 brief 문자열. 마이그레이션에서 기존 content_brief 값을 식별하는 용도로만 남긴다(런타임 미사용).
export const LEGACY_DEFAULT_DRIVING_CONTENT_BRIEF = [
  "운전면허·운전학원 비교 콘텐츠를 회사 도메인 기준으로 발행한다.",
  "지역명, 학원명, 주소, 전화, 사진, 리뷰처럼 확인된 데이터만 사용하고 가격·합격률·셔틀은 데이터가 있을 때만 단정한다.",
  "후보가 부족한 지역은 억지 BEST 숫자를 만들지 말고 직접 확인 가능한 후보와 상담 체크리스트 중심으로 정직하게 작성한다.",
  "주요 전환은 상담 문의, 비용 확인, 셔틀/시간표 확인, 면허 종류별 수강 가능 여부 확인으로 연결한다."
].join("\n");

export const DRIVING_ORIGINAL_TEMPLATE_IDS = [
  "T01", "T03", "T04", "T05", "T06", "T07",
  "T08", "T09", "T10", "T11", "T12", "T13", "T14", "T15"
] as const;
export const DEFAULT_DRIVING_TEMPLATE_IDS = ["T01"] as const;

// default_design: 도메인 디자인이 auto일 때 이 유형의 글에 적용할 기본 디자인(docs/design-template-mapping.md).
// default_direction: 이 글유형의 기본 방향성(공통원칙 위에 얹히는 오버레이). 도메인 template_overrides 로 재정의 가능.
// axis_tags: 이 글유형이 수용하는 축 값 태그(axis-tags.ts). 미지정 축은 전체 허용(["*"]). region/keyword 는 정규식 경로라 제외.
export const TEMPLATE_SPECS = {
  T01: { name: "지역 운전학원 BEST 비교", primary: ["region"], use_persona: true, modifier_count: 2, weight: 1.15, min_sv: 0, kind: "local_best", default_design: "comparison", default_direction: "지역 학원 후보를 비교표와 추천 기준으로 정리하고, 상담·비용·셔틀·면허 종류 확인으로 전환을 연결한다.", axis_tags: { persona: ["*"], modifier: ["*"] }, axis_values: { persona: ["가성비 좋은 학원을 찾는 수강생", "가족 차량 운전을 준비하는 초보자", "결혼 전 면허를 준비하는 예비부부", "교대근무 직장인", "군 입대 전 면허 취득", "대학생 방학 특강 찾는 학생", "방학 중 단기 취득", "복학 전 면허 준비", "부모님 차량을 운전하려는 자녀", "빠른 등록이 가능한 학원을 찾는 수강생", "빠른 시험 일정이 필요한 수강생", "셔틀버스 이용 희망자", "수능 후 면허 준비", "시험장과 가까운 학원을 찾는 수강생", "신차 출고 예정자", "실제 시험 코스로 연습하고 싶은 수강생", "아이 등하교를 준비하는 부모", "야간반을 찾는 직장인", "연습을 많이 할 수 있는 학원을 찾는 수강생", "오늘 상담 가능한 학원을 찾는 사용자", "외국인 운전면허 취득 준비", "운전면허 비용을 비교하는 사용자", "운전면허학원 비교 중인 수강생", "운전이 처음인 초보자", "운전이 필요한 신입사원", "운전전문학원 추천을 찾는 사용자", "유학 출국 전 면허 준비", "육아를 위해 운전이 필요한 부모", "이직 준비 중인 직장인", "자녀 면허를 알아보는 보호자", "자영업자 시간 맞춤 수강", "자체시험 가능한 운전전문학원을 찾는 수강생", "자체시험 가능한 학원을 찾는 수강생", "장롱면허 재도전", "재수생 방학 면허 준비", "주말만 가능한 직장인", "중고차 구매 예정자", "집 가까운 학원을 찾는 수강생", "집 근처 셔틀이 있는 학원을 찾는 수강생", "차량 계약 후 면허를 준비하는 사용자", "처음 면허 따는 대학생", "첫 차 구매 예정자", "첫 출근 전 면허 준비", "출산을 앞둔 예비 부모", "출장이 많은 직장인", "출퇴근을 위해 면허가 필요한 직장인", "취업 전 면허 취득", "취업 준비생", "친구와 함께 등록하려는 대학생", "친절한 강사를 찾는 초보자", "커플이 함께 면허를 준비하는 수강생", "퇴근 후 배우는 직장인", "편입 전 면허 취득", "학원 후기 확인 중인 사용자", "형제자매와 함께 등록하는 수강생", "회사 근처 학원을 찾는 직장인", "회사 입사 예정자"], modifier: ["가까운", "근처", "비용절약", "상담전확인", "셔틀편리", "야간반", "주말반"] }, academy_types: ["exam_academy", "academy"] },
  T03: { name: "운전면허 가이드 총정리", primary: ["keyword"], use_persona: true, modifier_count: 1, weight: 0.95, min_sv: 0, kind: "general_guide", default_design: "editorial", default_direction: "운전면허 절차와 개념을 초보자도 이해하도록 총정리형으로 풀고, 단계별 확인 포인트를 제공한다.", axis_tags: { persona: ["*"], modifier: ["*"] }, axis_values: { persona: ["운전이 처음인 초보자", "처음 면허 따는 대학생", "출퇴근을 위해 면허가 필요한 직장인", "장롱면허 재도전", "육아를 위해 운전이 필요한 부모", "시험 일정이 궁금한 사용자"], modifier: ["비용절약", "필기시험부터", "상담전확인", "주말반"] } },
  T04: { name: "면허 종류/옵션 비교", primary: ["keyword"], use_persona: true, modifier_count: 0, weight: 0.75, min_sv: 0, kind: "license_compare", default_design: "comparison", default_direction: "면허 종류·옵션의 차이와 선택 기준을 비교해, 독자가 자기 상황에 맞는 종류를 고르게 돕는다.", axis_tags: { persona: ["license", "timing", "common"] }, axis_values: { persona: ["1종 보통 취득 희망자", "2종 보통 취득 희망자", "1종 대형 취득 희망자", "2종에서 1종 전환", "2종 소형 취득 희망자", "가족 차량 운전을 준비하는 초보자"] } },
  T05: { name: "비용 및 시간 절약 전략", primary: ["keyword"], use_persona: true, modifier_count: 1, weight: 1.0, min_sv: 0, kind: "cost_strategy", default_design: "comparison", default_direction: "비용·시간을 아끼는 전략을 확인 가능한 기준으로 제시하되, 구체 금액은 자료가 있을 때만 쓴다.", axis_tags: { persona: ["cost", "select", "schedule", "timing", "common"], modifier: ["cost", "select", "schedule", "common"] }, axis_values: { persona: ["가성비 좋은 학원을 찾는 수강생", "운전면허 비용을 비교하는 사용자", "빠른 시험 일정이 필요한 수강생", "주말만 가능한 직장인", "퇴근 후 배우는 직장인", "방학 중 단기 취득"], modifier: ["비용절약", "상담전확인", "셔틀편리", "주말반"] } },
  T06: { name: "시험 단계 집중 BEST", primary: ["keyword"], use_persona: false, modifier_count: 0, weight: 0.9, min_sv: 0, with_intent: true, kind: "exam_best", default_design: "comparison", default_direction: "필기·기능·도로주행 등 시험 단계별 핵심을 집중적으로 정리하고, 준비 순서를 제시한다.", axis_tags: { intent: ["exam", "common"] }, axis_values: { intent: ["기능시험", "도로주행", "필기접수", "준비물"] } },
  T07: { name: "지역 허브 총정리", primary: ["region"], use_persona: false, modifier_count: 0, weight: 1.25, min_sv: 0, with_intent: true, kind: "regional_hub", default_design: "local-guide", default_direction: "지역 단위로 학원·시험장·생활권 정보를 허브형으로 총정리해 지역 검색 의도를 폭넓게 충족한다.", axis_tags: { intent: ["select", "location", "common"] }, axis_values: { intent: ["근처학원", "비교추천", "비용확인", "셔틀확인", "준비물"] }, academy_types: ["exam_academy", "academy"] },
  T08: { name: "운전면허 필기시험 접수", primary: ["keyword"], use_persona: false, modifier_count: 0, weight: 1.08, min_sv: 0, with_intent: true, kind: "written_registration", default_design: "checklist", default_direction: "필기시험 접수 절차·준비물·일정 확인 방법을 단계별 체크리스트로 안내한다.", axis_tags: { intent: ["written", "common"] }, axis_values: { intent: ["필기접수", "준비물", "비용확인"] } },
  T09: { name: "운전면허 필기시험 팁", primary: ["keyword"], use_persona: true, modifier_count: 1, weight: 1.0, min_sv: 0, kind: "written_tips", default_design: "checklist", default_direction: "필기시험 공부·합격 팁을 실전 위주로 정리하고, 준비 순서와 자주 틀리는 포인트를 제공한다.", axis_tags: { persona: ["written", "timing", "common"], modifier: ["written", "common"] }, axis_values: { persona: ["처음 면허 따는 대학생", "취업 준비생", "운전이 처음인 초보자", "시험이 걱정되는 수험생", "재수생 방학 면허 준비"], modifier: ["필기시험부터", "비용절약", "상담전확인"] } },
  T10: { name: "운전면허 필기시험 앱 추천", primary: ["keyword"], use_persona: true, modifier_count: 0, weight: 0.9, min_sv: 0, kind: "written_app", default_design: "comparison", default_direction: "필기시험 학습 앱·도구의 선택 기준과 활용법을 비교 관점으로 정리한다.", axis_tags: { persona: ["written", "timing", "common"] }, axis_values: { persona: ["처음 면허 따는 대학생", "취업 준비생", "운전이 처음인 초보자", "시험이 걱정되는 수험생"] } },
  T11: { name: "지역 운전면허시험장 소개", primary: ["region"], use_persona: false, modifier_count: 0, weight: 1.0, min_sv: 0, with_intent: true, kind: "test_center", default_design: "local-guide", default_direction: "지역 운전면허시험장의 위치·동선·준비물·확인 포인트를 안내한다.", axis_tags: { intent: ["location", "select", "common"] }, axis_values: { intent: ["준비물", "비교추천", "비용확인", "근처학원"] }, academy_types: ["license_test_course", "license_center"] },
  T12: { name: "운전면허 취득 총정리", primary: ["keyword"], use_persona: true, modifier_count: 1, weight: 1.0, min_sv: 0, kind: "license_complete", default_design: "editorial", default_direction: "면허 취득 전 과정을 처음부터 끝까지 총정리하고, 단계별 준비물과 확인 사항을 제공한다.", axis_tags: { persona: ["license", "select", "timing", "common"], modifier: ["select", "common"] }, axis_values: { persona: ["운전이 처음인 초보자", "처음 면허 따는 대학생", "취업 전 면허 취득", "군 입대 전 면허 취득", "방학 중 단기 취득", "출퇴근을 위해 면허가 필요한 직장인", "등록 절차를 알아보는 사용자"], modifier: ["필기시험부터", "비용절약", "주말반"] } },
  T13: { name: "타겟별 운전면허 준비", primary: ["keyword"], use_persona: true, modifier_count: 1, weight: 0.9, min_sv: 0, kind: "persona_target", default_design: "editorial", default_direction: "대상(페르소나)별 상황에 맞춰 면허 준비 방법과 확인 포인트를 제안한다.", axis_tags: { persona: ["*"], modifier: ["*"] }, axis_values: { persona: ["교대근무 직장인", "주말만 가능한 직장인", "대학생 방학 특강 찾는 학생", "육아를 위해 운전이 필요한 부모", "장롱면허 재도전", "외국인 운전면허 취득 준비", "취업 준비생", "자영업자 시간 맞춤 수강", "T자 주차가 어려운 초보자", "경사로가 어려운 수험생", "기능시험 재응시 준비", "기능시험이 어려운 수험생", "도로주행 재응시 준비", "도로주행이 두려운 수험생", "주차가 어려운 초보자", "평행주차를 배우고 싶은 초보자", "야간운전이 걱정되는 초보자", "비 오는 날 운전이 걱정되는 초보자", "운전에 자신감이 없는 초보자"], modifier: ["야간반", "주말반", "비용절약", "셔틀편리"] } },
  T14: { name: "전문학원 단독 소개", primary: ["region"], use_persona: true, modifier_count: 0, weight: 0.98, min_sv: 0, kind: "academy_profile", default_design: "conversion", default_direction: "특정 전문학원을 단독으로 소개하되 확인된 자료만 사용하고, 상담·비용·셔틀 확인으로 전환을 연결한다.", axis_tags: { persona: ["*"] }, axis_values: { persona: ["가성비 좋은 학원을 찾는 수강생", "집 근처 학원을 찾는 수강생", "셔틀버스 이용 희망자", "자체시험 가능한 운전전문학원을 찾는 수강생", "오늘 상담 가능한 학원을 찾는 사용자", "학원 후기 확인 중인 사용자", "시험장과 가까운 학원을 찾는 수강생"] }, academy_types: ["exam_academy"] },
  T15: { name: "지역+시험단계 혼합", primary: ["region"], use_persona: true, modifier_count: 1, weight: 0.95, min_sv: 0, with_intent: true, kind: "local_exam_mix", default_design: "local-guide", default_direction: "지역과 시험 단계를 함께 엮어 지역 학원·시험 준비 정보를 제공한다.", axis_tags: { persona: ["select", "practice", "timing", "common"], intent: ["exam", "select", "common"], modifier: ["select", "practice", "common"] }, axis_values: { persona: ["운전면허학원 비교 중인 수강생", "처음 면허 따는 대학생", "시험이 걱정되는 수험생", "집 근처 학원을 찾는 수강생", "주말만 가능한 직장인"], intent: ["기능시험", "도로주행", "근처학원", "준비물"], modifier: ["가까운", "셔틀편리", "필기시험부터", "도로주행"] }, academy_types: ["exam_academy", "academy"] }
} as const;

// 글유형(빌트인 TEMPLATE_SPECS / 커스텀 custom_templates row)을 동일 형태로 정규화한 리졸버 반환형.
// primary 는 여기 넣지 않는다 — getArchetype(kind).primary 로 얻는다(빌트인/커스텀 동일 경로).
export type TemplateSpecShape = {
  name: string;
  kind: string;
  use_persona: boolean;
  with_intent: boolean;
  modifier_count: number;
  weight: number;
  min_sv: number;
  axis_tags?: { persona?: string[]; intent?: string[]; modifier?: string[] };
  // 글유형 소속 축 값 프리셋(persona/intent/modifier). 있으면 도메인 공통 축 풀을 '대체'한다(없으면 폴백).
  // region/keyword 는 도메인 실데이터라 여기 두지 않는다.
  axis_values?: { persona?: string[]; intent?: string[]; modifier?: string[] };
  // 글유형별 학원 타입(academy_type) — 학원 사용의 단일 소스. 선택값이 있으면 그 타입 학원만 생성/렌더에 쓰고,
  // 비어 있으면 학원정보를 아예 쓰지 않는다(지역형이어도 가이드/체크리스트 중심). 지역 유무와 무관하게 이 값이 게이트다.
  academy_types?: string[];
  // 글유형별 keyword 필터 — 도메인 keyword 풀의 '부분집합'(대체 아님). 있으면 이 글유형은 고른 키워드만 쓰고,
  // 비면 도메인 풀 전체(기존 동작). keyword_rule(pick/plain/region_plus_*) 은 이 부분집합 위에 그대로 적용된다.
  keyword_filter?: string[];
  default_direction?: string;
  default_design?: string;
};

// 글 유형의 기본 디자인. 알 수 없는 유형은 기본 디자인으로 폴백한다.
export function defaultDesignForTemplate(templateId: string): string {
  const spec = (TEMPLATE_SPECS as Record<string, { default_design?: string }>)[templateId];
  return spec?.default_design || DEFAULT_DRIVING_DESIGN_TEMPLATE;
}

// 학원 타입(academy_type) 정식 목록. 외부 서버가 현재 academy/exam_academy 만 내려주지만 정식은 5종이다.
// 커스텀 글유형 학원 타입 필터 체크박스가 이 목록을 쓴다(동기화 데이터에 아직 없는 타입도 미리 선택 가능).
export const ACADEMY_TYPES = ["academy", "exam_academy", "license_test_course", "indoor_academy", "license_center"] as const;

export const DESIGN_TEMPLATES = [
  { id: "local-guide", name: "지역 운전학원 추천", summary: "지역명, 생활권, 셔틀/동선, 상담 확인점을 강조하는 로컬 SEO 구성", best_for: "운전학원 추천, 근처/주변/동네 검색어" },
  { id: "comparison", name: "운전학원 비교", summary: "비교표와 추천 기준을 먼저 보여주는 선택형 구성", best_for: "BEST, 추천, 수강료/기간/옵션 비교" },
  { id: "checklist", name: "시험 준비 체크리스트", summary: "필기·기능·도로주행 준비 순서를 따라가기 쉽게 정리", best_for: "접수, 준비물, 시험 팁, 절차 키워드" },
  { id: "conversion", name: "상담 전환형", summary: "상담, 비용 문의, 셔틀/시간표 확인 버튼을 강조하는 전환형 구성", best_for: "예약, 상담, 비용 문의, 학원 소개" },
  { id: "editorial", name: "브랜드 매거진", summary: "큰 대표 이미지와 부드러운 CTA가 있는 정보성 블로그형", best_for: "초보자 가이드, 총정리 글" },
  { id: "custom", name: "커스텀", summary: "직접 적은 디자인 메모를 프롬프트와 미리보기에 반영", best_for: "브랜드 가이드가 있는 사이트" }
] as const;

export const PRESETS: Record<string, Record<AxisName, Array<Record<string, unknown>>>> = {
  driving: {
    region: [
      { value: "서울", weight: 5, monthly_search_volume: 5200, competition_kd: 60 },
      { value: "강남", weight: 5, monthly_search_volume: 3200, competition_kd: 68 },
      { value: "송파", weight: 4, monthly_search_volume: 1800, competition_kd: 48 },
      { value: "마포", weight: 4, monthly_search_volume: 1500, competition_kd: 44 },
      { value: "노원", weight: 4, monthly_search_volume: 1600, competition_kd: 42 },
      { value: "경기", weight: 5, monthly_search_volume: 4800, competition_kd: 50 },
      { value: "수원", weight: 5, monthly_search_volume: 2400, competition_kd: 42 },
      { value: "용인", weight: 4, monthly_search_volume: 1400, competition_kd: 36 },
      { value: "성남", weight: 4, monthly_search_volume: 1500, competition_kd: 38 },
      { value: "안산", weight: 5, monthly_search_volume: 1800, competition_kd: 38 },
      { value: "인천", weight: 5, monthly_search_volume: 2600, competition_kd: 45 },
      { value: "부천", weight: 4, monthly_search_volume: 1700, competition_kd: 40 },
      { value: "부산", weight: 5, monthly_search_volume: 2800, competition_kd: 40 },
      { value: "대구", weight: 5, monthly_search_volume: 2100, competition_kd: 38 },
      { value: "광주", weight: 4, monthly_search_volume: 1500, competition_kd: 35 },
      { value: "대전", weight: 4, monthly_search_volume: 1700, competition_kd: 36 },
      { value: "울산", weight: 3, monthly_search_volume: 900, competition_kd: 34 },
      { value: "세종", weight: 3, monthly_search_volume: 700, competition_kd: 32 },
      { value: "제주", weight: 3, monthly_search_volume: 800, competition_kd: 35 }
    ],
    keyword: [
      { value: "운전면허학원", weight: 10, monthly_search_volume: 9900, competition_kd: 55 },
      { value: "자동차운전전문학원", weight: 9, monthly_search_volume: 7600, competition_kd: 48 },
      { value: "자동차학원", weight: 8, monthly_search_volume: 5400, competition_kd: 48 },
      { value: "운전면허", weight: 10, monthly_search_volume: 12000, competition_kd: 48 },
      { value: "운전면허 합격", weight: 9, monthly_search_volume: 10000, competition_kd: 45 },
      { value: "운전면허 비용", weight: 8, monthly_search_volume: 4400, competition_kd: 38 },
      { value: "운전면허 수강료", weight: 8, monthly_search_volume: 3600, competition_kd: 37 },
      { value: "1종보통", weight: 7, monthly_search_volume: 3600, competition_kd: 42 },
      { value: "2종보통", weight: 7, monthly_search_volume: 5400, competition_kd: 40 },
      { value: "운전면허 필기시험", weight: 9, monthly_search_volume: 8100, competition_kd: 40 },
      { value: "운전면허 필기시험 접수", weight: 9, monthly_search_volume: 7600, competition_kd: 38 },
      { value: "운전면허 필기시험 팁", weight: 8, monthly_search_volume: 7200, competition_kd: 36 },
      { value: "운전면허 필기시험 어플", weight: 7, monthly_search_volume: 6200, competition_kd: 34 },
      { value: "운전면허시험장", weight: 8, monthly_search_volume: 6800, competition_kd: 42 },
      { value: "운전면허 준비물", weight: 7, monthly_search_volume: 5200, competition_kd: 35 },
      { value: "운전면허 기능시험", weight: 7, monthly_search_volume: 5800, competition_kd: 37 },
      { value: "운전면허 도로주행", weight: 7, monthly_search_volume: 5600, competition_kd: 37 },
      { value: "장롱면허 운전연수", weight: 6, monthly_search_volume: 4800, competition_kd: 39 }
    ],
    intent: ["비교추천", "근처학원", "비용확인", "수강료비교", "셔틀확인", "주말반", "야간반", "필기접수", "기능시험", "도로주행", "준비물", "단기합격"].map((value, i) => ({ value, weight: i < 5 ? 5 : i < 10 ? 4 : 3 })),
    persona: [
      { value: "처음 면허 따는 대학생", weight: 5 },
      { value: "퇴근 후 배우는 직장인", weight: 5 },
      { value: "방학 중 단기 취득", weight: 5 },
      { value: "2종에서 1종 전환", weight: 4 },
      { value: "장롱면허 재도전", weight: 4 },
      { value: "자녀 면허를 알아보는 보호자", weight: 4 },
      { value: "수능 후 면허 준비", weight: 5 },
      { value: "취업 전 면허 취득", weight: 5 },
      { value: "군 입대 전 면허 취득", weight: 4 },
      { value: "복학 전 면허 준비", weight: 4 },
      { value: "대학생 방학 특강 찾는 학생", weight: 4 },
      { value: "주말만 가능한 직장인", weight: 5 },
      { value: "야간반을 찾는 직장인", weight: 5 },
      { value: "교대근무 직장인", weight: 3 },
      { value: "자영업자 시간 맞춤 수강", weight: 3 },
      { value: "운전이 처음인 초보자", weight: 5 },
      { value: "운전에 자신감이 없는 초보자", weight: 5 },
      { value: "시험이 걱정되는 수험생", weight: 4 },
      { value: "기능시험 재응시 준비", weight: 4 },
      { value: "도로주행 재응시 준비", weight: 4 },
      { value: "1종 보통 취득 희망자", weight: 5 },
      { value: "2종 보통 취득 희망자", weight: 5 },
      { value: "1종 대형 취득 희망자", weight: 4 },
      { value: "2종 소형 취득 희망자", weight: 3 },
      { value: "집 가까운 학원을 찾는 수강생", weight: 5 },
      { value: "회사 근처 학원을 찾는 직장인", weight: 4 },
      { value: "셔틀버스 이용 희망자", weight: 4 },
      { value: "자체시험 가능한 학원을 찾는 수강생", weight: 5 },
      { value: "빠른 시험 일정이 필요한 수강생", weight: 5 },
      { value: "친절한 강사를 찾는 초보자", weight: 4 },
      { value: "외국인 운전면허 취득 준비", weight: 2 },
      { value: "결혼 전 면허를 준비하는 예비부부", weight: 2 },
      { value: "가성비 좋은 학원을 찾는 수강생", weight: 4 },
      { value: "운전면허학원 비교 중인 수강생", weight: 5 },
      { value: "운전전문학원 추천을 찾는 사용자", weight: 5 },
      { value: "운전면허 비용을 비교하는 사용자", weight: 5 },
      { value: "학원 후기 확인 중인 사용자", weight: 4 },
      { value: "시험 일정이 궁금한 사용자", weight: 4 },
      { value: "등록 절차를 알아보는 사용자", weight: 4 },
      { value: "재수생 방학 면허 준비", weight: 4 },
      { value: "편입 전 면허 취득", weight: 3 },
      { value: "유학 출국 전 면허 준비", weight: 3 },
      { value: "취업 준비생", weight: 5 },
      { value: "첫 출근 전 면허 준비", weight: 4 },
      { value: "회사 입사 예정자", weight: 4 },
      { value: "이직 준비 중인 직장인", weight: 3 },
      { value: "운전이 필요한 신입사원", weight: 4 },
      { value: "출퇴근을 위해 면허가 필요한 직장인", weight: 5 },
      { value: "출장이 많은 직장인", weight: 3 },
      { value: "아이 등하교를 준비하는 부모", weight: 4 },
      { value: "출산을 앞둔 예비 부모", weight: 3 },
      { value: "육아를 위해 운전이 필요한 부모", weight: 4 },
      { value: "가족 차량 운전을 준비하는 초보자", weight: 4 },
      { value: "부모님 차량을 운전하려는 자녀", weight: 3 },
      { value: "기능시험이 어려운 수험생", weight: 5 },
      { value: "도로주행이 두려운 수험생", weight: 5 },
      { value: "주차가 어려운 초보자", weight: 5 },
      { value: "경사로가 어려운 수험생", weight: 3 },
      { value: "T자 주차가 어려운 초보자", weight: 3 },
      { value: "평행주차를 배우고 싶은 초보자", weight: 3 },
      { value: "비 오는 날 운전이 걱정되는 초보자", weight: 2 },
      { value: "야간운전이 걱정되는 초보자", weight: 2 },
      { value: "시험장과 가까운 학원을 찾는 수강생", weight: 4 },
      { value: "집 근처 셔틀이 있는 학원을 찾는 수강생", weight: 4 },
      { value: "자체시험 가능한 운전전문학원을 찾는 수강생", weight: 5 },
      { value: "실제 시험 코스로 연습하고 싶은 수강생", weight: 5 },
      { value: "연습을 많이 할 수 있는 학원을 찾는 수강생", weight: 4 },
      { value: "빠른 등록이 가능한 학원을 찾는 수강생", weight: 3 },
      { value: "오늘 상담 가능한 학원을 찾는 사용자", weight: 2 },
      { value: "친구와 함께 등록하려는 대학생", weight: 3 },
      { value: "커플이 함께 면허를 준비하는 수강생", weight: 2 },
      { value: "형제자매와 함께 등록하는 수강생", weight: 2 },
      { value: "첫 차 구매 예정자", weight: 5 },
      { value: "중고차 구매 예정자", weight: 4 },
      { value: "신차 출고 예정자", weight: 3 },
      { value: "차량 계약 후 면허를 준비하는 사용자", weight: 3 },
    ],
    modifier: ["근처", "가까운", "비용절약", "셔틀편리", "주말반", "야간반", "필기부터", "도로주행", "상담전확인"].map((value, i) => ({ value, weight: i < 4 ? 5 : 4 }))
  },
  general: {
    region: [], keyword: [], intent: [{ value: "비교추천", weight: 5 }, { value: "가이드총정리", weight: 5 }], persona: [{ value: "일반", weight: 5 }], modifier: []
  }
};

export const VERTICAL_TO_PRESET: Record<string, string> = {
  driving: "driving",
  general: "general"
};
