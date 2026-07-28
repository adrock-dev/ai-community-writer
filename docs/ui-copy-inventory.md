# 관리자 UI 안내멘트 인벤토리

> **생성물이다. 직접 고치지 마라.** `node scripts/copy-inventory.mjs` 로 다시 만든다.
> 분류·종속 대상은 `scripts/ui-copy-classification.json` 에서 사람이 지정한다.

안내멘트는 대부분 "코드가 강제하는 사실"의 사본이다. 사본은 원본이 바뀌면 썩는다.
이 목록은 **코드를 고칠 때 같이 고쳐야 할 문장**을 찾기 위한 역참조표다.

## 분류

| 급 | 뜻 | 처방 | 건수 |
| --- | --- | --- | --- |
| **A** | 파생 가능 — 코드 상수/설정에서 계산할 수 있는데 손으로 적은 수치·목록 | 재서술을 없애고 값에서 렌더한다 | 11 |
| **B** | 동작 계약 — 코드가 강제하는 규칙의 서술 | 원본을 고치면 반드시 같이 고친다 | 56 |
| **C** | 순수 안내 — 흐름·톤·빈 상태 문구 | 기계 검증 대상 아님 | 175 |
| | | **합계** | **242** |

파일별: `components/DomainClient.tsx` 193 · `components/AcademyResearchClient.tsx` 12 · `components/DashboardClient.tsx` 10 · `components/SettingsClient.tsx` 10 · `components/DraftsClient.tsx` 7 · `components/AcademyDetailClient.tsx` 4 · `components/IntegrationSettingsClient.tsx` 2 · `components/JobCard.tsx` 1 · `components/JobsClient.tsx` 1 · `components/NeedDomainClient.tsx` 1 · `components/PostDetailClient.tsx` 1

## 지금 이미 어긋난 것 (8건)

인벤토리를 만들면서 발견된, **코드와 다르거나 화면끼리 서로 모순인** 안내멘트다.

- `components/AcademyResearchClient.tsx:152` — 블로그리뷰를 동기화합니다. 한 곳씩 받아야 해 전체에 8~15분 걸립니다(백그라운드). 수집만 하며 글 생성에는 쓰이지 않습니다. 진행할까요?
  - 같은 작업의 소요시간을 화면마다 다르게 적었다 — 여기 8~15분 / DomainClient 「10분 이상」 2곳 / SettingsClient 「14분」. 어느 것도 코드에서 오지 않는다.
- `components/AcademyResearchClient.tsx:519` — 도메인 설정이 「검증완료만」이면 여기서 승인한 값만 글에 쓰입니다. 값을 고치거나 승인을 되돌리려면 학원 상세로 가세요. 상태를 검증완료로 두면 지금 글에 쓰이는 조사값을 그대로 볼 수 있습니다.
  - DomainClient 2234 는 「아직 연결 안 됨」이라고 하는데 여기는 이미 쓰이는 것처럼 단정한다.
- `components/DomainClient.tsx:368` — 모든 글에 공통 적용될 안전·데이터 원칙, 절대 넣지 말 제외어, 키워드 마스터를 정합니다. 지금 건너뛰고 나중에 정해도 됩니다.
  - 투어 문구만 정정에서 빠졌다. 바로 아래 입력칸 안내(652)는 「안전·데이터 규칙은 이미 게이트가 강제하므로 여기 다시 적지 마라」인데, 투어는 정반대로 「안전·데이터 원칙을 정하라」고 안내한다. 같은 화면 안에서 모순.
- `components/DomainClient.tsx:931` — 학원 커버리지 (총 {coh.academy.regions_total}개 지역): 충분 {coh.academy.regions_with_min_for_best} · 보장 {coh.academy.regions_guaran…
  - 같은 문장에서 보장 반경은 서버값(min_guarantee_km)을 렌더하는데 20km만 하드코딩이다. ACADEMY_NEARBY_MAX_KM 은 SEO_ACADEMY_NEARBY_MAX_KM 으로 덮이는 env 값이라, 환경변수를 바꾸면 화면이 즉시 거짓말을 한다. coh.academy.nearby_km 이 이미 API 로 내려온다.
- `components/DomainClient.tsx:1557` — 블로그 리뷰 수집: {blogSyncOn === null ? "확인 중" : blogSyncOn ? "켜짐" : "꺼짐"} {blogSyncOn === null ? "" : blogSyncOn ? " — 학원 동기화…
  - 「10분 이상」이라는 숫자가 다른 화면(8~15분·14분)과 어긋난다.
- `components/DomainClient.tsx:1618` — 각 지역의 학원 상세(사진·별점리뷰{blogSyncOn === true ? "·블로그 리뷰" : ""} 포함)를 가져옵니다. 지역 동기화 이후 실행을 권장하며, 위 지역 옵션은 여기에 영향을 주지 않습니다. {/* …
  - 여기도 「10분 이상」. 위와 같은 문제.
- `components/DomainClient.tsx:2148` — 조사값을 글에 전혀 쓰지 않습니다. 글은 원천 동기화로 받은 학원 자료(주소·전화·수강료·셔틀·영업시간·운영 과정·운영 형태·사진 등)와 자체 수강생 후기만 근거로 씁니다.
  - 세 단계 정책 자체가 아직 생성에 연결되지 않았다(같은 화면 2234가 그렇게 밝힘). 구현되는 순간 세 문장이 동시에 검증 대상이 된다.
- `components/SettingsClient.tsx:236` — 켜면 학원 동기화가 1~2분에서 14분으로 늘어납니다(원천이 동시 요청을 못 견뎌 한 곳씩 받습니다). 이미 수집된 자료는 끄더라도 지워지지 않고 학원 상세에 남습니다.
  - 위 8~15분·10분 이상과 불일치.

## A — 파생 가능 (11건)

코드 상수에서 계산할 수 있는데 손으로 적었다. **값에서 렌더하면 드리프트가 구조적으로 불가능해진다.**

| 위치 | 담체 | 안내멘트 | 종속 대상 |
| --- | --- | --- | --- |
| `components/AcademyResearchClient.tsx:121` | confirm | ${scope}, ${size}을 ${researchProvider}로 심층조사합니다(백그라운드).\n학원 1곳당 1분 안팎 걸립니다. 진행할까요? | `조사 소요시간(공유 상수 없음)` |
| `components/AcademyResearchClient.tsx:152` | confirm | 블로그리뷰를 동기화합니다. 한 곳씩 받아야 해 전체에 8~15분 걸립니다(백그라운드). 수집만 하며 글 생성에는 쓰이지 않습니다. 진행할까요?<br>_같은 작업의 소요시간을 화면마다 다르게 적었다 — 여기 8~15분 / DomainClient 「10분 이상」 2곳 / SettingsClient 「14분」. 어느 것도 코드에서 오지 않는다._ | `블로그 리뷰 수집 소요시간(공유 상수 없음)` |
| `components/DomainClient.tsx:392` | field:action | 이 흐름이 안정적이면 현재 검색 10개, 이후 100개로 확장하세요. | `components/DomainClient.tsx 작성 버튼 개수` |
| `components/DomainClient.tsx:679` | confirm | 키워드 마스터를 기본값(운전 프리셋 18개)으로 초기화할까요? 지금 표의 키워드·직접 추가한 값이 덮어써집니다.<br>_현재 18개로 일치. 프리셋에 항목을 더하면 세 곳(679·688·704)이 동시에 거짓이 된다._ | `apps/api-nest/src/constants.ts#PRESETS.driving.keyword` |
| `components/DomainClient.tsx:688` | muted-p | 글유형이 고르는 키워드 풀 + SEO 메트릭입니다. 월검색량·경쟁도(KD)는 슬롯 우선순위에 쓰입니다. 직접 편집하거나 「기본값으로 초기화」로 운전 프리셋 18개를 채웁니다. | `apps/api-nest/src/constants.ts#PRESETS.driving.keyword` |
| `components/DomainClient.tsx:704` | tooltip | 키워드 마스터를 운전 프리셋 기본값(18개+메트릭)으로 되돌립니다 | `apps/api-nest/src/constants.ts#PRESETS.driving.keyword` |
| `components/DomainClient.tsx:931` | muted-p | 학원 커버리지 (총 {coh.academy.regions_total}개 지역): 충분 {coh.academy.regions_with_min_for_best} · 보장 {coh.academy.regions_guaranteed} · 0 ? "var(--danger)" : undefined }}>부족 {coh.academy.r…<br>_같은 문장에서 보장 반경은 서버값(min_guarantee_km)을 렌더하는데 20km만 하드코딩이다. ACADEMY_NEARBY_MAX_KM 은 SEO_ACADEMY_NEARBY_MAX_KM 으로 덮이는 env 값이라, 환경변수를 바꾸면 화면이 즉시 거짓말을 한다. coh.academy.nearby_km 이 이미 API 로 내려온다._ | `apps/api-nest/src/constants.ts#ACADEMY_NEARBY_MAX_KM` |
| `components/DomainClient.tsx:1632` | muted-p | ⚠️ 이 브라우저의 마지막 동기화 시도({formatDateTime(lastSync.academies?.at)})는 DB에 반영되지 않았습니다. 학원 동기화는 1분 안팎이 걸리는데 그사이 개발 서버가 재시작되면 전량 유실됩니다. npm run sync:academies -- {domain.domain} 로 다시 실행하면 … | `동기화 소요시간(공유 상수 없음)`<br>`package.json#sync:academies` |
| `components/DomainClient.tsx:1907` | muted-p | 글 작성/중복검사/가지치기/색인 작업을 이 화면에서 바로 확인합니다. 3초마다 자동 새로고침됩니다. | `components/DomainClient.tsx:1896 setInterval(…, 3000)` |
| `components/DomainClient.tsx:2007` | muted-p | 생성 글 본문·CTA·HTML 내보내기·공개 API에 나가는 이름입니다. 마지막 섹션 CTA에서 3~7회 언급되므로 독자가 브랜드로 읽을 수 있는 고유명이어야 합니다. 비워 두면 표시 이름({effectiveBrand})이 그대로 쓰입니다.<br>_현재 프롬프트와 일치(3~7회). 같은 문장이 브랜드 폴백 동작(brand.ts)도 함께 설명한다._ | `apps/api-nest/src/brand.ts`<br>`apps/api-nest/src/worker.service.ts:1105 CTA 지침` |
| `components/SettingsClient.tsx:236` | muted-p | 켜면 학원 동기화가 1~2분에서 14분으로 늘어납니다(원천이 동시 요청을 못 견뎌 한 곳씩 받습니다). 이미 수집된 자료는 끄더라도 지워지지 않고 학원 상세에 남습니다.<br>_위 8~15분·10분 이상과 불일치._ | `블로그 리뷰 수집 소요시간(공유 상수 없음)` |

## B — 동작 계약 (56건)

코드가 강제하는 규칙을 문장으로 다시 설명한다. 파생이 불가능하므로 **종속 대상이 바뀌면 사람이 같이 고쳐야 한다.**

| 위치 | 담체 | 안내멘트 | 종속 대상 |
| --- | --- | --- | --- |
| `components/AcademyDetailClient.tsx:118` | muted-p | 아래 항목은 원천 동기화로 이미 확인돼 조사 대상에서 빠집니다. 글 생성도 이 값을 씁니다. | `조사 항목 정의`<br>`docs/source-field-usage.md` |
| `components/AcademyResearchClient.tsx:200` | muted-p | 기본정보·리뷰 원문과 AI 심층조사 데이터는 별도 DB(academy_research.db)에 저장됩니다. admin.db와 분리되어 초기화되지 않습니다. | `academy-research 저장소` |
| `components/AcademyResearchClient.tsx:519` | muted-p | 도메인 설정이 「검증완료만」이면 여기서 승인한 값만 글에 쓰입니다. 값을 고치거나 승인을 되돌리려면 학원 상세로 가세요. 상태를 검증완료로 두면 지금 글에 쓰이는 조사값을 그대로 볼 수 있습니다.<br>_DomainClient 2234 는 「아직 연결 안 됨」이라고 하는데 여기는 이미 쓰이는 것처럼 단정한다._ | `조사값 사용 게이트(미구현)` |
| `components/DomainClient.tsx:368` | field:body | 모든 글에 공통 적용될 안전·데이터 원칙, 절대 넣지 말 제외어, 키워드 마스터를 정합니다. 지금 건너뛰고 나중에 정해도 됩니다.<br>_투어 문구만 정정에서 빠졌다. 바로 아래 입력칸 안내(652)는 「안전·데이터 규칙은 이미 게이트가 강제하므로 여기 다시 적지 마라」인데, 투어는 정반대로 「안전·데이터 원칙을 정하라」고 안내한다. 같은 화면 안에서 모순._ | `apps/api-nest/src/worker.service.ts#buildPrompt 공통원칙 주입` |
| `components/DomainClient.tsx:618` | muted-p | 생성 프롬프트에 항상 들어갑니다(학원 규칙은 학원 후보를 다루는 글에만). 이 중 금액 날조·전화번호 노출·후보 수 부풀리기처럼 게이트가 완성된 글을 직접 검사하는 항목이 있고, 나머지는 프롬프트 지시입니다. 어느 쪽이든 아래 「공통 작성 원칙」에 다시 적지 마세요 — 강제력은 더 생기지 않고, 그 칸에서만 전달되는 말투… | `apps/api-nest/src/worker.service.ts#buildPrompt`<br>`apps/api-nest/src/quality-gate.ts` |
| `components/DomainClient.tsx:632` | muted-p | 글유형에 따라 일부 규칙은 그 유형의 지침이 대신합니다(예: T01 계열은 학원 원칙을 자체 지침으로 덮어씁니다). | `apps/api-nest/src/constants.ts 아키타입 writing_guide` |
| `components/DomainClient.tsx:652` | muted-p | 이 사이트만의 말투·태도를 적는 칸입니다. 확인된 데이터만 사용·가격/합격률 날조 금지·후보 수 부풀리기 금지 같은 안전·데이터 규칙은 이미 생성 프롬프트와 품질 게이트가 강제하므로 여기에 다시 적지 않아도 됩니다. 오히려 중복해서 채우면 이 칸에서만 전달되는 말투 지시가 묻힙니다. 비우면 프롬프트에 「공통원칙: 없음」으…<br>_2026-07-28 기준 코드와 일치(커밋 8a1134a 로 정정됨). 단 같은 화면의 투어 문구는 아직 옛 안내다 — 아래 항목 참조._ | `apps/api-nest/src/worker.service.ts#buildPrompt 공통원칙 주입`<br>`apps/api-nest/src/constants.ts#DEFAULT_DRIVING_COMMON_PRINCIPLES` |
| `components/DomainClient.tsx:653` | muted-p | 한 줄에 하나씩 입력하면 후보 생성, 후보 검색, 작성 큐, 최종 저장 전에 제외됩니다. | `apps/api-nest/src/slot.service.ts`<br>`apps/api-nest/src/worker.service.ts` |
| `components/DomainClient.tsx:654` | muted-p | 여러 글에서 똑같이 반복되는 판박이 문장을 한 줄에 하나씩 입력하면, 생성 품질 게이트가 이 문구를 감지해 다른 표현으로 다시 쓰도록(중복 콘텐츠 방지) 합니다. 제외어와 달리 글을 건너뛰지 않고 재작성합니다. | `apps/api-nest/src/quality-gate.ts#boilerplatePhraseIssues`<br>`apps/api-nest/src/worker.service.ts repair` |
| `components/DomainClient.tsx:766` | muted-p | 아직 안 켠 빌트인 글 유형입니다(코드 소유·초기화에도 복구). | `apps/api-nest/src/constants.ts#TEMPLATE_SPECS` |
| `components/DomainClient.tsx:1158` | muted-p | 📐 섹션 순서 자동 다양화 (글마다 자동 선택 · 편집 불가): {structureVariants[kind]!.map((l, i) => {l})} | `apps/api-nest/src/constants.ts structure variants` |
| `components/DomainClient.tsx:1163` | muted-p | 이 글유형이 쓸 키워드를 한 줄에 하나씩 적습니다. 적으면 그 키워드를 그대로 사용(아키타입 패턴 무시), 비우면 아키타입 패턴으로 자동 선택. 아래 키워드 마스터에서 클릭하면 추가되고, 마스터에 없는 키워드도 직접 입력할 수 있습니다. | `apps/api-nest/src/slot.service.ts` |
| `components/DomainClient.tsx:1168` | muted-p | ⚠️ 키워드 마스터에 없는 키워드: {unknown.join(", ")} — 지역형 글유형은 영향 없지만, 키워드형은 검색량·경쟁도가 없어 우선순위 0으로 취급돼 대량 선별에서 후순위가 됩니다. 우선순위를 반영하려면 「공통 설정」 탭의 키워드 마스터에 등록하세요. | `apps/api-nest/src/slot.service.ts 우선순위 계산` |
| `components/DomainClient.tsx:1189` | muted-p | ✍️ 여기서 정해지는 것: 이 글유형의 말투 격식과 다루는 각도·전개 방식입니다. 말투는 방향성이 최종 결정권을 갖습니다 — “옆자리 선배가 이야기해 주듯”이라고 쓰면 대화체(반말체 아님·이모지 허용)로, “차분한 전문가 설명”이라고 쓰면 전문가 톤(격식체·이모지 절제)으로 글이 달라집니다. | `apps/api-nest/src/worker.service.ts 톤 결정` |
| `components/DomainClient.tsx:1190` | muted-p | 🔒 방향성으로 바뀌지 않는 것: 제목 규칙·H2 구성·표/이미지 배치 같은 필수 출력 구조, 축(의도·수식어)이 정하는 강조 섹션과 필수 응답, 그리고 품질 게이트입니다. 게이트는 프롬프트 밖에서 완성된 글을 검사하므로, 방향성에 예외를 적어도 통과되지 않습니다. | `apps/api-nest/src/quality-gate.ts`<br>`apps/api-nest/src/worker.service.ts 필수 출력 구조` |
| `components/DomainClient.tsx:1191` | muted-p | 🔎 방향성 검증: 방향성은 이 글유형만의 방향을 적는 자리입니다. 날조 금지·데이터 검증 같은 안전·데이터 규칙은 이미 모든 글에 강제(절대 원칙)되니 방향성에 다시 쓰면 중복이고, 여기서만 전달되는 톤·관점 지시가 묻힙니다. 버튼을 누르면 절대 원칙·공통원칙·아키타입 작성 지침(학원 후보를 다루는 유형이면 학원 전용 … | `apps/api-nest/src/admin.controller.ts` |
| `components/DomainClient.tsx:1205` | muted-p | 이 글유형이 쓸 persona·intent·modifier 값입니다. 쓸 축을 켜면 값을 반드시 입력하세요 — 이 값이 유일한 소스이고(도메인 공통 축 폴백 없음), 비어 있으면 그 축은 생성에서 무시됩니다. 한 줄에 하나씩. | `apps/api-nest/src/slot.service.ts axis_values` |
| `components/DomainClient.tsx:1206` | muted-p | 📐 축은 글감 라벨에 그치지 않습니다. 「지역 운전학원 축 기반 소개」 계열(아키타입 local_axis)에서는 intent가 반드시 답할 질문을, modifier가 각 학원에서 부각할 관점·강조 섹션 주제·요약표 열을, 둘이 합쳐 제목 부제를 결정합니다. 축 값을 바꾸면 글의 구조가 달라집니다. 자료가 뒷받침하지 못하…<br>_「자료가 뒷받침하지 못하는 축은 자동으로 내려앉는다」는 강등 로직에 직접 종속._ | `apps/api-nest/src/worker.service.ts local_axis` |
| `components/DomainClient.tsx:1235` | muted-p | 이 글유형이 후보로 쓸 학원 타입입니다. 괄호 안 숫자는 이 도메인에 동기화된 학원 수예요. 비우면 학원정보를 쓰지 않고 지역 가이드/체크리스트 중심으로 작성합니다. 지역형 글유형에만 적용됩니다. | `apps/api-nest/src/slot.service.ts academy_type_filter` |
| `components/DomainClient.tsx:1249` | muted-p | 글 유형마다 자동 매칭되는 기본 디자인입니다. 아래 목업으로 레이아웃을 확인하세요. 「커스텀」을 고르면 도메인 「디자인」 영역의 커스텀 디자인 메모가 적용됩니다. | `apps/api-nest/src/constants.ts design_presets` |
| `components/DomainClient.tsx:1264` | muted-p | 제목을 생성 시점의 실제 후보 수로 확정해 LLM 즉흥·후보 수 부풀림을 막습니다. tier는 후보 수 내림차순으로 첫 매칭 제목을 씁니다(예: 3곳↑ &quot;BEST {"{개수}"}&quot;, 2곳 &quot;추천&quot;). 치환 토큰: {"{지역}"} {"{개수}"} {"{키워드}"} {"{학원명}"}(첫 후… | `apps/api-nest/src/slot.service.ts 제목 tier` |
| `components/DomainClient.tsx:1271` | muted-p | 위 &lsquo;실제 후보 수&rsquo;가 이 값보다 적으면 생성하지 않고 건너뜁니다(슬롯 skipped · 후보 부족 지역 차단용). 비우거나 0이면 스킵 없음. | `apps/api-nest/src/slot.service.ts slot skipped` |
| `components/DomainClient.tsx:1293` | jsx-text | 참조 아키타입(kind)은 만든 뒤 바꿀 수 없습니다. | `apps/api-nest/src/admin.controller.ts` |
| `components/DomainClient.tsx:1552` | muted-p | DrivingPlus 원천 API의 지역·학원 데이터를 가져와 글 생성 프롬프트의 검증된 자료로 씁니다. 지역 → 학원 순서로 한 번 준비해두면 생성 때 다시 열 필요는 없습니다. | `apps/api-nest/src/drivingplus-api.service.ts` |
| `components/DomainClient.tsx:1557` | muted-p | 블로그 리뷰 수집: {blogSyncOn === null ? "확인 중" : blogSyncOn ? "켜짐" : "꺼짐"} {blogSyncOn === null ? "" : blogSyncOn ? " — 학원 동기화가 10분 이상 걸립니다. 수집만 하며 글 생성에는 쓰지 않습니다." : " — 원천이 학원명을 느슨하게 매…<br>_「10분 이상」이라는 숫자가 다른 화면(8~15분·14분)과 어긋난다._ | `apps/api-nest/src/worker.service.ts 프롬프트`<br>`apps/api-nest/src/quality-gate.ts` |
| `components/DomainClient.tsx:1589` | muted-p | 지역(시군구/읍면동) 목록을 가져오고, 옵션을 켜면 region 축을 교체합니다. 아래 옵션은 지역 동기화에만 적용됩니다. | `apps/api-nest/src/drivingplus-api.service.ts` |
| `components/DomainClient.tsx:1599` | muted-p | 글유형(지역형)이 「지역 × 키워드」 조합을 만들 때 쓰는 지역 풀입니다. 키워드 마스터와 동일하게 가중치·월검색량·KD는 슬롯 우선순위 계산에만 쓰이고 글 내용은 바꾸지 않습니다. | `apps/api-nest/src/slot.service.ts 우선순위 계산` |
| `components/DomainClient.tsx:1618` | muted-p | 각 지역의 학원 상세(사진·별점리뷰{blogSyncOn === true ? "·블로그 리뷰" : ""} 포함)를 가져옵니다. 지역 동기화 이후 실행을 권장하며, 위 지역 옵션은 여기에 영향을 주지 않습니다. {/* 상태를 못 읽은 동안 어느 쪽으로도 단정하지 않는다 — 위 배너·버튼 툴팁과 같은 기준(239f4a1). *…<br>_여기도 「10분 이상」. 위와 같은 문제._ | `apps/api-nest/src/worker.service.ts 프롬프트`<br>`apps/api-nest/src/quality-gate.ts` |
| `components/DomainClient.tsx:1642` | muted-p | ⚠️ 같은 학원(지역+이름)을 다시 등록하면 비운 항목이 기존 값을 덮어 지웁니다. 일부만 수정할 땐 나머지 항목도 함께 채워주세요. 단건·JSON 일괄 등록 모두 동일합니다. | `apps/api-nest/src/admin.controller.ts academies upsert` |
| `components/DomainClient.tsx:1647` | muted-p | 동기화된 학원을 검색·지역으로 찾고, 필요 없는 자료는 삭제합니다. 글 생성에 쓰는 학원 타입은 글유형별로 정합니다(글유형 탭의 “학원 타입 필터”). | `apps/api-nest/src/slot.service.ts academy_type_filter` |
| `components/DomainClient.tsx:1801` | muted-p | 글유형을 고르고 개수를 정해 작성 대기 후보(planned)를 만듭니다. LLM을 호출하지 않습니다. | `apps/api-nest/src/slot.service.ts` |
| `components/DomainClient.tsx:1816` | muted-p | 조합 재료는 「원천 데이터」 탭 지역·「글 공통 설정」 키워드 마스터·「글유형/디자인」 설정을 따릅니다. 프리셋을 적용했다면 별도 동기화 없이도 후보를 만들 수 있습니다. | `apps/api-nest/src/constants.ts#PRESETS`<br>`apps/api-nest/src/slot.service.ts` |
| `components/DomainClient.tsx:1824` | muted-p | 후보를 골라 생성 작업 큐에 넣습니다. 후보가 없으면 먼저 1단계 ‘글 후보 만들기’로 후보를 만든 뒤 작성하세요. (작성 버튼은 후보를 자동 생성하지 않습니다.) | `apps/api-nest/src/slot.service.ts` |
| `components/DomainClient.tsx:1843` | muted-p | 추천: 1개 테스트 작성 → QA 확인 → 현재 검색 10개 → 전국 골고루 100개. 작성 대상은 무작위가 아니라 우선순위(검색량·경쟁도·weight) 상위 N개를 고르며, 전국 작성은 지역을 라운드로빈으로 섞습니다.<br>_같은 문장이 「현재 검색 10개 → 전국 골고루 100개」라는 버튼 개수까지 손으로 적는다(A 성격). 버튼을 바꾸면 이 문장도 거짓이 된다._ | `apps/api-nest/src/slot.service.ts 선별·라운드로빈`<br>`components/DomainClient.tsx 작성 버튼 개수` |
| `components/DomainClient.tsx:1910` | muted-p | 대기/진행 작업이 멈춰 있으면 서버 터미널에서 npm run worker:once를 실행해 처리할 수 있습니다. | `package.json#worker:once` |
| `components/DomainClient.tsx:1967` | muted-p | 비용($)은 종량 API 사용 시에만 계측됩니다. 이미지는 OpenAI 이미지 API + SEO_IMAGE_PRICE_USD(장당 단가) 설정, 텍스트는 API LLM이 필요합니다. Codex/구독 경로는 $0으로 표시됩니다. | `apps/api-nest/src/worker.service.ts 비용 계측`<br>`SEO_IMAGE_PRICE_USD` |
| `components/DomainClient.tsx:1990` | muted-p | 체크한 빌트인만 「글유형/디자인」 탭의 빌트인 추가 카탈로그·커스텀 시작점·참조 아키타입 목록에 노출됩니다. 모든 도메인 공통이며, 이미 켜 둔 유형의 생성에는 영향이 없습니다(노출만 제어). 유형 검증이 끝나면 제거할 임시 기능입니다.<br>_「유형 검증이 끝나면 제거할 임시 기능」 — 제거 시 이 문단도 함께 사라져야 한다._ | `apps/api-nest/src/admin.controller.ts 빌트인 노출 설정` |
| `components/DomainClient.tsx:2007` | muted-p | 발행 글을 Google Indexing API로 색인 요청하는 기능입니다. 배포 연동 방식이 정해지면 활성화 예정이며, 현재는 동작하지 않습니다. (서비스계정 JSON은 전 도메인 공통으로 관리될 예정) | `apps/api-nest/src/worker.service.ts indexing job(제출 skip)` |
| `components/DomainClient.tsx:2148` | field:help | 조사값을 글에 전혀 쓰지 않습니다. 글은 원천 동기화로 받은 학원 자료(주소·전화·수강료·셔틀·영업시간·운영 과정·운영 형태·사진 등)와 자체 수강생 후기만 근거로 씁니다.<br>_세 단계 정책 자체가 아직 생성에 연결되지 않았다(같은 화면 2234가 그렇게 밝힘). 구현되는 순간 세 문장이 동시에 검증 대상이 된다._ | `조사값 사용 게이트(미구현)` |
| `components/DomainClient.tsx:2153` | field:help | 위 원천 자료·후기에 더해, 조사값 중에서는 사람이 학원 상세 화면에서 「검증완료」로 올린 것만 씁니다. AI가 조사한 채로 둔 값은 쓰지 않습니다. | `조사값 사용 게이트(미구현)` |
| `components/DomainClient.tsx:2158` | field:help | 위 원천 자료·후기에 더해, 사람이 확인하지 않은 AI 조사값까지 씁니다. 검사에 걸리지 않았을 뿐 사실 확인은 안 된 값입니다. | `조사값 사용 게이트(미구현)` |
| `components/DomainClient.tsx:2185` | muted-p | 원천에 없는 항목(편의시설·자체 시험장·야간반·설립연도 등)을 공개 자료에서 조사해 둡니다. 조사는 학원 단위라 도메인마다 따로 돌리지 않습니다 — 실행은 자료관리에서 합니다. | `academy-research 저장소` |
| `components/DomainClient.tsx:2229` | muted-p | 어느 설정에서도 「검토 필요」(수집한 근거에서 확인되지 않았거나 그 항목에 담기면 안 되는 값)와 「웹조사 차단」 값은 쓰이지 않습니다. 조사 대상이 아니었던 항목(원천 자료가 이미 있는 수강료·셔틀 등)도 마찬가지입니다. | `조사값 사용 게이트(미구현)` |
| `components/DomainClient.tsx:2233` | muted-p | ⚠️ 조사값은 아직 글 생성에 연결되지 않았습니다. 이 설정은 연결되는 시점부터 적용됩니다.<br>_구현되면 이 경고를 지워야 한다. 지우는 것을 잊으면 반대 방향으로 거짓이 된다._ | `조사값 사용 게이트(미구현)` |
| `components/DomainClient.tsx:2278` | muted-p | 읍·면·동 단위 행정구역 목록입니다. 셔틀 안내문·정류장명에서 어느 지역까지 셔틀이 오는지 판별하는 데 씁니다. 도메인과 무관한 공용 자료라 한 번 받으면 모든 도메인에 적용되고, 도메인을 만들 때 자동으로 준비됩니다. 아래 버튼은 행정구역이 개편됐을 때처럼 다시 받아야 할 때만 쓰면 됩니다. | `apps/api-nest/src/admin.controller.ts 도메인 생성` |
| `components/DomainClient.tsx:2303` | muted-p | 갱신해도 지역 축·학원 지역 배정은 바뀌지 않습니다(1·2단계와 별도 표를 씁니다). 셔틀 운행 지역은 학원자료 동기화 시점에 계산되므로, 사전을 새로 받은 뒤에는 2단계를 다시 실행해야 반영됩니다. | `셔틀 지역 판정` |
| `components/DraftsClient.tsx:81` | muted-p | 품질 게이트를 통과하지 못한 글이 생기면 버려지지 않고 여기에 자동으로 보관됩니다. 지금 비어 있는 이유는 보통 둘 중 하나입니다. | `draft 격리 훅` |
| `components/DraftsClient.tsx:86` | jsx-text | 실패한 글은 소급 보관되지 않습니다. 당시에는 본문이 그대로 폐기됐기 때문입니다. | `draft 격리 훅` |
| `components/DraftsClient.tsx:176` | muted-p | 품질 게이트에 걸려 발행되지 못한 글입니다. B(안전·사실) 이슈가 있으면 발행할 수 없고, 본문을 수정해 재검증해야 합니다. A(구조/문체)만 남으면 사유를 확인한 뒤 발행할 수 있습니다. | `apps/api-nest/src/quality-gate.ts`<br>`draft 격리 게이트` |
| `components/DraftsClient.tsx:223` | muted-p | 안전·사실(B) 이슈가 있어 바로 발행할 수 없습니다. 아래에서 본문을 수정하고 재검증해 B 이슈를 해소하세요. | `apps/api-nest/src/quality-gate.ts`<br>`draft 격리 게이트` |
| `components/IntegrationSettingsClient.tsx:14` | muted-p | 구글 색인 설정은 도메인 관리 &gt; 설정 탭으로 이동되었습니다. 현재는 비활성(추후 지원 예정) 상태입니다. | `apps/api-nest/src/worker.service.ts indexing job(제출 skip)` |
| `components/IntegrationSettingsClient.tsx:18` | muted-p | 배포 연동 방식이 정해지면 색인 기능을 활성화할 예정입니다. 그 전까지는 별도 연동 설정이 없습니다. | `apps/api-nest/src/worker.service.ts indexing job(제출 skip)` |
| `components/JobsClient.tsx:26` | muted-p | worker가 처리하는 generate/dedup/prune/indexing 작업 상태입니다. | `apps/api-nest/src/worker.service.ts job types` |
| `components/SettingsClient.tsx:195` | muted-p | 도메인 생성 시 고르는 업종 목록입니다. key는 프리셋·프롬프트에 쓰는 슬러그, 표시명은 화면 표시용입니다. 새 업종은 전용 프리셋이 없어 도메인이 빈 축으로 시작합니다(현재 실질 생성은 driving 기준). 이 설정은 서버에 저장되어 즉시 반영됩니다. | `apps/api-nest/src/constants.ts#PRESETS`<br>`apps/api-nest/src/admin.controller.ts` |
| `components/SettingsClient.tsx:226` | muted-p | 수집만 켜고 끕니다. 글 생성에는 어느 쪽이든 쓰지 않습니다. 생성 프롬프트와 품질 게이트에서 이미 빠져 있어, 켜도 글 내용이 달라지지 않습니다. 글에 다시 쓰려면 블로그 글이 실제 그 학원의 글인지 건별로 가려내는 검증 기능이 먼저 필요합니다. 그런 기능이 생긴다면 검증을 통과한 것만 골라 쓰는 방식을 검토해볼 만합니… | `apps/api-nest/src/worker.service.ts 프롬프트`<br>`apps/api-nest/src/quality-gate.ts` |
| `components/SettingsClient.tsx:250` | jsx-text | 서버에 저장되어 즉시 반영됩니다(재시작 불필요). | `apps/api-nest/src/admin.controller.ts settings/verticals` |

## C — 순수 안내 (175건)

흐름 설명·투어 문구·빈 상태 문구. 사실을 주장하지 않으므로 코드 변경과 무관하다.
새로 추가된 문장이 사실을 주장하는데 C 로 남아 있는지는 `node scripts/copy-inventory.mjs --untagged` 로 점검한다.

<details><summary>전체 175건 펼치기</summary>

| 위치 | 담체 | 안내멘트 | 종속 대상 |
| --- | --- | --- | --- |
| `components/AcademyDetailClient.tsx:42` | confirm | ${targetName} 학원을 ${researchProvider}로 AI 단건 조사합니다. 진행할까요? | — |
| `components/AcademyDetailClient.tsx:191` | muted-p | 조사된 셔틀 노선이 없습니다. | — |
| `components/AcademyDetailClient.tsx:205` | muted-p | 수집된 후기가 없습니다. 재동기화를 시도하세요. | — |
| `components/AcademyResearchClient.tsx:101` | confirm | DrivingPlus 전체 학원정보를 동기화합니다. 기존 원본 정보와 리뷰 원문이 갱신됩니다. 진행할까요? | — |
| `components/AcademyResearchClient.tsx:140` | confirm | ${runLabel(run)}을(를) 중단할까요? 처리 중이던 학원 1곳은 마친 뒤 멈춥니다. 여기까지 저장된 내용은 남습니다. | — |
| `components/AcademyResearchClient.tsx:192` | jsx-text | 이 화면은 아직 전체 기능이 완성되지 않았습니다. | — |
| `components/AcademyResearchClient.tsx:193` | jsx-text | 현재는 DrivingPlus에서 동기화한 학원 목록 조회와 학원별 기본 조사 정보 확인까지만 안정적으로 제공합니다. 조사 항목 편집, 대량 관리, 자동 조사 흐름은 아직 정리 중이므로 운영 판단용 보조 화면으로만 사용해 주세요. | — |
| `components/AcademyResearchClient.tsx:288` | jsx-text | 기본은 아직 조사하지 않은 곳만 대상입니다. 중단되면 다시 눌러 이어서 진행할 수 있습니다. | — |
| `components/AcademyResearchClient.tsx:313` | muted-p | {run!.cancel_requested ? "중단 요청됨 — 처리 중이던 학원 1곳을 마친 뒤 멈춥니다. 여기까지 저장된 내용은 남습니다." : "서버에서 실행 중입니다. 이 창을 닫거나 새로고침해도 계속 진행되며, 다시 들어오면 진행률이 이어서 보입니다."} | — |
| `components/AcademyResearchClient.tsx:340` | tooltip | 원천 목록에서 내려간 항목입니다. 자료는 보관하되 목록·동기화 대상에서 제외합니다. | — |
| `components/AcademyResearchClient.tsx:366` | jsx-text | 동기화된 학원이 없습니다. 위 | — |
| `components/DashboardClient.tsx:97` | muted-p | 운전면허·운전학원 도메인의 콘텐츠 생성·발행 작업을 운영하는 내부 관리자 화면입니다. | — |
| `components/DashboardClient.tsx:103` | muted-p | ℹ️ 현재 범위 — 이 관리자는 운전면허·운전학원(driving) 글 생성에 특화되어 구현돼 있습니다. 프리셋·글유형·품질 규칙이 이 주제 기준이라, 다른 주제의 글은 생성되더라도 품질을 보장할 수 없습니다. (업종은 추가할 수 있으나 전용 프리셋·품질은 아직 운전면허·운전학원에만 적용) | — |
| `components/DashboardClient.tsx:115` | muted-p | 생성 글 본문·CTA에 나가는 이름입니다. 비우면 표시 이름을 그대로 씁니다. 나중에 설정 탭에서 바꿀 수 있습니다. | — |
| `components/DashboardClient.tsx:144` | muted-p | 운전 도메인을 만들면 지역/키워드 프리셋이 자동으로 들어갑니다. 도메인이 있어야 도메인 관리, 글 생성, 검수·보내기 메뉴를 사용할 수 있습니다. | — |
| `components/DashboardClient.tsx:153` | muted-p | 전체 도메인의 후보·대기·발행 상태를 보고 필요한 화면으로 이동합니다. | — |
| `components/DashboardClient.tsx:214` | field:desc | 새 도메인입니다. 원천 데이터·공통 설정(선택)을 준비하고 글 유형을 켜면 후보를 만들 수 있어요. | — |
| `components/DashboardClient.tsx:215` | field:desc | 글 유형은 켜져 있습니다. 지역/학원 데이터를 동기화한 뒤 후보를 만드세요. | — |
| `components/DashboardClient.tsx:216` | field:desc | ${(domain.planned_count ?? 0).toLocaleString()}개 대기 후보 중 하나만 먼저 작성해 품질을 확인하세요. | — |
| `components/DashboardClient.tsx:217` | field:desc | ${(domain.published_count ?? 0).toLocaleString()}개 발행 글을 미리보기/export/indexing으로 마감하세요. | — |
| `components/DashboardClient.tsx:218` | field:desc | 운영을 시작할 후보를 먼저 만들어야 합니다. | — |
| `components/DomainClient.tsx:62` | field:desc | 글유형 켜기 → 원천 데이터 → 후보 → 테스트 작성까지 순서대로 안내하는 생성 흐름 | — |
| `components/DomainClient.tsx:63` | field:desc | 작업 상태와 완성 글을 확인하고 export/indexing으로 넘기는 마감 흐름 | — |
| `components/DomainClient.tsx:69` | field:desc | 선택 준비(원천·공통설정·디자인) 후 글유형 켜기 → 생성 · 필요한 단계만 눌러도 됩니다 | — |
| `components/DomainClient.tsx:72` | field:desc | 공통원칙·제외어·키워드(선택) | — |
| `components/DomainClient.tsx:74` | field:desc | 만들 글 유형 선택(새 도메인 필수) | — |
| `components/DomainClient.tsx:81` | field:desc | 생성 이후 확인, 내보내기, 색인 요청 | — |
| `components/DomainClient.tsx:115` | field:body | 왜 이 정보를 찾는지 공감한 뒤, 글에서 바로 얻을 수 있는 내용을 짧게 알려줍니다. | — |
| `components/DomainClient.tsx:116` | field:body | 절차, 비용, 기간을 순서대로 풀고 중간에 이미지를 배치합니다. | — |
| `components/DomainClient.tsx:117` | field:body | 처음 등록해도 되나요?\|주말에도 가능한가요?\|추가 비용은 언제 생기나요? | — |
| `components/DomainClient.tsx:118` | field:body | 주변 학원 찾기나 예약 확인으로 부드럽게 연결합니다. | — |
| `components/DomainClient.tsx:129` | field:body | 가격, 셔틀, 주말 수업, 도로주행 코스를 같은 기준으로 맞춰 비교합니다. | — |
| `components/DomainClient.tsx:130` | field:body | 표 아래에는 왜 이 항목이 중요한지 짧게 해석하는 문단이 붙습니다. | — |
| `components/DomainClient.tsx:131` | field:body | 직장인, 대학생, 장롱면허처럼 상황별 추천을 분리합니다. | — |
| `components/DomainClient.tsx:132` | field:body | 가까운 학원과 예약 가능한 시간을 확인하도록 연결합니다. | — |
| `components/DomainClient.tsx:143` | field:body | 송파, 잠실, 문정처럼 생활권이 다른 사용자의 이동 동선을 나눠 설명합니다. | — |
| `components/DomainClient.tsx:144` | field:body | 집/학교와 가까운지\|셔틀 시간이 맞는지\|도로주행 코스가 어렵지 않은지 | — |
| `components/DomainClient.tsx:145` | field:body | 퇴근 후 수업을 잡을 수 있어서 주말에 몰아서 배우는 부담이 줄었다는 식의 현실적인 후기를 넣습니다. | — |
| `components/DomainClient.tsx:146` | field:body | 내 위치 기준으로 가까운 학원을 찾도록 연결합니다. | — |
| `components/DomainClient.tsx:157` | field:body | 신분증, 시험 시간, 코스 확인처럼 놓치면 바로 문제가 되는 항목을 맨 위에 둡니다. | — |
| `components/DomainClient.tsx:158` | field:body | 신분증 챙기기\|시험장 도착 시간 확인\|좌석/거울 조정 연습\|감점 포인트 복습 | — |
| `components/DomainClient.tsx:159` | field:body | 방향지시등, 일시정지, 속도 조절처럼 반복되는 실수를 실제 상황 중심으로 설명합니다. | — |
| `components/DomainClient.tsx:160` | field:body | 불안한 구간만 추가 연습할 수 있는 학원/강습 탐색으로 이어집니다. | — |
| `components/DomainClient.tsx:171` | field:body | 시간과 비용이 동시에 부담되는 상황을 구체적으로 짚어 이탈을 줄입니다. | — |
| `components/DomainClient.tsx:172` | field:body | 단기반, 셔틀, 추가 비용 여부를 상담 전 질문 목록으로 정리합니다. | — |
| `components/DomainClient.tsx:173` | field:body | 상담 후 전체 일정을 한 번에 잡을 수 있어 편했다는 톤으로 신뢰를 보강합니다. | — |
| `components/DomainClient.tsx:174` | field:body | 비용과 가능한 일정을 바로 확인하는 버튼을 강하게 보여줍니다. | — |
| `components/DomainClient.tsx:185` | field:body | 제목, 핵심 요약, 대표 이미지 등 직접 적은 규칙을 발행 렌더러가 참고할 수 있게 저장합니다. | — |
| `components/DomainClient.tsx:186` | field:body | 표, 이미지, CTA 위치처럼 반복될 디자인 규칙을 명시합니다. | — |
| `components/DomainClient.tsx:187` | field:body | 상담, 예약, 내부 링크 등 마지막 행동을 어디에 둘지 정합니다. | — |
| `components/DomainClient.tsx:273` | muted-p | 등록되지 않은 도메인이거나 API 연결에 문제가 있을 수 있습니다. 대시보드에서 도메인을 만들거나 목록에서 다시 선택하세요. | — |
| `components/DomainClient.tsx:321` | jsx-text | 1단계 후보 만들기 → 2단계 글 작성 순서로 진행하세요 | — |
| `components/DomainClient.tsx:322` | muted-p | 글 생성 탭이 두 단계로 나뉩니다. 먼저 후보를 만들고, 2단계 카드에서 1개 테스트 작성으로 품질을 확인한 뒤 확장하세요. | — |
| `components/DomainClient.tsx:331` | jsx-text | 완성 글 확인, 내보내기, 색인 요청을 한곳에서 처리하세요 | — |
| `components/DomainClient.tsx:332` | muted-p | 제목을 눌러 상세 미리보기를 확인하고 필요한 글만 선택해 Markdown/HTML로 내보내거나 색인 요청을 등록합니다. | — |
| `components/DomainClient.tsx:367` | field:body | 지역과 학원 데이터를 가져와두면 생성 글이 검증된 자료를 기반으로 작성됩니다. 처음이면 지역 동기화 후 학원 동기화 순서를 권장합니다. 지금 건너뛰고 나중에 준비해도 됩니다. (상단 진행 막대가 전체 흐름입니다.) | — |
| `components/DomainClient.tsx:367` | field:action | 데이터가 이미 있거나 나중에 할 거면 다음 단계로 넘어가세요. | — |
| `components/DomainClient.tsx:368` | field:action | 입력 후 ‘저장’을 누르거나, 필요 없으면 다음으로 넘어가세요. | — |
| `components/DomainClient.tsx:369` | field:body | 글 유형마다 기본 디자인이 자동 적용됩니다. 대부분 그대로 두면 되고, 특별한 레이아웃이 필요할 때만 커스텀 디자인 메모나 커스텀 글유형 복제로 조정합니다. | — |
| `components/DomainClient.tsx:369` | field:action | 특별한 요구가 없으면 그대로 두고 넘어가세요. | — |
| `components/DomainClient.tsx:370` | field:body | 새 도메인은 글 유형이 하나도 켜져 있지 않아 이 단계 없이는 후보를 만들 수 없습니다. 비교형·지역형·체크리스트형처럼 어떤 검색 의도에 맞출지 고르고 켜면 즉시 저장됩니다. 위에서 준비한 원천 데이터·공통 설정을 근거로 커스텀 유형을 만들 수도 있습니다. | — |
| `components/DomainClient.tsx:370` | field:action | 운영 초반엔 필요한 유형만 켜세요. 너무 많이 켜면 후보가 급증합니다. | — |
| `components/DomainClient.tsx:389` | field:action | 버튼을 누르면 작업 큐 탭에서 진행 상태를 확인합니다. | — |
| `components/DomainClient.tsx:391` | field:body | 큐에 등록된 글 생성 작업이 대기·진행·완료·실패 중 어디에 있는지 봅니다. 실패하면 상세 카드의 에러를 확인하고 같은 조건으로 다시 시도합니다. | — |
| `components/DomainClient.tsx:391` | field:action | 완료 후 검수·내보내기 탭에서 결과를 검수합니다. | — |
| `components/DomainClient.tsx:472` | muted-p | 현재 단계의 대상 영역을 찾는 중입니다. 탭을 전환했거나 데이터가 아직 로딩 중이면 잠시 뒤 다시 표시됩니다. | — |
| `components/DomainClient.tsx:532` | muted-p | 「글 생성」 흐름은 원천 데이터·공통 설정·디자인(모두 선택) 준비 후 글유형 켜기(필수)로 이어지고, 후보 만들기·테스트 작성으로 마무리합니다. | — |
| `components/DomainClient.tsx:547` | muted-p | 「글 생성 흐름 시작」을 누르면 위 순서대로 카드 영역을 포커싱합니다. | — |
| `components/DomainClient.tsx:563` | jsx-text | 큰 흐름 안에서도 필요한 작업만 바로 열 수 있습니다 | — |
| `components/DomainClient.tsx:564` | muted-p | 운영자가 이미 중간까지 진행했다면 처음부터 다시 보지 않고, 필요한 단계 버튼만 누르면 됩니다. | — |
| `components/DomainClient.tsx:595` | field:desc | ${counts.failed.toLocaleString()}개 실패가 있어 같은 조건으로 다시 만들기 전에 에러를 먼저 봐야 합니다. | — |
| `components/DomainClient.tsx:596` | field:desc | ${counts.in_progress.toLocaleString()}개 작업이 진행 중입니다. 새 대량 생성보다 큐 상태 확인이 먼저입니다. | — |
| `components/DomainClient.tsx:597` | field:desc | ${counts.planned.toLocaleString()}개 후보가 대기 중입니다. 품질 확인 없이 대량 생성하지 않도록 테스트 1개부터 시작합니다. | — |
| `components/DomainClient.tsx:598` | field:desc | 새 도메인입니다. 원천 데이터·공통 설정(선택)을 준비하고 글 유형을 켜면 후보를 만들 수 있습니다. 「글 생성」 흐름을 처음부터 따라가세요. | — |
| `components/DomainClient.tsx:599` | field:desc | 글 유형은 켜져 있습니다. 지역/학원 데이터를 동기화한 뒤 글 후보를 만드세요. | — |
| `components/DomainClient.tsx:600` | field:desc | 후보는 있지만 공통 작성 원칙이 비어 있습니다. 이 사이트에서만 쓰는 말투·태도를 적어 두면 글의 결이 일정해집니다. | — |
| `components/DomainClient.tsx:601` | field:desc | ${counts.published.toLocaleString()}개 완성 글이 있습니다. 미리보기 후 Markdown/HTML export와 색인 요청으로 마감하세요. | — |
| `components/DomainClient.tsx:602` | field:desc | 현재 바로 작성할 대기 후보가 없습니다. 조건을 확인하고 후보를 다시 생성하세요. | — |
| `components/DomainClient.tsx:651` | muted-p | 모든 글 유형에 공통 적용되는 말투·태도, 제외어, 그리고 키워드 마스터(아래 표)입니다. 글 유형별 방향성·축·키워드 선택은 「글유형/디자인」 탭의 커스텀 글유형에서 관리합니다(빌트인 글유형은 복제해 커스텀으로 조정). | — |
| `components/DomainClient.tsx:652` | placeholder | 처음 준비하는 독자도 이해할 수 있는 쉬운 표현을 쓰되, 신뢰감 있는 전문가의 설명 톤을 유지한다.&#10;광고성·낚시성 문구와 근거 없는 과장 표현을 쓰지 않는다.&#10;경쟁 브랜드나 특정 업체를 비방하지 않고 균형 있게 설명한다. | — |
| `components/DomainClient.tsx:653` | placeholder | 실내운전연습장\n실내운전연습장 추천\n대성자동차학원 찾기 전 볼 인근 후보 | — |
| `components/DomainClient.tsx:654` | placeholder | 후기 요약에서는 친절한 상담과 꼼꼼한 설명이 확인됩니다\n정리하면 선택 기준은 단순합니다 | — |
| `components/DomainClient.tsx:689` | jsx-text | 는 실측이 아닌 초기 추정 시드값입니다. 슬롯 생성 | — |
| `components/DomainClient.tsx:689` | jsx-text | 계산에만 쓰이며, 글의 내용·품질·길이는 바꾸지 않습니다. 추후 | — |
| `components/DomainClient.tsx:689` | jsx-text | 연동 시 실측값으로 자동 갱신될 예정입니다. ( | — |
| `components/DomainClient.tsx:689` | jsx-text | 는 검색 데이터가 아닌 운영 우선순위 값으로, 수기 관리 항목입니다.) | — |
| `components/DomainClient.tsx:700` | jsx-text | 키워드가 없습니다. 「행 추가」 또는 「기본값으로 초기화」로 채우세요. | — |
| `components/DomainClient.tsx:744` | tooltip | 제목을 후보 수 규칙으로 확정 | — |
| `components/DomainClient.tsx:761` | muted-p | 이 도메인에서 쓸 글 유형을 켜고 끕니다(빌트인·커스텀 함께, 즉시 저장). 커스텀 유형은 맨 아래에서 만들고 여기서 켜세요. | — |
| `components/DomainClient.tsx:763` | muted-p | 담긴 글 유형이 없습니다. 아래 카탈로그에서 필요한 유형을 추가하세요. | — |
| `components/DomainClient.tsx:768` | muted-p | 모든 빌트인 글 유형이 이미 담겨 있습니다. | — |
| `components/DomainClient.tsx:772` | muted-p | 아직 안 켠 커스텀 글 유형입니다. 맨 아래에서 만들 수 있어요. | — |
| `components/DomainClient.tsx:774` | muted-p | 추가할 커스텀 글 유형이 없습니다. 맨 아래에서 만들어 보세요. | — |
| `components/DomainClient.tsx:782` | muted-p | 글 유형마다 기본 디자인이 자동으로 적용됩니다(대부분 그대로 두면 됩니다). 특정 글에 다른 디자인을 쓰려면 위 「커스텀 글유형」에서 그 유형을 복제해 디자인을 바꾸세요. | — |
| `components/DomainClient.tsx:783` | muted-p | 각 디자인이 어떤 화면인지 보여주는 참고용 목록입니다. | — |
| `components/DomainClient.tsx:794` | muted-p | 기본 디자인 밖의 레이아웃이 필요할 때만. 원하는 구조를 적고, 커스텀 글유형에서 디자인을 ‘커스텀’으로 지정하면 이 메모가 작성 프롬프트로 들어갑니다. | — |
| `components/DomainClient.tsx:795` | placeholder | 첫 화면에는 큰 제목과 핵심 요약 3개를 둔다. 비교표는 본문 상단에 배치한다. CTA는 중간 1회, 마지막 1회만 사용한다. 모바일에서는 카드형 목록으로 보이게 한다. | — |
| `components/DomainClient.tsx:871` | muted-p | 검증된 아키타입을 참조해 직접 만든 글유형입니다. 주키워드 규칙·품질 지침은 참조 아키타입을 그대로 씁니다. 만든 뒤 위 「이 도메인의 글 유형」에서 켜야 생성에 쓰입니다. | — |
| `components/DomainClient.tsx:871` | muted-p | 「새로고침」은 목록·정합성 미리보기·학원 타입 옵션을 서버에서 다시 불러옵니다. 이 화면에서 만들기/편집/삭제한 뒤엔 자동 갱신되며, 다른 창·다른 사람이 바꾼 경우에만 수동으로 누르면 됩니다. | — |
| `components/DomainClient.tsx:876` | muted-p | 글유형이 참조하는 &apos;동작 원형&apos;입니다. 자세한 설명을 펼쳐 보세요. | — |
| `components/DomainClient.tsx:878` | muted-p | 아키타입은 글의 검증된 &apos;동작 원형&apos;입니다 — 주축(지역/키워드)·주키워드 생성 규칙·작성 지침·품질 규칙을 정해 둔 틀이에요. 커스텀 글유형은 이 중 하나를 골라 참조하고, 키워드·페르소나·디자인·방향성 같은 세부만 조정합니다(주키워드 규칙·품질 지침은 아키타입 그대로).주축(아키타입이 결정, 변경 불… | — |
| `components/DomainClient.tsx:896` | muted-p | 아직 커스텀 글유형이 없습니다. 위에서 만들거나 복제해 보세요. | — |
| `components/DomainClient.tsx:909` | confirm | 커스텀 글유형 '${t.name}'을 삭제할까요? 이미 생성된 글에는 영향이 없습니다. | — |
| `components/DomainClient.tsx:955` | muted-p | 이 글유형은 학원 근거형이 아니거나 학원 타입이 선택되지 않아 커버리지 정보가 없습니다. | — |
| `components/DomainClient.tsx:957` | muted-p | 학원 타입: {data.academy_types.join(", ")} · 충분 기준 {data.threshold}곳 이상. 상태: 충분(직접+인근 {data.nearby_km}km로 {data.threshold}곳) {data.regions_with_min_for_best} · 보장({data.min_guarantee_k… | — |
| `components/DomainClient.tsx:1108` | confirm | persona 사용을 켰으면 값을 한 줄 이상 입력하세요. (비우려면 사용을 끄세요) | — |
| `components/DomainClient.tsx:1109` | confirm | intent 사용을 켰으면 값을 한 줄 이상 입력하세요. (비우려면 사용을 끄세요) | — |
| `components/DomainClient.tsx:1110` | confirm | modifier 사용을 켰으면 값을 한 줄 이상 입력하세요. (비우려면 사용을 끄세요) | — |
| `components/DomainClient.tsx:1133` | confirm | 참조 아키타입을 선택하세요. | — |
| `components/DomainClient.tsx:1145` | muted-p | {source ? "선택한 글유형의 값을 채웠습니다. 필요한 부분만 고치면 됩니다. weight·축 태그·기존 설정은 그대로 복제되고, 아키타입은 소스로 고정됩니다." : "빈 폼으로 직접 만들거나, 기존 글유형(빌트인/커스텀)을 골라 값을 채워 시작할 수 있습니다."} | — |
| `components/DomainClient.tsx:1148` | muted-p | 이름 · 참조 아키타입 · 키워드 선택 | — |
| `components/DomainClient.tsx:1156` | muted-p | 주축 {(kindOptions.find((o) => o.kind === kind)?.primary ?? "keyword") === "region" ? "지역형(지역+키워드)" : "키워드형"}{source ? " · 시작점을 고르면 소스의 아키타입으로 고정됩니다." : ""} | — |
| `components/DomainClient.tsx:1164` | placeholder | 운전면허학원\n자동차운전전문학원 (한 줄에 하나 · 비우면 아키타입 패턴) | — |
| `components/DomainClient.tsx:1185` | placeholder | 예: 옆자리 선배가 이야기해 주듯 친근하게 쓰고, 지역 학원을 하나씩 소개하며 상담에서 물어볼 것으로 잇는다 | — |
| `components/DomainClient.tsx:1187` | tooltip | 입력한 방향성이 이미 강제되는 절대 원칙·공통원칙·작성 지침과 겹치는지 대조하고, 이 글유형만의 방향만 남긴 개선안을 제안합니다. | — |
| `components/DomainClient.tsx:1210` | tooltip | 켜 놓은 축의 값을 LLM 이 이 글유형(이름·방향성·아키타입)에 맞게 제안해 채웁니다. 제안이므로 검토·수정 후 저장하세요. | — |
| `components/DomainClient.tsx:1212` | muted-p | 먼저 이름·방향성을 채우고 쓸 축(persona·intent·modifier)을 ‘사용’으로 켠 뒤 누르면, LLM이 이 글유형에 맞는 값을 제안해 아래 텍스트영역을 채웁니다. 제안일 뿐 자동 저장하지 않으니 반드시 검토·수정한 뒤 저장하세요. (codex/claude CLI 인증 필요) | — |
| `components/DomainClient.tsx:1217` | placeholder | 퇴근 후 배우는 직장인\n주말만 가능한 직장인 (한 줄에 하나씩 · 필수) | — |
| `components/DomainClient.tsx:1221` | placeholder | 필기접수\n준비물 (한 줄에 하나씩 · 필수) | — |
| `components/DomainClient.tsx:1231` | placeholder | 필기시험부터\n상담전확인 (한 줄에 하나씩 · 필수) | — |
| `components/DomainClient.tsx:1240` | muted-p | 먼저 학원 동기화를 실행하면 타입 목록이 표시됩니다. | — |
| `components/DomainClient.tsx:1242` | muted-p | 아직 이 도메인에 동기화된 학원이 없습니다(모든 타입 0건). 학원 타입을 골라도 실제 후보가 없어 지역 가이드/체크리스트로만 작성됩니다 — 먼저 「원천 데이터」 탭에서 학원 동기화를 실행하세요. | — |
| `components/DomainClient.tsx:1253` | muted-p | 위에서 고른 디자인의 레이아웃만 보여주는 예시 목업입니다. 실제 글 내용·방향성·축 값은 반영하지 않습니다. | — |
| `components/DomainClient.tsx:1262` | muted-p | 생성 시점 실제 후보 수로 제목 확정 · 미설정이면 LLM이 H1 결정 | — |
| `components/DomainClient.tsx:1267` | jsx-text | (지역형 + 학원 타입 지정) 글유형에서 의미가 있습니다. 키워드형(가이드·시험 등)은 학원 후보가 0이라 tier가 안 맞아 fallback/LLM 제목으로 갑니다. | — |
| `components/DomainClient.tsx:1275` | muted-p | tier가 없습니다. 「+ tier 추가」로 &quot;후보 N곳 이상일 때 이 제목&quot; 규칙을 만드세요. (없으면 LLM이 제목 결정) | — |
| `components/DomainClient.tsx:1285` | placeholder | 어떤 tier도 안 맞을 때 쓸 제목 (예: {지역} 운전학원 안내) | — |
| `components/DomainClient.tsx:1291` | tooltip | 입력한 내용을 모두 지우고 빈 폼으로 되돌립니다 | — |
| `components/DomainClient.tsx:1416` | confirm | 이 도메인의 학원 자료를 전부 삭제할까요? (검색/지역 필터와 무관하게 모두 삭제) 되돌릴 수 없습니다. | — |
| `components/DomainClient.tsx:1538` | confirm | 지역 축을 기본값(운전 프리셋 지역)으로 초기화할까요? 지금 지역 목록이 덮어써집니다. | — |
| `components/DomainClient.tsx:1594` | tooltip | 지역 축을 운전 프리셋 기본값으로 되돌립니다(테스트용 baseline) | — |
| `components/DomainClient.tsx:1598` | muted-p | 최근 지역 동기화(이 브라우저 기록): {lastSync.regions ? `${formatDateTime(lastSync.regions.at)} · ${lastSync.regions.count.toLocaleString()}개 반영${lastSync.regions.detail ? ` (${lastSync.regions.… | — |
| `components/DomainClient.tsx:1600` | jsx-text | 에만 쓰이며 글 내용은 바꾸지 않습니다(추후 | — |
| `components/DomainClient.tsx:1600` | jsx-text | 연동 시 실측 갱신 예정). 지역 동기화로 축을 교체하면 이 두 값은 비워집니다. | — |
| `components/DomainClient.tsx:1606` | muted-p | 지역이 없습니다. 위 「지역 동기화」 또는 「기본값으로 초기화」로 채우세요. | — |
| `components/DomainClient.tsx:1608` | muted-p | 보통은 위 동기화로 채웁니다. 지역 목록을 수동 조정할 때만 여세요. 한 줄에 하나: 값,가중치,월검색량,KD | — |
| `components/DomainClient.tsx:1627` | tooltip | 지금까지 받은 내용을 저장하지 않고 멈춥니다. 기존 자료는 그대로 남습니다. | — |
| `components/DomainClient.tsx:1627` | tooltip | 이 도메인의 학원 자료를 전부 삭제합니다(되돌릴 수 없음) | — |
| `components/DomainClient.tsx:1630` | muted-p | 최근 동기화: {academySyncedAt ? `${formatDateTime(academySyncedAt)} · 현재 ${remoteTotal.toLocaleString()}곳${lastSync.academies?.detail && !academyAttemptUnapplied ? ` (${lastSync.academi… | — |
| `components/DomainClient.tsx:1640` | muted-p | DrivingPlus 동기화에 없는 검증 자료가 있을 때만 직접 채웁니다. 필수 단계는 아니며, 위 지역·학원 동기화만으로도 글을 생성할 수 있습니다. | — |
| `components/DomainClient.tsx:1643` | muted-p | 학원 1곳의 지역, 이름, 주소, 전화, 검증 메모를 직접 입력합니다. | — |
| `components/DomainClient.tsx:1644` | muted-p | 여러 학원 자료를 JSON 객체 또는 배열로 한 번에 등록합니다. | — |
| `components/DomainClient.tsx:1660` | muted-p | {photoCount ? `사진 ${photoCount}장` : "사진 없음"} · 리뷰 {reviewCount}개 · 블로그 {blogReviewCount}개 | — |
| `components/DomainClient.tsx:1662` | muted-p | {loading ? "불러오는 중..." : "학원이 없습니다. 위 「학원 동기화」로 채우거나 검색 조건을 바꿔보세요."} | — |
| `components/DomainClient.tsx:1756` | confirm | 요청한 개수 ${max.toLocaleString()}개는 글유형당 상한 ${cap.toLocaleString()}개로 제한됩니다.${typeof created === "number" ? | — |
| `components/DomainClient.tsx:1768` | confirm | 작업 큐 등록: ${r.job_id} · ${r.slot_count ?? ids.length}개\\n작업 큐 탭에서 진행상태를 확인하세요. | — |
| `components/DomainClient.tsx:1779` | confirm | ${label}: ${count}개 글 작성을 큐에 등록할까요? | — |
| `components/DomainClient.tsx:1783` | confirm | ${label} 큐 등록: ${r.job_id} · ${r.slot_count ?? count}개\\n작업 큐 탭에서 진행상태를 확인하세요. | — |
| `components/DomainClient.tsx:1815` | muted-p | 활성화된 글유형이 없습니다. 글유형/디자인 탭에서 유형을 켜세요. | — |
| `components/DomainClient.tsx:1850` | muted-p | 아래 필터는 목록 표시와 「현재 검색 N개 작성」 선별에 쓰입니다. | — |
| `components/DomainClient.tsx:1855` | placeholder | 지역/키워드/후보 검색 예: 서울, 강남구 | — |
| `components/DomainClient.tsx:1887` | tooltip | 비우면 규칙/LLM 자동 제목. 입력하면 규칙보다 우선합니다. {지역}/{개수}/{키워드}/{학원명} 은 생성 시점에 치환됩니다. | — |
| `components/DomainClient.tsx:1917` | jsx-text | 아직 작업이 없습니다. 글 생성 탭에서 “1개 테스트 작성”부터 등록하세요. | — |
| `components/DomainClient.tsx:1962` | muted-p | {scoped.length}개 글 · 이미지 {aggImgs}장(평균 {scoped.length ? (aggImgs / scoped.length).toFixed(1) : "0"}장) · 비용 ${aggCost.toFixed(3)} (평균 ${scoped.length ? (aggCost / scoped.length).toF… | — |
| `components/DomainClient.tsx:2006` | confirm | 정말 삭제할까요? 모든 데이터가 삭제됩니다. | — |
| `components/DomainClient.tsx:2007` | muted-p | 도메인 목록·상단 전환 메뉴에서 이 도메인을 구분하는 이름입니다. 글에는 나오지 않으니 운영 편한 대로 적어도 됩니다. | — |
| `components/DomainClient.tsx:2007` | muted-p | 미리보기·발행 글·외부 사이트 CTA에 이 색이 반영됩니다. 저장 후 글 유형/디자인 탭에서도 확인하세요. | — |
| `components/DomainClient.tsx:2007` | muted-p | 이 도메인과 모든 후보·글 데이터가 함께 삭제됩니다. 되돌릴 수 없습니다. | — |
| `components/DomainClient.tsx:2193` | muted-p | 조사 현황을 불러오지 못했습니다. | — |
| `components/DomainClient.tsx:2203` | muted-p | {summary.last_researched_at ? `최근 조사: ${formatDateTime(summary.last_researched_at)}` : "아직 조사한 학원이 없습니다."} {summary.matched < total ? ` · 조사 DB에 없는 학원 ${(total - summary.matched).t… | — |
| `components/DomainClient.tsx:2284` | muted-p | 시·군·구 {sigungu.toLocaleString()} · 읍·면·동 {submunicipal.toLocaleString()} {status.synced_at ? ` · 최근 ${formatDateTime(status.synced_at)}` : ""} {shuttle && shuttle.with_shuttle > 0 … | — |
| `components/DomainClient.tsx:2292` | muted-p | 사전 상태를 불러오지 못했습니다. 갱신을 눌러 다시 받아보세요. | — |
| `components/DomainClient.tsx:2296` | jsx-text | 만 빠지고 경유지·이용 조건은 그대로 나갑니다. 글 생성은 계속됩니다. | — |
| `components/DraftsClient.tsx:67` | muted-p | 검수 대기 목록에서 반려한 글이 여기에 모입니다. 반려해도 본문은 지워지지 않아 나중에 다시 열어볼 수 있습니다. | — |
| `components/DraftsClient.tsx:74` | muted-p | 검수 후 발행한 글이 여기에 기록됩니다. 발행된 글 자체는 검수·내보내기 화면에서 확인합니다. | — |
| `components/DraftsClient.tsx:85` | jsx-text | 최근 생성에서 게이트에 걸린 글이 없음 — 정상입니다. | — |
| `components/JobCard.tsx:81` | muted-p | 예약 {formatDateTime(job.scheduled_at)} · 시작 {formatDateTime(job.started_at)} · 완료 {formatDateTime(job.finished_at)} · 대기 {String(job.payload_obj?.cooldown_sec ?? "-")}초 · 제한 {String… | — |
| `components/NeedDomainClient.tsx:57` | jsx-text | 백엔드가 실행 중인지, `SEO_API_BASE_URL` 설정을 확인하세요. | — |
| `components/PostDetailClient.tsx:56` | muted-p | 원문은 상단의 복사/다운로드 버튼으로 확인합니다. 상세 화면에는 발행 디자인만 표시합니다. | — |
| `components/SettingsClient.tsx:100` | muted-p | 튜토리얼·생성 기본값처럼 이 브라우저의 작업 편의에만 영향을 주는 설정입니다. | — |
| `components/SettingsClient.tsx:110` | muted-p | 도메인 개요나 대시보드에서 「글 생성 / 검수 흐름 시작」(또는 세부 단계 시작)을 누르면 단계별 가이드가 표시됩니다. × 또는 Esc로 이번 안내만 닫을 수 있고, 「더 이상 안 보기」는 이후 자동 제안을 끕니다. | — |
| `components/SettingsClient.tsx:123` | muted-p | 튜토리얼 안에서 「더 이상 안 보기」를 눌러도 여기서 다시 켤 수 있습니다. 설정은 이 브라우저에만 저장됩니다. | — |
| `components/SettingsClient.tsx:135` | muted-p | 「글 후보 만들기 / 글 작성」 화면의 작성 엔진·모델·이미지 옵션 초기값입니다. 자주 쓰는 조합을 저장해두면 매번 다시 고르지 않아도 됩니다. | — |
| `components/SettingsClient.tsx:186` | muted-p | 이 브라우저에만 저장됩니다. 저장 후 이미 열려 있는 작성 화면에는 다음에 그 화면을 다시 열 때부터 반영됩니다. | — |
| `components/SettingsClient.tsx:231` | muted-p | 끈 이유: 원천이 네이버 블로그 검색으로 학원명을 느슨하게 매칭해 다른 학원 글이 섞입니다. 2026-07-27 실측 539건 중 55건(10%)은 학원 고유명이 글 어디에도 없었고, 같은 글 18건이 이름이 비슷한 학원 2~3곳에 중복 배정됐습니다(중앙/천안중앙/북부중앙 등). 10%는 하한선입니다 — 고유명이 지역명인… | — |

</details>
