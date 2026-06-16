export type AxisName = "region" | "keyword" | "intent" | "persona" | "modifier";
export type ProviderName = "claude" | "codex";
export type JobKind = "generate" | "dedup" | "indexing" | "prune";

export const AXES: AxisName[] = ["region", "keyword", "intent", "persona", "modifier"];
export const DRIVING_VERTICALS = ["driving"] as const;
export const DEFAULT_DRIVING_VERTICAL = "driving";
export const DEFAULT_DRIVING_DESIGN_TEMPLATE = "local-guide";
export const DEFAULT_DRIVING_BRAND_COLOR = "#2563eb";
export const DEFAULT_DRIVING_CONTENT_BRIEF = [
  "운전면허·운전학원 비교 콘텐츠를 회사 도메인 기준으로 발행한다.",
  "지역명, 학원명, 주소, 전화, 사진, 리뷰처럼 확인된 데이터만 사용하고 가격·합격률·셔틀은 데이터가 있을 때만 단정한다.",
  "후보가 부족한 지역은 억지 BEST 숫자를 만들지 말고 직접 확인 가능한 후보와 상담 체크리스트 중심으로 정직하게 작성한다.",
  "주요 전환은 상담 문의, 비용 확인, 셔틀/시간표 확인, 면허 종류별 수강 가능 여부 확인으로 연결한다."
].join("\n");

export const DRIVING_ORIGINAL_TEMPLATE_IDS = [
  "T01", "T03", "T04", "T05", "T06", "T07",
  "T08", "T09", "T10", "T11", "T12", "T13", "T14", "T15"
] as const;

export const TEMPLATE_SPECS = {
  T01: { name: "지역 운전학원 BEST 비교", primary: ["region"], use_persona: true, modifier_count: 2, weight: 1.15, min_sv: 0, kind: "local_best" },
  T03: { name: "운전면허 가이드 총정리", primary: ["keyword"], use_persona: true, modifier_count: 1, weight: 0.95, min_sv: 0, kind: "general_guide" },
  T04: { name: "면허 종류/옵션 비교", primary: ["keyword"], use_persona: true, modifier_count: 0, weight: 0.75, min_sv: 0, kind: "license_compare" },
  T05: { name: "비용 및 시간 절약 전략", primary: ["keyword"], use_persona: true, modifier_count: 1, weight: 1.0, min_sv: 0, kind: "cost_strategy" },
  T06: { name: "시험 단계 집중 BEST", primary: ["keyword"], use_persona: false, modifier_count: 0, weight: 0.9, min_sv: 0, with_intent: true, kind: "exam_best" },
  T07: { name: "지역 허브 총정리", primary: ["region"], use_persona: false, modifier_count: 0, weight: 1.25, min_sv: 0, with_intent: true, kind: "regional_hub" },
  T08: { name: "운전면허 필기시험 접수", primary: ["keyword"], use_persona: false, modifier_count: 0, weight: 1.08, min_sv: 0, with_intent: true, kind: "written_registration" },
  T09: { name: "운전면허 필기시험 팁", primary: ["keyword"], use_persona: true, modifier_count: 1, weight: 1.0, min_sv: 0, kind: "written_tips" },
  T10: { name: "운전면허 필기시험 앱 추천", primary: ["keyword"], use_persona: true, modifier_count: 0, weight: 0.9, min_sv: 0, kind: "written_app" },
  T11: { name: "지역 운전면허시험장 소개", primary: ["region"], use_persona: false, modifier_count: 0, weight: 1.0, min_sv: 0, with_intent: true, kind: "test_center" },
  T12: { name: "운전면허 취득 총정리", primary: ["keyword"], use_persona: true, modifier_count: 1, weight: 1.0, min_sv: 0, kind: "license_complete" },
  T13: { name: "타겟별 운전면허 준비", primary: ["keyword"], use_persona: true, modifier_count: 1, weight: 0.9, min_sv: 0, kind: "persona_target" },
  T14: { name: "전문학원 단독 소개", primary: ["region"], use_persona: true, modifier_count: 0, weight: 0.98, min_sv: 0, kind: "academy_profile" },
  T15: { name: "지역+시험단계 혼합", primary: ["region"], use_persona: true, modifier_count: 1, weight: 0.95, min_sv: 0, with_intent: true, kind: "local_exam_mix" }
} as const;

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
    persona: ["처음 면허 따는 대학생", "퇴근 후 배우는 직장인", "방학 중 단기 취득", "2종에서 1종 전환", "장롱면허 재도전", "자녀 면허를 알아보는 보호자"].map((value, i) => ({ value, weight: i < 3 ? 5 : 4 })),
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
