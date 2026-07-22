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
// 여기 남는 4줄은 프롬프트의 다른 어느 층에도 없는 것만 고른 결과다(중복 제거 기준).
// 독자 중심·데이터 활용·선택 기준·흐름 연결·다음 행동은 절대 원칙(위)·아키타입 writing_guide·
// buildPrompt 「필수 출력 구조」가, 동일 문장 반복은 그 지침과 repeatedSentenceIssues 게이트가
// 이미 강제한다. 여길 그 재서술로 채우면 신호만 희석되므로 톤·태도 지시만 둔다.
// 4번째 줄(섹션 간 정보 일치)만 예외로 남긴다 — 이건 평소 프롬프트에 없고(repair 프롬프트에만 있다)
// 섹션끼리 대조하는 게이트도 없어서, 여기서 빼면 지시가 아예 사라진다.
// 주의: '같은 내용을 반복하지 말라'로 확장하지 말 것. 비교표와 학원별 기본 정보처럼 역할이 다른
// 섹션에 유사한 정보가 함께 나오는 것은 정상이며, 금지하면 오히려 글이 얇아진다.
export const DEFAULT_DRIVING_COMMON_PRINCIPLES = [
  "운전면허를 처음 준비하는 독자도 이해할 수 있는 쉬운 표현을 쓰되, 가볍거나 단정적인 말투 대신 신뢰감 있는 전문가의 설명 톤을 유지한다.",
  "광고성·낚시성 문구와 근거 없는 과장 표현을 쓰지 않고, 독자가 비교·상담·예약을 판단하는 데 필요한 실질 정보를 우선한다.",
  "경쟁 브랜드나 특정 학원을 비방하지 않으며, 확인된 정보 안에서 장점과 고려할 점을 균형 있게 설명한다.",
  "비교표·본문·체크리스트·FAQ·결론에 나오는 학원명, 지역, 면허 종류, 비용 기준 같은 정보가 서로 어긋나지 않게 한다."
].join("\n");

// buildPrompt(worker.service)에 주입되는 「절대 원칙」 — 유형 무관 보편 안전·무결성 규칙(단일 소스, 항상 주입).
// 방향성 검증(templates/validate-direction)이 이 원문과 대조해 중복을 잡는다. 여기와 buildPrompt가 항상 같아야 한다.
export const DRIVING_ABSOLUTE_PRINCIPLES = `- 확인된 콘텐츠 재료에 없는 학원명·사진·주소·전화번호·가격·셔틀·합격률·3일 합격·당일 합격·합격 보장·지역화폐·후기는 절대 생성하지 말 것.
- 출처번호 [1], [2]를 본문에 노출하지 말 것. 근거는 문장 안에 자연스럽게 녹인다.
- 내부 API URL이나 get-all-academy 주소는 내부 데이터 경로이므로 참고자료/출처 섹션에 절대 쓰지 말 것.
- 도로교통공단 등 외부 공신력 출처는 본문 문장 안에 인라인 링크로만 인용하고, 별도 참고자료/출처 섹션은 만들지 않는다(렌더 시 제거된다).
- Markdown 굵게 표시는 원본 블로그처럼 핵심 학원명·비용·셔틀·준비물·주의점에만 적당히 사용한다. 문장 전체를 굵게 만들지는 않는다.`;

// 학원 후보를 다루는 유형(academy_types 있는 유형)에만 추가 주입하는 학원-후보 규칙.
// 비학원형(필기·가이드 등)엔 후보가 없어 무의미하므로 주입하지 않는다.
export const DRIVING_ACADEMY_PRINCIPLES = `- API 자료는 글 재료일 뿐이다. 주 키워드/지역/제목과 직접 맞는 학원만 본문 후보·표·사진·CTA에 사용한다.
- 소개 가능한 후보가 1곳 이상이면 실제 후보명을 본문과 표에 반드시 최소 1개 이상 포함한다. 후보명이 빠진 글은 일반론이라 실패다.
- 주소가 주제 지역과 일치하는 후보를 먼저 소개한다. 주소가 다르지만 "지역 중심 기준 거리"가 있는 후보는 해당 지역 안의 학원이 아니라 "인근/주변 후보"로 분리해 설명한다.
- 다른 시·군·구 후보를 주제 지역 내부 학원처럼 쓰지 말 것. 후보가 부족하면 부족한 그대로 설명한다.
- 제공된 후보 수보다 큰 숫자를 제목/본문에 쓰지 말 것. 예: 후보가 2곳이면 '3곳', 'BEST5' 금지.`;

// EEAT 공신력 출처(운전면허 도메인) — 공개 글에 인용 가능한 '검증된 실제 URL' 화이트리스트.
// 도로교통공단 공식 사이트 2곳(2026-07 공식 확인). 절대원칙(URL 날조 금지)과 정합: LLM 은 아래 정확한 URL만,
// 공식 제도·절차 맥락에서만, 본문 안 인라인 링크로 인용한다(학원·후기·가격 같은 개별 사실 근거로는 쓰지 않는다).
export const DRIVING_AUTHORITATIVE_SOURCES = [
  { name: "도로교통공단 안전운전 통합민원", url: "https://www.safedriving.or.kr", use: "운전면허 시험 접수·응시·발급·교통안전교육 등 공식 절차" },
  { name: "한국도로교통공단", url: "https://www.koroad.or.kr", use: "교통안전·운전면허 제도 일반" },
] as const;

// 프롬프트 주입용 지침 블록(선택적 EEAT 링크). 하드 게이트가 아니라 '유도'다 — 억지로 넣지 않는다.
export const DRIVING_AUTHORITATIVE_SOURCES_GUIDE = [
  "신뢰도(EEAT)를 위해 시험 절차·법규·비용 기준처럼 공식 근거가 필요한 대목에서만, 아래 공신력 출처를 본문 문장 안에 자연스러운 Markdown 링크로 인용할 수 있다(선택 — 관련 없으면 넣지 않는다):",
  ...DRIVING_AUTHORITATIVE_SOURCES.map((s) => `- [${s.name}](${s.url}) — ${s.use}`),
  "- URL 은 위 목록에 있는 것만 글자 그대로 쓴다. 경로/서브도메인을 덧붙이거나 다른 기관 URL 을 지어내지 않는다.",
  "- 학원명·주소·가격·셔틀·합격률·후기 같은 개별 사실의 근거로는 쓰지 않는다(그건 확인된 콘텐츠 재료만). 공식 제도·절차 맥락에서만 쓴다.",
  "- 별도 '참고자료/출처' 섹션은 만들지 말고 본문 문장 안에 인라인으로 건다(트레일링 출처 목록은 렌더 시 제거된다).",
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
// 새 도메인은 글유형이 아무것도 켜지지 않은 빈 상태로 시작한다(운영자가 「글유형/디자인」 탭에서 직접 켠다).
export const DEFAULT_DRIVING_TEMPLATE_IDS: readonly string[] = [];

// 전역 빌트인 노출 기본값(검증용 임시): 노출 설정이 없을 때 카탈로그/시작점/아키타입에 보일 빌트인.
// 검증된 T01 만 기본 노출하고, 나머지는 「설정」 탭에서 검증 후 하나씩 연다.
export const DEFAULT_EXPOSED_BUILTIN_TEMPLATE_IDS: readonly string[] = ["T01"];

// 학원 인근 보강 최대 반경(km). 직접(지역 문자열) 매칭이 부족할 때 이 반경 내 학원만 '인근 후보'로 채운다.
// 생성(worker.pickAcademiesForRegion)과 정합성 미리보기(slot.analyzeCoherence/academyCoverage)가 공유한다.
export const ACADEMY_NEARBY_MAX_KM = Number(process.env.SEO_ACADEMY_NEARBY_MAX_KM) || 20;

// 글유형(템플릿) 1개당 후보 슬롯 생성 상한. 축 조합(지역×키워드×페르소나×의도×수식어)이
// 수백만까지 폭발할 수 있어, 이 값으로 상한을 걸어 메모리 폭주/삽입 지연으로 인한 500 을 막는다.
// (조합이 이보다 적으면 있는 만큼만 생성 — 중복으로 채우지 않는다.)
export const MAX_SLOTS_PER_TEMPLATE = Number(process.env.SEO_MAX_SLOTS_PER_TEMPLATE) || 10000;

// 학원 후보 풀 크기(직접+인근 합). 인근은 이 개수를 채우는 만큼만 가까운 순으로 가져온다.
// 생성·미리보기 공통. 밀집 지역이 반경 안 학원을 과다 표시/사용하지 않도록 캡 역할.
export const ACADEMY_MAX_CANDIDATES = Number(process.env.SEO_ACADEMY_MAX_CANDIDATES) || 7;
// 한 글에 실제로 쓰는 학원 수. 풀(ACADEMY_MAX_CANDIDATES)에서 슬롯별 시드 랜덤으로 이만큼 뽑아 글마다 조합을 달리한다.
export const ACADEMY_USED_PER_POST = Number(process.env.SEO_ACADEMY_USED_PER_POST) || 5;
// 지역이 '충분'하다고 보는 최소 학원 수(비교/BEST 성립 기준).
export const ACADEMY_MIN_FOR_BEST = 2;
// 최소 보장 확장 상한(km). 직접+인근(ACADEMY_NEARBY_MAX_KM)이 ACADEMY_MIN_FOR_BEST 미만이면
// 반경 밖이라도 '가장 가까운 순'으로 이 거리 안에서 최소 개수까지 채운다(전국 아무거나 방지). 그 안에도 없으면 부족한 대로 둠.
export const ACADEMY_MIN_GUARANTEE_MAX_KM = Number(process.env.SEO_ACADEMY_MIN_GUARANTEE_MAX_KM) || 50;

// 제목 규칙: 생성 시점에 '실제 후보 수(academies.length)'로 해석해 제목을 확정한다(LLM 즉흥 방지).
//  min_generate: 실제 후보 수가 이 값 미만이면 생성하지 않는다(부족 지역 차단).
//  tiers: min_count 내림차순으로 첫 매칭 template 사용. fallback: 어떤 tier도 안 맞을 때.
//  플레이스홀더: {지역} {개수}(=직접+인근 합) {키워드} {학원명}(첫 후보).
export type TitleRule = { min_generate?: number; tiers: { min_count: number; template: string }[]; fallback?: string };

// 빌트인 글유형 제목 규칙. 커스텀 글유형은 spec.title_rule(DB)을 쓰고, 빌트인은 이 맵을 폴백으로 쓴다.
// 규칙 없는 유형(가이드·시험 등)은 기존대로 LLM 이 H1 을 정한다(하위호환).
export const TITLE_RULES: Record<string, TitleRule> = {
  T01: { min_generate: 2, tiers: [{ min_count: 3, template: "{지역} 운전면허학원 BEST {개수}" }, { min_count: 2, template: "{지역} 추천 운전면허학원" }] },
  T14: { min_generate: 1, tiers: [{ min_count: 1, template: "{지역} {학원명}" }] },
  T11: { min_generate: 1, tiers: [{ min_count: 1, template: "{지역} 운전면허시험장" }] },
};

// default_design: 도메인 디자인이 auto일 때 이 유형의 글에 적용할 기본 디자인(docs/design-template-mapping.md).
// default_direction: 이 글유형의 기본 방향성(공통원칙 위에 얹히는 오버레이). 도메인 template_overrides 로 재정의 가능.
// axis_tags: 이 글유형이 수용하는 축 값 태그(axis-tags.ts). 미지정 축은 전체 허용(["*"]). region/keyword 는 정규식 경로라 제외.
export const TEMPLATE_SPECS = {
  T01: { name: "지역 운전학원 BEST 비교", primary: ["region"], use_persona: true, modifier_count: 2, weight: 1.15, min_sv: 0, kind: "local", default_design: "comparison", default_direction: "지역 내 후보와 인근 후보를 구분해 독자가 실제 이동·상담 가능성을 기준으로 비교하도록 돕는다. 여러 후보가 있으면 위치·면허 과정·상담 확인 항목을 나란히 정리하고, 후보가 적으면 해당 후보를 깊게 설명한 뒤 비용·시간표·셔틀·면허 종류 확인으로 자연스럽게 전환한다.", axis_tags: { persona: ["*"], modifier: ["*"] }, axis_values: { persona: ["가성비 좋은 학원을 찾는 수강생", "가족 차량 운전을 준비하는 초보자", "결혼 전 면허를 준비하는 예비부부", "교대근무 직장인", "군 입대 전 면허 취득", "대학생 방학 특강 찾는 학생", "방학 중 단기 취득", "복학 전 면허 준비", "부모님 차량을 운전하려는 자녀", "빠른 등록이 가능한 학원을 찾는 수강생", "빠른 시험 일정이 필요한 수강생", "셔틀버스 이용 희망자", "수능 후 면허 준비", "시험장과 가까운 학원을 찾는 수강생", "신차 출고 예정자", "실제 시험 코스로 연습하고 싶은 수강생", "아이 등하교를 준비하는 부모", "야간반을 찾는 직장인", "연습을 많이 할 수 있는 학원을 찾는 수강생", "오늘 상담 가능한 학원을 찾는 사용자", "외국인 운전면허 취득 준비", "운전면허 비용을 비교하는 사용자", "운전면허학원 비교 중인 수강생", "운전이 처음인 초보자", "운전이 필요한 신입사원", "운전전문학원 추천을 찾는 사용자", "유학 출국 전 면허 준비", "육아를 위해 운전이 필요한 부모", "이직 준비 중인 직장인", "자녀 면허를 알아보는 보호자", "자영업자 시간 맞춤 수강", "자체시험 가능한 운전전문학원을 찾는 수강생", "자체시험 가능한 학원을 찾는 수강생", "장롱면허 재도전", "재수생 방학 면허 준비", "주말만 가능한 직장인", "중고차 구매 예정자", "집 가까운 학원을 찾는 수강생", "집 근처 셔틀이 있는 학원을 찾는 수강생", "차량 계약 후 면허를 준비하는 사용자", "처음 면허 따는 대학생", "첫 차 구매 예정자", "첫 출근 전 면허 준비", "출산을 앞둔 예비 부모", "출장이 많은 직장인", "출퇴근을 위해 면허가 필요한 직장인", "취업 전 면허 취득", "취업 준비생", "친구와 함께 등록하려는 대학생", "친절한 강사를 찾는 초보자", "커플이 함께 면허를 준비하는 수강생", "퇴근 후 배우는 직장인", "편입 전 면허 취득", "학원 후기 확인 중인 사용자", "형제자매와 함께 등록하는 수강생", "회사 근처 학원을 찾는 직장인", "회사 입사 예정자"], modifier: ["가까운", "근처", "비용절약", "상담전확인", "셔틀편리", "야간반", "주말반"] }, academy_types: ["exam_academy", "academy"], keyword_filter: ["운전면허학원", "자동차운전전문학원", "자동차학원"] },
  T03: { name: "운전면허 가이드 총정리", primary: ["keyword"], use_persona: true, modifier_count: 1, weight: 0.95, min_sv: 0, kind: "guide", default_design: "editorial", default_direction: "운전면허 절차와 개념을 초보자도 이해하도록 총정리형으로 풀고, 단계별 확인 포인트를 제공한다.", axis_tags: { persona: ["*"], modifier: ["*"] }, axis_values: { persona: ["운전이 처음인 초보자", "처음 면허 따는 대학생", "출퇴근을 위해 면허가 필요한 직장인", "장롱면허 재도전", "육아를 위해 운전이 필요한 부모", "시험 일정이 궁금한 사용자"], modifier: ["비용절약", "필기시험부터", "상담전확인", "주말반"] }, keyword_filter: ["운전면허", "운전면허 합격", "운전면허 비용", "운전면허 준비물", "1종보통", "2종보통"] },
  T04: { name: "면허 종류/옵션 비교", primary: ["keyword"], use_persona: true, modifier_count: 0, weight: 0.75, min_sv: 0, kind: "compare", default_design: "comparison", default_direction: "면허 종류·옵션의 차이와 선택 기준을 비교해, 독자가 자기 상황에 맞는 종류를 고르게 돕는다.", axis_tags: { persona: ["license", "timing", "common"] }, axis_values: { persona: ["1종 보통 취득 희망자", "2종 보통 취득 희망자", "1종 대형 취득 희망자", "2종에서 1종 전환", "2종 소형 취득 희망자", "가족 차량 운전을 준비하는 초보자"] }, keyword_filter: ["1종보통", "2종보통"] },
  T05: { name: "비용 및 시간 절약 전략", primary: ["keyword"], use_persona: true, modifier_count: 1, weight: 1.0, min_sv: 0, kind: "compare", default_design: "comparison", default_direction: "비용·시간을 아끼는 전략을 확인 가능한 기준으로 제시하되, 구체 금액은 자료가 있을 때만 쓴다.", axis_tags: { persona: ["cost", "select", "schedule", "timing", "common"], modifier: ["cost", "select", "schedule", "common"] }, axis_values: { persona: ["가성비 좋은 학원을 찾는 수강생", "운전면허 비용을 비교하는 사용자", "빠른 시험 일정이 필요한 수강생", "주말만 가능한 직장인", "퇴근 후 배우는 직장인", "방학 중 단기 취득"], modifier: ["비용절약", "상담전확인", "셔틀편리", "주말반"] }, keyword_filter: ["운전면허 비용", "운전면허 수강료"] },
  T06: { name: "시험 단계 집중 BEST", primary: ["keyword"], use_persona: false, modifier_count: 0, weight: 0.9, min_sv: 0, with_intent: true, kind: "exam", default_design: "comparison", default_direction: "필기·기능·도로주행 등 시험 단계별 핵심을 집중적으로 정리하고, 준비 순서를 제시한다.", axis_tags: { intent: ["exam", "common"] }, axis_values: { intent: ["기능시험", "도로주행", "필기접수", "준비물"] }, keyword_filter: ["운전면허 필기시험", "운전면허 기능시험", "운전면허 도로주행"] },
  T07: { name: "지역 허브 총정리", primary: ["region"], use_persona: false, modifier_count: 0, weight: 1.25, min_sv: 0, with_intent: true, kind: "local_hub", default_design: "local-guide", default_direction: "지역 단위로 학원·시험장·생활권 정보를 허브형으로 총정리해 지역 검색 의도를 폭넓게 충족한다.", axis_tags: { intent: ["select", "location", "common"] }, axis_values: { intent: ["근처학원", "비교추천", "비용확인", "셔틀확인", "준비물"] }, academy_types: ["exam_academy", "academy"], keyword_filter: ["운전면허학원", "운전면허", "운전면허시험장"] },
  T08: { name: "운전면허 필기시험 접수", primary: ["keyword"], use_persona: false, modifier_count: 0, weight: 1.08, min_sv: 0, with_intent: true, kind: "exam", default_design: "checklist", default_direction: "필기시험 접수 절차·준비물·일정 확인 방법을 단계별 체크리스트로 안내한다.", axis_tags: { intent: ["written", "common"] }, axis_values: { intent: ["필기접수", "준비물", "비용확인"] }, keyword_filter: ["운전면허 필기시험 접수"] },
  T09: { name: "운전면허 필기시험 팁", primary: ["keyword"], use_persona: true, modifier_count: 1, weight: 1.0, min_sv: 0, kind: "exam", default_design: "checklist", default_direction: "필기시험 공부·합격 팁을 실전 위주로 정리하고, 준비 순서와 자주 틀리는 포인트를 제공한다.", axis_tags: { persona: ["written", "timing", "common"], modifier: ["written", "common"] }, axis_values: { persona: ["처음 면허 따는 대학생", "취업 준비생", "운전이 처음인 초보자", "시험이 걱정되는 수험생", "재수생 방학 면허 준비"], modifier: ["필기시험부터", "비용절약", "상담전확인"] }, keyword_filter: ["운전면허 필기시험 팁"] },
  T10: { name: "운전면허 필기시험 앱 추천", primary: ["keyword"], use_persona: true, modifier_count: 0, weight: 0.9, min_sv: 0, kind: "exam", default_design: "comparison", default_direction: "필기시험 학습 앱·도구의 선택 기준과 활용법을 비교 관점으로 정리한다.", axis_tags: { persona: ["written", "timing", "common"] }, axis_values: { persona: ["처음 면허 따는 대학생", "취업 준비생", "운전이 처음인 초보자", "시험이 걱정되는 수험생"] }, keyword_filter: ["운전면허 필기시험 어플"] },
  T11: { name: "지역 운전면허시험장 소개", primary: ["region"], use_persona: false, modifier_count: 0, weight: 1.0, min_sv: 0, with_intent: true, kind: "local_single", default_design: "local-guide", default_direction: "지역 운전면허시험장의 위치·동선·준비물·확인 포인트를 안내한다.", axis_tags: { intent: ["location", "select", "common"] }, axis_values: { intent: ["준비물", "비교추천", "비용확인", "근처학원"] }, academy_types: ["license_test_course", "license_center"], keyword_filter: ["운전면허시험장"] },
  T12: { name: "운전면허 취득 총정리", primary: ["keyword"], use_persona: true, modifier_count: 1, weight: 1.0, min_sv: 0, kind: "guide", default_design: "editorial", default_direction: "면허 취득 전 과정을 처음부터 끝까지 총정리하고, 단계별 준비물과 확인 사항을 제공한다.", axis_tags: { persona: ["license", "select", "timing", "common"], modifier: ["select", "common"] }, axis_values: { persona: ["운전이 처음인 초보자", "처음 면허 따는 대학생", "취업 전 면허 취득", "군 입대 전 면허 취득", "방학 중 단기 취득", "출퇴근을 위해 면허가 필요한 직장인", "등록 절차를 알아보는 사용자"], modifier: ["필기시험부터", "비용절약", "주말반"] }, keyword_filter: ["운전면허", "운전면허 합격", "운전면허 준비물", "1종보통", "2종보통"] },
  T13: { name: "타겟별 운전면허 준비", primary: ["keyword"], use_persona: true, modifier_count: 1, weight: 0.9, min_sv: 0, kind: "guide", default_design: "editorial", default_direction: "대상(페르소나)별 상황에 맞춰 면허 준비 방법과 확인 포인트를 제안한다.", axis_tags: { persona: ["*"], modifier: ["*"] }, axis_values: { persona: ["교대근무 직장인", "주말만 가능한 직장인", "대학생 방학 특강 찾는 학생", "육아를 위해 운전이 필요한 부모", "장롱면허 재도전", "외국인 운전면허 취득 준비", "취업 준비생", "자영업자 시간 맞춤 수강", "T자 주차가 어려운 초보자", "경사로가 어려운 수험생", "기능시험 재응시 준비", "기능시험이 어려운 수험생", "도로주행 재응시 준비", "도로주행이 두려운 수험생", "주차가 어려운 초보자", "평행주차를 배우고 싶은 초보자", "야간운전이 걱정되는 초보자", "비 오는 날 운전이 걱정되는 초보자", "운전에 자신감이 없는 초보자"], modifier: ["야간반", "주말반", "비용절약", "셔틀편리"] }, keyword_filter: ["운전면허", "운전면허 합격", "운전면허 준비물", "장롱면허 운전연수"] },
  T14: { name: "전문학원 단독 소개", primary: ["region"], use_persona: true, modifier_count: 0, weight: 0.98, min_sv: 0, kind: "local_single", default_design: "conversion", default_direction: "특정 전문학원을 단독으로 소개하되 확인된 자료만 사용하고, 상담·비용·셔틀 확인으로 전환을 연결한다.", axis_tags: { persona: ["*"] }, axis_values: { persona: ["가성비 좋은 학원을 찾는 수강생", "집 근처 학원을 찾는 수강생", "셔틀버스 이용 희망자", "자체시험 가능한 운전전문학원을 찾는 수강생", "오늘 상담 가능한 학원을 찾는 사용자", "학원 후기 확인 중인 사용자", "시험장과 가까운 학원을 찾는 수강생"] }, academy_types: ["exam_academy"], keyword_filter: ["자동차운전전문학원", "운전면허학원", "자동차학원"] },
  T15: { name: "지역+시험단계 혼합", primary: ["region"], use_persona: true, modifier_count: 1, weight: 0.95, min_sv: 0, with_intent: true, kind: "local_hub", default_design: "local-guide", default_direction: "지역과 시험 단계를 함께 엮어 지역 학원·시험 준비 정보를 제공한다.", axis_tags: { persona: ["select", "practice", "timing", "common"], intent: ["exam", "select", "common"], modifier: ["select", "practice", "common"] }, axis_values: { persona: ["운전면허학원 비교 중인 수강생", "처음 면허 따는 대학생", "시험이 걱정되는 수험생", "집 근처 학원을 찾는 수강생", "주말만 가능한 직장인"], intent: ["기능시험", "도로주행", "근처학원", "준비물"], modifier: ["가까운", "셔틀편리", "필기시험부터", "도로주행"] }, academy_types: ["exam_academy", "academy"], keyword_filter: ["운전면허 필기시험", "운전면허 기능시험", "운전면허 도로주행", "운전면허학원"] }
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
  // 글유형별 keyword 필터. (a) 이후 '권위': 값이 있으면 아키타입 keyword_rule 패턴을 무시하고 이 키워드를 직접 사용,
  // 비면 아키타입 패턴 폴백(기존 동작 = 골든 0-diff). primary_override 와 함께 유형별 키워드/지역 자유 통제.
  keyword_filter?: string[];
  // 주축(region|keyword) 유형별 재정의. 미지정이면 아키타입 primary. keyword_filter 가 있는 free 모드에서만 효과.
  // region: 지역 × keyword_filter 조합("지역 키워드"), keyword: keyword_filter 각각을 주키워드로.
  primary_override?: "region" | "keyword";
  default_direction?: string;
  default_design?: string;
  // 커스텀 유형이 어떤 빌트인/커스텀에서 복제됐는지의 최상위 원본. 생성 정책을
  // 계보 단위로 적용할 때만 사용하며, 본문 프롬프트에는 노출하지 않는다.
  origin_template_id?: string;
  // 제목 규칙(생성 시점 해석). 빌트인은 TITLE_RULES 맵 폴백, 커스텀은 이 값(DB). 없으면 LLM 이 H1 결정.
  title_rule?: TitleRule;
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
    // persona/intent/modifier 는 글유형 axis_values 단일 소스로 이관(도메인 축 폴백 제거, fcd887c).
    // 도메인 프리셋은 region/keyword 만 시드한다 — 세 축은 빈 배열(applyPreset 이 skip).
    intent: [],
    persona: [],
    modifier: [],
  },
  general: {
    region: [], keyword: [], intent: [{ value: "비교추천", weight: 5 }, { value: "가이드총정리", weight: 5 }], persona: [{ value: "일반", weight: 5 }], modifier: []
  }
};

export const VERTICAL_TO_PRESET: Record<string, string> = {
  driving: "driving",
  general: "general"
};
