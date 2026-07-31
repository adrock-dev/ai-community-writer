# 관리자 UI 안내멘트 인벤토리

> **생성물이다. 직접 고치지 마라.** `node scripts/copy-inventory.mjs` 로 다시 만든다.
> 분류·종속 대상은 `scripts/ui-copy-classification.json` 에서 사람이 지정한다.

안내멘트는 대부분 "코드가 강제하는 사실"의 사본이다. 사본은 원본이 바뀌면 썩는다.
이 목록은 **코드를 고칠 때 같이 고쳐야 할 문장**을 찾기 위한 역참조표다.

## 분류

| 급 | 뜻 | 처방 | 건수 |
| --- | --- | --- | --- |
| **A** | 파생 가능 — 코드 상수/설정에서 계산할 수 있는데 손으로 적은 수치·목록 | 재서술을 없애고 값에서 렌더한다 | 11 |
| **B** | 동작 계약 — 코드가 강제하는 규칙의 서술 | 원본을 고치면 반드시 같이 고친다 | 111 |
| **C** | 순수 안내 — 흐름·톤·빈 상태 문구 | 기계 검증 대상 아님 | 185 |
| | | **합계** | **307** |

파일별: `apps/admin-next/components/DomainClient.tsx` 222 · `apps/admin-next/components/AcademyResearchClient.tsx` 16 · `apps/api-nest/src/admin.controller.ts` 12 · `apps/admin-next/components/DashboardClient.tsx` 11 · `apps/admin-next/components/SettingsClient.tsx` 10 · `apps/admin-next/lib/domain-gate.ts` 8 · `apps/admin-next/components/DraftsClient.tsx` 7 · `apps/admin-next/components/PostDetailClient.tsx` 6 · `apps/admin-next/components/AcademyDetailClient.tsx` 4 · `apps/admin-next/components/JobCard.tsx` 4 · `apps/admin-next/components/IntegrationSettingsClient.tsx` 2 · `apps/admin-next/components/AppShell.tsx` 1 · `apps/admin-next/components/NeedDomainClient.tsx` 1 · `apps/admin-next/lib/api.ts` 1 · `apps/admin-next/lib/copy-facts.ts` 1 · `apps/api-nest/src/academy-research.controller.ts` 1

## 지금 이미 어긋난 것 (0건)

인벤토리를 만들면서 발견된, **코드와 다르거나 화면끼리 서로 모순인** 안내멘트다.



## A — 파생 가능 (11건)

코드 상수에서 계산할 수 있는데 손으로 적었다. **값에서 렌더하면 드리프트가 구조적으로 불가능해진다.**

| 위치 | 담체 | 안내멘트 | 종속 대상 |
| --- | --- | --- | --- |
| `apps/admin-next/components/AcademyResearchClient.tsx:129` | confirm | ${scope}, ${size}을 ${RESEARCH_PROVIDER_LABELS[researchProvider]}로 심층조사합니다(백그라운드).\n학원 1곳당 1분 안팎 걸립니다. 진행할까요? | `조사 소요시간(공유 상수 없음)` |
| `apps/admin-next/components/AcademyResearchClient.tsx:177` | confirm | 블로그리뷰를 동기화합니다. 한 곳씩 받아야 해 전체에 ${ACADEMY_SYNC_DURATION_WITH_BLOG} 걸립니다(백그라운드). 수집만 하며 글 생성에는 쓰이지 않습니다. 진행할까요?<br>_2026-07-28 수정. 소요시간을 lib/copy-facts.ts 단일 출처로 옮겼다._ | `apps/admin-next/lib/copy-facts.ts#ACADEMY_SYNC_DURATION_WITH_BLOG` |
| `apps/admin-next/components/DomainClient.tsx:500` | field:action | 이 흐름이 안정적이면 ${WRITE_BATCH_MID}개, 이후 ${WRITE_BATCH_LARGE}개로 확장하세요 — 선별 규칙은 같고 개수만 다릅니다.<br>_버튼 개수를 손으로 적지 않고 상수에서 렌더한다. 2026-07-30 규칙 통일로 「현재 검색/전국 골고루」 이름이 사라져 상수명도 MID/LARGE 로 바뀌었다._ | `apps/admin-next/components/DomainClient.tsx#WRITE_BATCH_MID`<br>`apps/admin-next/components/DomainClient.tsx#WRITE_BATCH_LARGE` |
| `apps/admin-next/components/DomainClient.tsx:818` | confirm | 키워드 마스터를 기본값(운전 프리셋 18개)으로 초기화할까요? 지금 표의 키워드·직접 추가한 값이 덮어써집니다.<br>_현재 18개로 일치. 프리셋에 항목을 더하면 세 곳(679·688·704)이 동시에 거짓이 된다._ | `apps/api-nest/src/constants.ts#PRESETS.driving.keyword` |
| `apps/admin-next/components/DomainClient.tsx:827` | muted-p | 글유형이 고르는 키워드 풀 + SEO 메트릭입니다. 월검색량·경쟁도(KD)는 슬롯 우선순위에 쓰입니다. 직접 편집하거나 「기본값으로 초기화」로 운전 프리셋 18개를 채웁니다. | `apps/api-nest/src/constants.ts#PRESETS.driving.keyword` |
| `apps/admin-next/components/DomainClient.tsx:843` | tooltip | 키워드 마스터를 운전 프리셋 기본값(18개+메트릭)으로 되돌립니다 | `apps/api-nest/src/constants.ts#PRESETS.driving.keyword` |
| `apps/admin-next/components/DomainClient.tsx:1070` | muted-p | 학원 커버리지 (총 {coh.academy.regions_total}개 지역): 충분 {coh.academy.regions_with_min_for_best} · 보장 {coh.academy.regions_guaranteed} · 0 ? "var(--danger)" : undefined }}>부족 {coh.academy.r…<br>_2026-07-28 수정. 20km 하드코딩을 서버값(coh.academy.nearby_km)으로 바꿨다. ACADEMY_NEARBY_MAX_KM 은 env 로 덮이는 값이라 하드코딩이면 환경변수를 바꾸는 순간 화면이 거짓이 됐다._ | `apps/api-nest/src/constants.ts#ACADEMY_NEARBY_MAX_KM` |
| `apps/admin-next/components/DomainClient.tsx:1411` | info-div | &lsquo;실제 후보 수&rsquo;란? 그 지역 글에 소개하려고 선정된 학원 수입니다 — 지역명이 맞는 직접 후보 + {candidateRules?.nearby_km ?? 20}km 이내 인근 후보로 모으고(둘 다 부족하면 {candidateRules?.min_guarantee_km ?? 50}km 이내 최근접으로 보…<br>_2026-07-28 수정. 20km·50km·5곳을 손으로 적고 있었다. 셋 다 env 로 덮이는 값이라 /options 의 candidate_rules 로 내려받아 렌더한다. 이 문단은 info-panel div 라 추출기 사각지대에 있어 인벤토리에도 안 잡혔었다._ | `apps/api-nest/src/constants.ts#ACADEMY_NEARBY_MAX_KM`<br>`apps/api-nest/src/constants.ts#ACADEMY_MIN_GUARANTEE_MAX_KM`<br>`apps/api-nest/src/constants.ts#ACADEMY_USED_PER_POST` |
| `apps/admin-next/components/DomainClient.tsx:2199` | muted-p | 글 작성/중복검사/가지치기/색인 작업을 이 화면에서 바로 확인합니다. 3초마다 자동 새로고침됩니다.<br>_3초는 Jobs 컴포넌트의 폴링 주기, 작업 종류 4가지는 JobKind 를 한국어로 나열한 것이다. 전역 작업 화면(JobsClient)을 없애면서 그 파일의 같은 분류를 여기로 합쳤다. 줄번호를 적지 않는다 — 예전에 :1896 으로 박아 뒀다가 편집으로 밀려 무관한 코드를 가리키고 있었다._ | `apps/admin-next/components/DomainClient.tsx#Jobs setInterval 3000`<br>`apps/api-nest/src/worker.service.ts job types` |
| `apps/admin-next/components/DomainClient.tsx:2308` | muted-p | 생성 글 본문·CTA·HTML 내보내기·공개 API에 나가는 이름입니다. 마지막 섹션 CTA에서 3~7회 언급되므로 독자가 브랜드로 읽을 수 있는 고유명이어야 합니다. 비워 두면 표시 이름({effectiveBrand})이 그대로 쓰입니다.<br>_현재 프롬프트와 일치(3~7회). 같은 문장이 브랜드 폴백 동작(brand.ts)도 함께 설명한다. (종속 표기에서 줄번호를 뗐다 — :1105 로 박혀 있었으나 편집으로 밀려 structureGuide 줄을 가리키고 있었다.)_ | `apps/api-nest/src/brand.ts`<br>`apps/api-nest/src/worker.service.ts#buildPrompt CTA 지침` |
| `apps/admin-next/components/SettingsClient.tsx:237` | muted-p | 켜면 학원 동기화가 {ACADEMY_SYNC_DURATION}에서 {ACADEMY_SYNC_DURATION_WITH_BLOG}으로 늘어납니다(원천이 동시 요청을 못 견뎌 한 곳씩 받습니다). 이미 수집된 자료는 끄더라도 지워지지 않고 학원 상세에 남습니다.<br>_2026-07-28 수정. 소요시간을 lib/copy-facts.ts 단일 출처로 옮겼다._ | `apps/admin-next/lib/copy-facts.ts#ACADEMY_SYNC_DURATION`<br>`apps/admin-next/lib/copy-facts.ts#ACADEMY_SYNC_DURATION_WITH_BLOG` |

## B — 동작 계약 (111건)

코드가 강제하는 규칙을 문장으로 다시 설명한다. 파생이 불가능하므로 **종속 대상이 바뀌면 사람이 같이 고쳐야 한다.**

| 위치 | 담체 | 안내멘트 | 종속 대상 |
| --- | --- | --- | --- |
| `apps/admin-next/components/AcademyDetailClient.tsx:64` | confirm | ${targetName} 학원을 ${RESEARCH_PROVIDER_LABELS[researchProvider]}로 AI 단건 조사합니다.\n1~2분 걸리며 창을 닫아도 서버에서 계속 진행됩니다. 진행할까요? | `apps/api-nest/src/academy-research.service.ts#startSingleResearch` |
| `apps/admin-next/components/AcademyDetailClient.tsx:184` | muted-p | 아래 항목은 원천 동기화로 이미 확인돼 조사 대상에서 빠집니다. 글 생성도 이 값을 씁니다. | `조사 항목 정의`<br>`docs/source-field-usage.md` |
| `apps/admin-next/components/AcademyResearchClient.tsx:165` | confirm | ${runLabel(run)}을(를) 중단할까요? 처리 중이던 학원 1곳은 마친 뒤 멈춥니다. 여기까지 저장된 내용은 남습니다.<br>_「1곳 마친 뒤 중단·여기까지 저장 유지」는 취소 구현에 직접 매달린 약속이다._ | `apps/api-nest/src/academy-research.service.ts 취소 처리` |
| `apps/admin-next/components/AcademyResearchClient.tsx:225` | muted-p | 여기서 받은 기본정보·후기 원문·AI 심층조사는 학원 자료 전용 DB에 모입니다. 도메인은 이 자료를 연결해서 쓰므로, 도메인에서 「연결 끊기」를 하거나 도메인을 지워도 원본과 조사 결과는 그대로 남고 다시 연결하면 복구됩니다. 다만 글 생성이 읽는 것은 연결된 사본이라, 자료를 갱신했으면 도메인에서 다시 연결해야 반영됩… | `apps/api-nest/src/academy-research-db.service.ts`<br>`apps/api-nest/src/academy-link.service.ts#linkToDomain` |
| `apps/admin-next/components/AcademyResearchClient.tsx:351` | muted-p | {run!.cancel_requested ? "중단 요청됨 — 처리 중이던 학원 1곳을 마친 뒤 멈춥니다. 여기까지 저장된 내용은 남습니다." : "서버에서 실행 중입니다. 이 창을 닫거나 새로고침해도 계속 진행되며, 다시 들어오면 진행률이 이어서 보입니다."}<br>_「창을 닫아도 계속·다시 들어오면 진행률이 이어짐」이 백그라운드 run 구현에 종속._ | `apps/api-nest/src/academy-research.service.ts 백그라운드 실행` |
| `apps/admin-next/components/AcademyResearchClient.tsx:489` | muted-p | ⚠️ 수강료·셔틀·운영시간은 원천이 그 학원 값을 주지 않을 때만 쓰입니다. 원천에 구조화된 값이 있으면 그쪽이 이깁니다. | `apps/api-nest/src/db.service.ts#upsertDrivingplusAcademies __manual 폴백` |
| `apps/admin-next/components/AcademyResearchClient.tsx:733` | muted-p | 도메인의 「조사값 신뢰 기준」이 「검증완료만」일 때, 여기서 승인한 값만 글에 쓰입니다. 항목을 하나 골라 값을 나란히 훑고 이상한 것만 체크를 푼 뒤 일괄 승인하세요. 「검토 필요」는 기본 선택에서 빠집니다 — 근거 검사가 짚어 둔 값이라, 하나씩 확인하고 직접 체크해야 승인됩니다. 값을 고치거나 승인을 되돌리려면 학원… | `apps/api-nest/src/academy-research-usage.ts`<br>`apps/api-nest/src/academy-link.service.ts#researchValuesFor` |
| `apps/admin-next/components/AcademyResearchClient.tsx:762` | tooltip | 원천 값을 교차검증하려고 모은 항목(학원명·주소·전화·구·동·지번 등)까지 봅니다. 승인해도 글에는 쓰이지 않습니다. | `apps/api-nest/src/academy-research-article-fields.ts`<br>`apps/api-nest/src/academy-research.controller.ts#reviewQueue` |
| `apps/admin-next/components/AppShell.tsx:179` | jsx-text | 원천 자료가 아직 반영되지 않았습니다. 「학원자료 연결」을 눌러야 글에 쓰입니다. | `apps/api-nest/src/link-freshness.ts`<br>`apps/api-nest/src/admin.controller.ts#pendingLinkFor`<br>`apps/api-nest/src/db.service.ts#upsertDrivingplusAcademies` |
| `apps/admin-next/components/DashboardClient.tsx:149` | muted-p | 운전 도메인을 만들면 지역/키워드 프리셋이 자동으로 들어갑니다. 도메인이 있어야 도메인 관리, 글 생성, 검수·보내기 메뉴를 사용할 수 있습니다. | `apps/api-nest/src/constants.ts#PRESETS`<br>`apps/api-nest/src/admin.controller.ts 도메인 생성` |
| `apps/admin-next/components/DashboardClient.tsx:200` | muted-p | 모든 도메인의 작업을 진행·대기 먼저, 그다음 최신순으로 최대 {DASHBOARD_JOB_ROWS}건 보여줍니다. 운영 대상 하나만 보려면 왼쪽 메뉴에서 엽니다.<br>_정렬 규칙(진행 → 대기 실행순 → 최신순)을 그대로 서술한다. listJobs 의 ORDER BY 를 바꾸면 이 문장이 거짓이 된다. 건수는 DASHBOARD_JOB_ROWS 에서 렌더하므로 손으로 맞출 필요가 없다._ | `apps/api-nest/src/db.service.ts#listJobs ORDER BY` |
| `apps/admin-next/components/DomainClient.tsx:462` | field:body | 이 사이트만의 말투·태도, 절대 넣지 말 제외어, 키워드 마스터를 정합니다. 확인된 데이터만 사용·날조 금지 같은 안전·데이터 규칙은 이미 강제되니 여기 적지 않아도 됩니다. 지금 건너뛰고 나중에 정해도 됩니다.<br>_2026-07-28 수정. 투어가 「안전·데이터 원칙을 정하라」고 안내해 바로 아래 입력칸 안내(「이미 강제되니 적지 마라」)와 모순이었다. 입력칸과 같은 기준으로 맞췄다._ | `apps/api-nest/src/worker.service.ts#buildPrompt 공통원칙 주입` |
| `apps/admin-next/components/DomainClient.tsx:463` | field:body | 글 유형마다 기본 디자인이 자동 적용됩니다. 대부분 그대로 두면 되고, 특별한 레이아웃이 필요할 때만 커스텀 디자인 메모나 커스텀 글유형 복제로 조정합니다.<br>_투어 문구. 아래 디자인 탭 안내와 같은 사실을 말한다 — 한쪽만 고치면 어긋난다._ | `apps/api-nest/src/constants.ts default_design`<br>`docs/design-template-mapping.md` |
| `apps/admin-next/components/DomainClient.tsx:484` | field:body | 2단계 카드의 작성 엔진·모델·이미지 옵션은 글 작성에만 적용됩니다. 작성 대상은 바로 위 「후보 목록」의 필터·체크가 정합니다. 처음엔 「1개 테스트 작성」만 눌러 품질을 확인하세요.<br>_1단계 후보 생성은 LLM·이미지를 쓰지 않는다는 전제. 후보 생성이 LLM을 쓰게 되면 거짓이 된다._ | `apps/api-nest/src/slot.service.ts#generateSlotsForDomain` |
| `apps/admin-next/components/DomainClient.tsx:484` | field:body | 후보가 없으면 이 버튼은 실패합니다 — 맨 위 1단계에서 후보를 먼저 만드세요. 대량 버튼은 1개 테스트로 품질을 확인한 뒤 사용하세요.<br>_작성은 기존 planned 후보만 쓰고 후보가 0이면 400으로 거절한다. 자동 생성이 생기면 이 문장과 2단계 카드 안내를 함께 뒤집어야 한다. 예전에는 반대로 적혀 있었고 인벤토리에 없어 아무도 못 봤다._ | `apps/api-nest/src/admin.controller.ts#enqueueGenerate` |
| `apps/admin-next/components/DomainClient.tsx:497` | field:body | 제목을 눌러 상세 미리보기를 확인하고, 필요한 글을 선택해 Markdown/HTML로 내보내거나 색인 요청을 등록합니다. 글 상세의 「이 글의 근거」는 그 글이 학원·후기·이미지를 얼마나 썼는지와, 「검토 필요」라 못 쓴 값이 무엇인지 보여줍니다. 게이트를 통과 못한 글은 이 목록에 없고 「검수 대기(게이트 미통과)」에 …<br>_게이트 미통과 글은 posts 가 아니라 draft_posts 로 간다는 전제 + 「이 글의 근거」가 보여주는 항목._ | `apps/api-nest/src/quality-gate.ts`<br>`apps/api-nest/src/db.service.ts#insertDraftPost`<br>`apps/admin-next/lib/post-insight.ts` |
| `apps/admin-next/components/DomainClient.tsx:497` | field:body | 테스트 작성이 끝나면 이 화면에 글이 나타납니다. 작업은 끝났는데 목록이 비어 있다면 게이트에서 걸린 것이니 「검수 대기(게이트 미통과)」를 확인하세요.<br>_같은 전제의 빈 상태 안내. 격리가 없어지면 이 안내가 사람을 없는 화면으로 보낸다._ | `apps/api-nest/src/quality-gate.ts`<br>`apps/api-nest/src/db.service.ts#insertDraftPost` |
| `apps/admin-next/components/DomainClient.tsx:757` | muted-p | 생성 프롬프트에 항상 들어갑니다(학원 규칙은 학원 후보를 다루는 글에만). 이 중 금액 날조·전화번호 노출·후보 수 부풀리기처럼 게이트가 완성된 글을 직접 검사하는 항목이 있고, 나머지는 프롬프트 지시입니다. 어느 쪽이든 아래 「공통 작성 원칙」에 다시 적지 마세요 — 강제력은 더 생기지 않고, 그 칸에서만 전달되는 말투… | `apps/api-nest/src/worker.service.ts#buildPrompt`<br>`apps/api-nest/src/quality-gate.ts` |
| `apps/admin-next/components/DomainClient.tsx:771` | muted-p | 글유형에 따라 일부 규칙은 그 유형의 지침이 대신할 수 있습니다. | `apps/api-nest/src/constants.ts 아키타입 writing_guide` |
| `apps/admin-next/components/DomainClient.tsx:791` | muted-p | 이 사이트만의 말투·태도를 적는 칸입니다. 확인된 데이터만 사용·가격/합격률 날조 금지·후보 수 부풀리기 금지 같은 안전·데이터 규칙은 이미 생성 프롬프트와 품질 게이트가 강제하므로 여기에 다시 적지 않아도 됩니다. 오히려 중복해서 채우면 이 칸에서만 전달되는 말투 지시가 묻힙니다. 비우면 프롬프트에 「공통원칙: 없음」으…<br>_2026-07-28 기준 코드와 일치(커밋 8a1134a 로 정정됨). 단 같은 화면의 투어 문구는 아직 옛 안내다 — 아래 항목 참조._ | `apps/api-nest/src/worker.service.ts#buildPrompt 공통원칙 주입`<br>`apps/api-nest/src/constants.ts#DEFAULT_DRIVING_COMMON_PRINCIPLES` |
| `apps/admin-next/components/DomainClient.tsx:792` | muted-p | 한 줄에 하나씩 입력하면 후보 생성, 후보 검색, 작성 큐, 최종 저장 전에 제외됩니다. | `apps/api-nest/src/slot.service.ts`<br>`apps/api-nest/src/worker.service.ts` |
| `apps/admin-next/components/DomainClient.tsx:793` | muted-p | 여러 글에서 똑같이 반복되는 판박이 문장을 한 줄에 하나씩 입력하면, 생성 품질 게이트가 이 문구를 감지해 다른 표현으로 다시 쓰도록(중복 콘텐츠 방지) 합니다. 제외어와 달리 글을 건너뛰지 않고 재작성합니다. | `apps/api-nest/src/quality-gate.ts#boilerplatePhraseIssues`<br>`apps/api-nest/src/worker.service.ts repair` |
| `apps/admin-next/components/DomainClient.tsx:828` | jsx-text | 연동 시 실측값으로 자동 갱신될 예정입니다. (<br>_미구현 예정 선언. 연동되면 지워야 하고, 안 지우면 반대로 거짓이 된다._ | `키워드 메트릭 실측 연동(미구현)` |
| `apps/admin-next/components/DomainClient.tsx:905` | muted-p | 아직 안 켠 빌트인 글 유형입니다(코드 소유·초기화에도 복구). | `apps/api-nest/src/constants.ts#TEMPLATE_SPECS` |
| `apps/admin-next/components/DomainClient.tsx:921` | muted-p | 글 유형마다 기본 디자인이 자동으로 적용됩니다(대부분 그대로 두면 됩니다). 특정 글에 다른 디자인을 쓰려면 위 「커스텀 글유형」에서 그 유형을 복제해 디자인을 바꾸세요. | `apps/api-nest/src/constants.ts default_design`<br>`docs/design-template-mapping.md` |
| `apps/admin-next/components/DomainClient.tsx:933` | muted-p | 기본 디자인 밖의 레이아웃이 필요할 때만. 원하는 구조를 적고, 커스텀 글유형에서 디자인을 ‘커스텀’으로 지정하면 이 메모가 작성 프롬프트로 들어갑니다. | `apps/api-nest/src/worker.service.ts 커스텀 디자인 메모 주입` |
| `apps/admin-next/components/DomainClient.tsx:1010` | muted-p | 검증된 아키타입을 참조해 직접 만든 글유형입니다. 주키워드 규칙·품질 지침은 참조 아키타입을 그대로 씁니다. 만든 뒤 위 「이 도메인의 글 유형」에서 켜야 생성에 쓰입니다. | `apps/api-nest/src/constants.ts 아키타입`<br>`apps/api-nest/src/admin.controller.ts` |
| `apps/admin-next/components/DomainClient.tsx:1010` | muted-p | 「새로고침」은 목록·정합성 미리보기·학원 타입 옵션을 서버에서 다시 불러옵니다. 이 화면에서 만들기/편집/삭제한 뒤엔 자동 갱신되며, 다른 창·다른 사람이 바꾼 경우에만 수동으로 누르면 됩니다.<br>_같은 파일 안의 동작 설명이라 함께 바뀔 가능성이 높지만, 자동 갱신 여부를 단정하므로 분류해 둔다._ | `apps/admin-next/components/DomainClient.tsx` |
| `apps/admin-next/components/DomainClient.tsx:1297` | muted-p | 📐 섹션 순서 자동 다양화 (글마다 자동 선택 · 편집 불가): {structureVariants[kind]!.map((l, i) => {l})} | `apps/api-nest/src/constants.ts structure variants` |
| `apps/admin-next/components/DomainClient.tsx:1302` | muted-p | 이 글유형이 쓸 키워드를 한 줄에 하나씩 적습니다. 적으면 그 키워드를 그대로 사용(아키타입 패턴 무시), 비우면 아키타입 패턴으로 자동 선택. 아래 키워드 마스터에서 클릭하면 추가되고, 마스터에 없는 키워드도 직접 입력할 수 있습니다. | `apps/api-nest/src/slot.service.ts` |
| `apps/admin-next/components/DomainClient.tsx:1303` | placeholder | 운전면허학원\n자동차운전전문학원 (한 줄에 하나 · 비우면 아키타입 패턴)<br>_placeholder 지만 동작을 단정한다 — 위 muted-p 와 같은 사실이라 한쪽만 고치면 어긋난다._ | `apps/api-nest/src/slot.service.ts` |
| `apps/admin-next/components/DomainClient.tsx:1307` | muted-p | ⚠️ 키워드 마스터에 없는 키워드: {unknown.join(", ")} — 지역형 글유형은 영향 없지만, 키워드형은 검색량·경쟁도가 없어 우선순위 0으로 취급돼 대량 선별에서 후순위가 됩니다. 우선순위를 반영하려면 「공통 설정」 탭의 키워드 마스터에 등록하세요. | `apps/api-nest/src/slot.service.ts 우선순위 계산` |
| `apps/admin-next/components/DomainClient.tsx:1326` | tooltip | 입력한 방향성이 이미 강제되는 절대 원칙·공통원칙·작성 지침과 겹치는지 대조하고, 이 글유형만의 방향만 남긴 개선안을 제안합니다. | `apps/api-nest/src/admin.controller.ts 방향성 검증` |
| `apps/admin-next/components/DomainClient.tsx:1328` | muted-p | ✍️ 여기서 정해지는 것: 이 글유형의 말투 격식과 다루는 각도·전개 방식입니다. 말투는 방향성이 최종 결정권을 갖습니다 — “옆자리 선배가 이야기해 주듯”이라고 쓰면 대화체(반말체 아님·이모지 허용)로, “차분한 전문가 설명”이라고 쓰면 전문가 톤(격식체·이모지 절제)으로 글이 달라집니다. | `apps/api-nest/src/worker.service.ts 톤 결정` |
| `apps/admin-next/components/DomainClient.tsx:1329` | muted-p | 🔒 방향성으로 바뀌지 않는 것: 제목 규칙·H2 구성·표/이미지 배치 같은 필수 출력 구조, 축(의도·수식어)이 정하는 강조 섹션과 필수 응답, 그리고 품질 게이트입니다. 게이트는 프롬프트 밖에서 완성된 글을 검사하므로, 방향성에 예외를 적어도 통과되지 않습니다. | `apps/api-nest/src/quality-gate.ts`<br>`apps/api-nest/src/worker.service.ts 필수 출력 구조` |
| `apps/admin-next/components/DomainClient.tsx:1330` | muted-p | 🔎 방향성 검증: 방향성은 이 글유형만의 방향을 적는 자리입니다. 날조 금지·데이터 검증 같은 안전·데이터 규칙은 이미 모든 글에 강제(절대 원칙)되니 방향성에 다시 쓰면 중복이고, 여기서만 전달되는 톤·관점 지시가 묻힙니다. 버튼을 누르면 절대 원칙·공통원칙·아키타입 작성 지침(학원 후보를 다루는 유형이면 학원 전용 … | `apps/api-nest/src/admin.controller.ts` |
| `apps/admin-next/components/DomainClient.tsx:1344` | muted-p | 이 글유형이 쓸 persona·intent·modifier 값입니다. 쓸 축을 켜면 값을 반드시 입력하세요 — 이 값이 유일한 소스이고(도메인 공통 축 폴백 없음), 비어 있으면 그 축은 생성에서 무시됩니다. 한 줄에 하나씩. | `apps/api-nest/src/slot.service.ts axis_values` |
| `apps/admin-next/components/DomainClient.tsx:1345` | muted-p | 📐 축은 글감 라벨에 그치지 않습니다. 「지역 운전학원 축 기반 소개」 계열(아키타입 local_axis)에서는 intent가 반드시 답할 질문을, modifier가 각 학원에서 부각할 관점·강조 섹션 주제·요약표 열을, 둘이 합쳐 제목 부제를 결정합니다. 축 값을 바꾸면 글의 구조가 달라집니다. 자료가 뒷받침하지 못하…<br>_「자료가 뒷받침하지 못하는 축은 자동으로 내려앉는다」는 강등 로직에 직접 종속._ | `apps/api-nest/src/worker.service.ts local_axis` |
| `apps/admin-next/components/DomainClient.tsx:1351` | muted-p | 먼저 이름·방향성을 채우고 쓸 축(persona·intent·modifier)을 ‘사용’으로 켠 뒤 누르면, LLM이 이 글유형에 맞는 값을 제안해 아래 텍스트영역을 채웁니다. 제안일 뿐 자동 저장하지 않으니 반드시 검토·수정한 뒤 저장하세요. (codex/claude CLI 인증 필요)<br>_「제안일 뿐 자동 저장 안 함 · CLI 인증 필요」가 구현에 종속._ | `apps/api-nest/src/admin.controller.ts 축 제안` |
| `apps/admin-next/components/DomainClient.tsx:1374` | muted-p | 이 글유형이 후보로 쓸 학원 타입입니다. 괄호 안 숫자는 이 도메인에 동기화된 학원 수예요. 비우면 학원정보를 쓰지 않고 지역 가이드/체크리스트 중심으로 작성합니다. 지역형 글유형에만 적용됩니다. 단독 소개형(시설 1곳을 다루는 유형)에서는 이 타입이 후보 조건일 뿐 아니라 후보를 만드는 대상 목록이라, 비우면 후보가 하… | `apps/api-nest/src/slot.service.ts academy_type_filter` |
| `apps/admin-next/components/DomainClient.tsx:1395` | muted-p | 글 유형마다 자동 매칭되는 기본 디자인입니다. 아래 목업으로 레이아웃을 확인하세요. 「커스텀」을 고르면 도메인 「디자인」 영역의 커스텀 디자인 메모가 적용됩니다. | `apps/api-nest/src/constants.ts design_presets` |
| `apps/admin-next/components/DomainClient.tsx:1410` | muted-p | 제목을 생성 시점의 실제 후보 수로 확정해 LLM 즉흥·후보 수 부풀림을 막습니다. tier는 후보 수 내림차순으로 첫 매칭 제목을 씁니다(예: 3곳↑ &quot;BEST {"{개수}"}&quot;, 2곳 &quot;추천&quot;). 치환 토큰: {"{지역}"} {"{개수}"} {"{키워드}"} {"{학원명}"}(첫 후… | `apps/api-nest/src/slot.service.ts 제목 tier` |
| `apps/admin-next/components/DomainClient.tsx:1418` | muted-p | 위 &lsquo;실제 후보 수&rsquo;가 이 값보다 적으면 생성하지 않고 건너뜁니다(슬롯 skipped · 후보 부족 지역 차단용). 비우거나 0이면 스킵 없음. | `apps/api-nest/src/slot.service.ts slot skipped` |
| `apps/admin-next/components/DomainClient.tsx:1440` | jsx-text | 참조 아키타입(kind)은 만든 뒤 바꿀 수 없습니다. | `apps/api-nest/src/admin.controller.ts` |
| `apps/admin-next/components/DomainClient.tsx:1731` | muted-p | DrivingPlus 원천 API의 지역·학원 데이터를 가져와 글 생성 프롬프트의 검증된 자료로 씁니다. 지역 → 학원 순서로 한 번 준비해두면 생성 때 다시 열 필요는 없습니다. | `apps/api-nest/src/drivingplus-api.service.ts` |
| `apps/admin-next/components/DomainClient.tsx:1736` | muted-p | 블로그 리뷰 수집: {blogSyncOn === null ? "확인 중" : blogSyncOn ? "켜짐" : "꺼짐"} {blogSyncOn === null ? "" : blogSyncOn ? ` — 학원 동기화가 ${ACADEMY_SYNC_DURATION_WITH_BLOG} 걸립니다. 수집만 하며 글 생성에는 쓰지 …<br>_2026-07-28 수정. 「10분 이상」을 lib/copy-facts.ts 단일 출처로 옮겼다. 남은 종속은 「글 생성에 쓰지 않는다」는 규칙 쪽이다._ | `apps/admin-next/lib/copy-facts.ts#ACADEMY_SYNC_DURATION_WITH_BLOG`<br>`apps/api-nest/src/quality-gate.ts`<br>`apps/api-nest/src/worker.service.ts 프롬프트` |
| `apps/admin-next/components/DomainClient.tsx:1775` | muted-p | 지역(시군구/읍면동) 목록을 가져오고, 옵션을 켜면 region 축을 교체합니다. 아래 옵션은 지역 동기화에만 적용됩니다. | `apps/api-nest/src/drivingplus-api.service.ts` |
| `apps/admin-next/components/DomainClient.tsx:1793` | jsx-text | 지역 목록을 받은 뒤 「학원자료 연결」을 실행하지 않았습니다. 학원의 지역 배정은 연결 시점에 계산되므로, 다시 연결해야 새 지역 목록이 반영됩니다. 내용이 실제로 달라졌는지까지는 알 수 없어, 다시 받은 뒤 연결하지 않은 상태면 표시됩니다. | `apps/api-nest/src/db.service.ts#upsertDrivingplusAcademies bestRegionForAddress`<br>`apps/api-nest/src/db.service.ts#sourceFreshness` |
| `apps/admin-next/components/DomainClient.tsx:1808` | muted-p | 글유형(지역형)이 「지역 × 키워드」 조합을 만들 때 쓰는 지역 풀입니다. 단독 소개형(시설 1곳을 다루는 유형)은 이 풀을 쓰지 않고 연결된 시설 목록에서 후보를 만들며, 지역은 그 시설의 실제 소재지가 됩니다. 키워드 마스터와 동일하게 가중치·월검색량·KD는 슬롯 우선순위 계산에만 쓰이고 글 내용은 바꾸지 않습니다. | `apps/api-nest/src/slot.service.ts 우선순위 계산` |
| `apps/admin-next/components/DomainClient.tsx:1827` | muted-p | 「운전학원 자료」가 원천에서 받아 둔 학원 상세(사진·별점리뷰{blogSyncOn === true ? "·블로그 리뷰" : ""} 포함)와 조사값을 이 도메인으로 가져옵니다. 원천 API 를 다시 호출하지 않아 수십 초면 끝납니다. 원천 자료 자체를 새로 받으려면 「운전학원 자료」 화면에서 동기화하고 여기서 다시 연결하세…<br>_2026-07-28 수정. 「10분 이상」을 lib/copy-facts.ts 단일 출처로 옮겼다. 남은 종속은 「글 생성에 쓰지 않는다」는 규칙 쪽이다._ | `apps/admin-next/lib/copy-facts.ts#ACADEMY_SYNC_DURATION_WITH_BLOG`<br>`apps/api-nest/src/quality-gate.ts`<br>`apps/api-nest/src/worker.service.ts 프롬프트` |
| `apps/admin-next/components/DomainClient.tsx:1844` | jsx-text | 연결된 학원이 없습니다. 학원 자료 없이 생성하면 실제 후보를 인용하지 못하고 지역 가이드·체크리스트 위주로만 쓰입니다. 「운전학원 자료」가 이미 받아 둔 자료를 가져오므로 원천 API 를 다시 호출하지 않습니다. | `apps/api-nest/src/academy-link.service.ts#linkToDomain` |
| `apps/admin-next/components/DomainClient.tsx:1854` | muted-p | 이 도메인에 연결된 학원입니다. 검색·지역으로 찾고, 쓰지 않을 학원은 제외합니다. 글 생성에 쓰는 학원 타입은 글유형별로 정합니다(글유형 탭의 “학원 타입 필터”). | `apps/api-nest/src/slot.service.ts academy_type_filter` |
| `apps/admin-next/components/DomainClient.tsx:1875` | muted-p | 이 도메인에서만 빼 둔 학원입니다. 「학원자료 연결」이 이 목록을 건너뜁니다. 해제하면 그 자리에서 다시 연결됩니다. 자료 원본과 조사값은 「운전학원 자료」에 그대로 남아 다른 도메인에는 영향이 없습니다. | `apps/api-nest/src/academy-link.service.ts#linkToDomain excludedAcademyIds` |
| `apps/admin-next/components/DomainClient.tsx:2067` | muted-p | 글유형을 고르고 개수를 정해 작성 대기 후보(planned)를 만듭니다. LLM은 호출하지 않습니다. | `apps/api-nest/src/slot.service.ts` |
| `apps/admin-next/components/DomainClient.tsx:2087` | muted-p | 개수는 이번에 만들 후보 수입니다(글유형당 한 번에 {slotMax.toLocaleString()}개까지). 지역을 쓰는 글유형은 지역을 골고루 돌며 만들고, 다시 누르면 아직 후보가 적은 지역부터 이어서 채웁니다 — 기존 후보는 그대로 남습니다. 조합이 개수보다 적으면 있는 만큼만 만들고 중복으로 채우지 않습니다.{se…<br>_1단계 동작 설명을 한 문단으로 합친 것(예전에는 조작 칸 위아래로 갈라져 「기존 후보는 그대로 남습니다」가 두 번 나왔다). 상한 숫자는 /options 의 slot_limits 를 렌더하므로 값이 바뀌면 따라온다. 사람이 지켜야 할 부분은 「이번에 만들 개수」·「지역 골고루 + 후보가 적은 지역부터 이어서」·「기존 후보는 남는다」·「조합이 적으면 중복으로 채우지 않는다」는 동작 서술이다. 예전엔 인터리브 그룹이 지역×키워드 토픽이라 상한 40에 지역 14곳만 덮였다 — 그 동작으로 되돌리면 이 문장이 거짓이 된다._ | `apps/api-nest/src/constants.ts#MAX_SLOTS_PER_TEMPLATE`<br>`apps/api-nest/src/slot.service.ts#groupTopicsByRegion 지역 인터리브`<br>`apps/api-nest/src/db.service.ts#countSlotsByRegion 커버리지 순서`<br>`apps/api-nest/src/slot.service.ts#generateSlots 조합 소진 동작` |
| `apps/admin-next/components/DomainClient.tsx:2089` | muted-p | 조합 재료는 「원천 데이터」 탭 지역·「글 공통 설정」 키워드 마스터·「글유형/디자인」 설정을 따릅니다. 프리셋을 적용했다면 별도 동기화 없이도 후보를 만들 수 있습니다. | `apps/api-nest/src/constants.ts#PRESETS`<br>`apps/api-nest/src/slot.service.ts` |
| `apps/admin-next/components/DomainClient.tsx:2099` | muted-p | 여기서 고른 필터는 목록 표시와 아래 2단계 「자동 선별」 버튼에 함께 쓰입니다. 체크한 후보는 2단계 「직접 선택」으로 씁니다.<br>_자동 선별 3개 버튼과 「선택 N개 작성」이 이 필터/체크를 입력으로 쓴다는 주장. 2단계 카드가 목록 아래라는 배치도 포함._ | `apps/api-nest/src/db.service.ts#selectSlotsForBatch 선별 규칙` |
| `apps/admin-next/components/DomainClient.tsx:2108` | tooltip | 선택한 후보를 작성 대기(planned)로 되돌리고 오류 메시지를 지웁니다. 실패한 후보는 이걸 해야 「1개 테스트」·「N개 작성」의 자동 선별에 다시 들어옵니다.<br>_2026-07-30 추가. 「다시 대기로」 버튼의 존재 이유가 이 문장이다 — 자동 선별이 planned 만 고르기 때문에 failed 후보는 되돌리지 않으면 다시 안 뽑힌다. selectSlotsForBatch 가 status 필터를 바꾸면 이 문장이 거짓이 된다. 반대로 「선택 글 작성」은 상태를 안 보므로(worker 가 넘겨받은 slot_id 를 그대로 처리) 재작성 자체는 reset 없이도 된다 — 문장이 「재시도하려면 필수」로 강해지지 않게 주의._ | `apps/api-nest/src/admin.controller.ts#resetSlot`<br>`apps/api-nest/src/db.service.ts#selectSlotsForBatch status='planned'` |
| `apps/admin-next/components/DomainClient.tsx:2129` | muted-p | 위 목록에서 고른 후보를 생성 작업 큐에 넣습니다. 후보가 없으면 먼저 1단계 ‘글 후보 만들기’로 후보를 만든 뒤 작성하세요. (작성 버튼은 후보를 자동 생성하지 않습니다.) | `apps/api-nest/src/slot.service.ts` |
| `apps/admin-next/components/DomainClient.tsx:2156` | tooltip | 위 목록에서 체크한 후보만 씁니다. 자동 선별과 달리 상태·지역을 보지 않으므로 이미 발행된 후보도 다시 씁니다.<br>_「선택 N개 작성」 툴팁. slot_ids 경로가 슬롯 상태·지역을 보지 않는다는 사실에 종속(자동 선별 3개와 다른 유일한 규칙)._ | `apps/api-nest/src/admin.controller.ts slot_ids` |
| `apps/admin-next/components/DomainClient.tsx:2159` | muted-p | 추천: 1개 테스트 작성 → QA 확인 → {WRITE_BATCH_MID}개 → {WRITE_BATCH_LARGE}개. 「자동 선별」 세 버튼은 개수만 다르고 선별 규칙은 같습니다 — {WRITE_BATCH_RULE}. 무작위로 뽑지 않습니다: 지역이 겹치면 같은 지역 글끼리 내용이 겹치기 때문에 지역을 최대한 벌립니다.<br>_「개수만 다르고 규칙은 같다」와 「무작위로 뽑지 않는다」는 주장. 규칙 문장 자체는 lib/copy-facts.ts#WRITE_BATCH_RULE 를 렌더한다. 버튼이 「자동 선별」·「직접 선택」 두 줄로 나뉘어 있어 이름으로 그 묶음을 가리킨다._ | `apps/admin-next/components/DomainClient.tsx#WRITE_BATCH_MID`<br>`apps/admin-next/components/DomainClient.tsx#WRITE_BATCH_LARGE`<br>`apps/api-nest/src/db.service.ts#selectSlotsForBatch 선별 규칙` |
| `apps/admin-next/components/DomainClient.tsx:2179` | tooltip | 비우면 규칙/LLM 자동 제목. 입력하면 규칙보다 우선합니다. {지역}/{개수}/{키워드}/{학원명} 은 생성 시점에 치환됩니다.<br>_수동 제목이 규칙보다 우선한다는 순서와 치환 토큰 목록이 구현에 종속._ | `apps/api-nest/src/slot.service.ts 제목 규칙` |
| `apps/admin-next/components/DomainClient.tsx:2202` | muted-p | 대기/진행 작업이 멈춰 있으면 서버 터미널에서 npm run worker:once를 실행해 처리할 수 있습니다. | `package.json#worker:once` |
| `apps/admin-next/components/DomainClient.tsx:2262` | muted-p | 비용($)은 종량 API 사용 시에만 계측됩니다. 이미지는 OpenAI 이미지 API + SEO_IMAGE_PRICE_USD(장당 단가) 설정, 텍스트는 API LLM이 필요합니다. Codex/구독 경로는 $0으로 표시됩니다. | `apps/api-nest/src/worker.service.ts 비용 계측`<br>`SEO_IMAGE_PRICE_USD` |
| `apps/admin-next/components/DomainClient.tsx:2289` | muted-p | 체크한 빌트인만 「글유형/디자인」 탭의 빌트인 추가 카탈로그·커스텀 시작점·참조 아키타입 목록에 노출됩니다. 모든 도메인 공통이며, 이미 켜 둔 유형의 생성에는 영향이 없습니다(노출만 제어). 유형 검증이 끝나면 제거할 임시 기능입니다. 사용 중단으로 표시된 유형은 켤 수 없습니다(요청이 와도 서버가 걸러냅니다).<br>_「유형 검증이 끝나면 제거할 임시 기능」 — 제거 시 이 문단도 함께 사라져야 한다._ | `apps/api-nest/src/admin.controller.ts 빌트인 노출 설정` |
| `apps/admin-next/components/DomainClient.tsx:2308` | muted-p | 발행 글을 Google Indexing API로 색인 요청하는 기능입니다. 배포 연동 방식이 정해지면 활성화 예정이며, 현재는 동작하지 않습니다. (서비스계정 JSON은 전 도메인 공통으로 관리될 예정) | `apps/api-nest/src/worker.service.ts indexing job(제출 skip)` |
| `apps/admin-next/components/DomainClient.tsx:2449` | field:help | 조사값을 글에 전혀 쓰지 않습니다. 글은 원천 동기화로 받은 학원 자료(주소·전화·수강료·셔틀·영업시간·운영 과정·운영 형태·사진 등)와 자체 수강생 후기만 근거로 씁니다.<br>_정책 자체가 아직 생성에 연결되지 않았지만, 같은 패널 바로 아래 ⚠️ 경고가 그 사실을 밝히므로 문구는 그대로 둔다. 연결되는 순간 세 문장이 동시에 검증 대상이 된다._ | `조사값 사용 게이트(미구현)` |
| `apps/admin-next/components/DomainClient.tsx:2454` | field:help | 위 원천 자료·후기에 더해, 조사값 중에서는 사람이 학원 상세 화면에서 「검증완료」로 올린 것만 씁니다. AI가 조사한 채로 둔 값은 쓰지 않습니다. | `조사값 사용 게이트(미구현)` |
| `apps/admin-next/components/DomainClient.tsx:2459` | field:help | 위 원천 자료·후기에 더해, 사람이 확인하지 않은 AI 조사값까지 씁니다. 검사에 걸리지 않았을 뿐 사실 확인은 안 된 값입니다. | `조사값 사용 게이트(미구현)` |
| `apps/admin-next/components/DomainClient.tsx:2496` | muted-p | 원천에 없는 항목(편의시설·자체 시험장·야간반·설립연도 등)을 공개 자료에서 조사해 둡니다. 조사 결과는 학원 1곳에 하나로 저장되며 도메인 사본이 아닙니다 — 여기 숫자는 「이 도메인에 연결된 학원 중 글에 쓸 값이 있는 곳이 몇 곳인가」를 대조해 보여주는 것입니다. 그래서 실행은 자료관리에서 한 번만 하고, 결과는 그… | `apps/api-nest/src/academy-research-db.service.ts#academy_research`<br>`apps/api-nest/src/admin.controller.ts#researchSummary`<br>`academy-research 저장소` |
| `apps/admin-next/components/DomainClient.tsx:2522` | tooltip | 글에 실릴 수 있는 항목(편의시설·자체 시험장·야간반 등)에 값이 하나라도 있는 학원입니다. 원천 교차검증용 항목만 채워진 학원은 조사를 마쳤어도 여기 들어가지 않습니다. | `apps/api-nest/src/academy-research-db.service.ts#summarizeByExternalIds`<br>`apps/api-nest/src/academy-research-article-fields.ts#ARTICLE_RESEARCH_FIELDS` |
| `apps/admin-next/components/DomainClient.tsx:2525` | tooltip | 조사를 시도했지만 신뢰할 공개 자료를 찾지 못한 학원입니다. 다시 돌려도 대개 그대로입니다. | `apps/api-nest/src/academy-research-db.service.ts#recordResearchAttempt` |
| `apps/admin-next/components/DomainClient.tsx:2526` | tooltip | 조사 중 오류로 끝난 학원입니다. 자료관리에서 「실패·근거 없음만」으로 다시 돌릴 수 있습니다. | `apps/admin-next/components/AcademyResearchClient.tsx 재조사 범위 선택` |
| `apps/admin-next/components/DomainClient.tsx:2527` | tooltip | 아직 한 번도 조사하지 않은 학원입니다. 자료관리에서 조사를 돌리면 채워집니다. | `apps/api-nest/src/academy-research-db.service.ts#summarizeByExternalIds` |
| `apps/admin-next/components/DomainClient.tsx:2533` | tooltip | 자료관리 검토 대기 화면과 같은 기준입니다 — 글에 실릴 수 있는 항목만, 연결 중인 학원만 셉니다. | `apps/api-nest/src/academy-research-db.service.ts#summarizeByExternalIds`<br>`apps/api-nest/src/academy-research-db.service.ts#listReviewQueue` |
| `apps/admin-next/components/DomainClient.tsx:2534` | tooltip | 사람이 「검증완료」로 올린 값입니다. 「검증완료만」 설정이면 이 값들만 글에 쓰입니다. | `apps/api-nest/src/academy-research-usage.ts`<br>`apps/api-nest/src/academy-link.service.ts#researchValuesFor` |
| `apps/admin-next/components/DomainClient.tsx:2577` | muted-p | 어느 설정에서도 「검토 필요」(수집한 근거에서 확인되지 않았거나 그 항목에 담기면 안 되는 값)와 「미확인」 값은 쓰이지 않습니다. 조사 대상이 아니었던 항목(원천 자료가 이미 있는 수강료·셔틀 등)도 마찬가지입니다. 합격률과 원천 값을 교차검증하려고 모은 항목(학원명·주소·전화·구·동·지번)은 검증완료로 올려도 글에 나… | `apps/api-nest/src/academy-research-usage.ts`<br>`apps/api-nest/src/academy-research-article-fields.ts`<br>`apps/api-nest/src/academy-link.service.ts#researchValuesFor` |
| `apps/admin-next/components/DomainClient.tsx:2583` | muted-p | 이 설정은 어느 정도 확인된 값까지 믿을 것인가만 정합니다. 틀린 값은 어느 글유형에서든 똑같이 틀리므로 도메인 단위로 한 번만 정합니다. 어느 글에 실제로 쓰이는지는 글유형이 정합니다 — 조사값은 학원 자료에 얹혀 들어가므로, 글유형의 「학원 타입 필터」가 비어 학원 자료를 쓰지 않는 글유형(면허 제도·시험 가이드 등)… | `apps/api-nest/src/worker.service.ts#resolveAcademyTypes` |
| `apps/admin-next/components/DomainClient.tsx:2588` | muted-p | 바꾸면 곧바로 이 도메인에 다시 연결해 반영합니다(원천 API 를 호출하지 않아 1초 안에 끝납니다). 조사값 자체를 새로 받으려면 「운전학원 자료」에서 조사를 돌린 뒤 「학원자료 연결」을 누르세요. | `apps/api-nest/src/admin.controller.ts#updateDomain 자동 재연결`<br>`apps/api-nest/src/academy-link.service.ts#linkToDomain` |
| `apps/admin-next/components/DomainClient.tsx:2637` | muted-p | 읍·면·동 단위 행정구역 목록입니다. 셔틀 안내문·정류장명에서 어느 지역까지 셔틀이 오는지 판별하는 데 씁니다. 도메인과 무관한 공용 자료라 한 번 받으면 모든 도메인에 적용되고, 도메인을 만들 때 자동으로 준비됩니다. 아래 버튼은 행정구역이 개편됐을 때처럼 다시 받아야 할 때만 쓰면 됩니다. | `apps/api-nest/src/admin.controller.ts 도메인 생성` |
| `apps/admin-next/components/DomainClient.tsx:2666` | jsx-text | 사전을 받은 뒤 「학원자료 연결」을 실행하지 않았습니다. 지금 학원에 붙어 있는 셔틀 운행 지역은 그 이전 사전으로 계산된 값입니다. 내용이 실제로 달라졌는지까지는 알 수 없어, 다시 받은 뒤 연결하지 않은 상태면 표시됩니다. | `셔틀 지역 판정`<br>`apps/api-nest/src/db.service.ts#sourceFreshness` |
| `apps/admin-next/components/DomainClient.tsx:2682` | muted-p | 갱신해도 지역 축·학원 지역 배정은 바뀌지 않습니다(1·2단계와 별도 표를 씁니다). 셔틀 운행 지역은 학원자료를 가져오는 시점에 계산되므로, 사전을 새로 받은 뒤에는 2단계 「학원자료 연결」을 다시 눌러야 반영됩니다. | `셔틀 지역 판정` |
| `apps/admin-next/components/DraftsClient.tsx:81` | muted-p | 품질 게이트를 통과하지 못한 글이 생기면 버려지지 않고 여기에 자동으로 보관됩니다. 지금 비어 있는 이유는 보통 둘 중 하나입니다. | `draft 격리 훅` |
| `apps/admin-next/components/DraftsClient.tsx:86` | jsx-text | 실패한 글은 소급 보관되지 않습니다. 당시에는 본문이 그대로 폐기됐기 때문입니다. | `draft 격리 훅` |
| `apps/admin-next/components/DraftsClient.tsx:176` | muted-p | 품질 게이트에 걸려 발행되지 못한 글입니다. B(안전·사실) 이슈가 있으면 발행할 수 없고, 본문을 수정해 재검증해야 합니다. A(구조/문체)만 남으면 사유를 확인한 뒤 발행할 수 있습니다. | `apps/api-nest/src/quality-gate.ts`<br>`draft 격리 게이트` |
| `apps/admin-next/components/DraftsClient.tsx:229` | muted-p | 안전·사실(B) 이슈가 있어 바로 발행할 수 없습니다. 아래에서 본문을 수정하고 재검증해 B 이슈를 해소하세요. | `apps/api-nest/src/quality-gate.ts`<br>`draft 격리 게이트` |
| `apps/admin-next/components/IntegrationSettingsClient.tsx:14` | muted-p | 구글 색인 설정은 도메인 관리 &gt; 설정 탭으로 이동되었습니다. 현재는 비활성(추후 지원 예정) 상태입니다. | `apps/api-nest/src/worker.service.ts indexing job(제출 skip)` |
| `apps/admin-next/components/IntegrationSettingsClient.tsx:18` | muted-p | 배포 연동 방식이 정해지면 색인 기능을 활성화할 예정입니다. 그 전까지는 별도 연동 설정이 없습니다. | `apps/api-nest/src/worker.service.ts indexing job(제출 skip)` |
| `apps/admin-next/components/JobCard.tsx:162` | jsx-text | 입니다. 쓰고 있던 글이 끝나면 그 자리에서 멈추고, 작업자가 응답하지 않더라도<br>_취소는 협조적이라 슬롯 경계에서만 확인한다. 즉시 중단으로 바꾸면 이 문장이 거짓이 된다._ | `apps/api-nest/src/worker.service.ts#processGenerate` |
| `apps/admin-next/components/JobCard.tsx:162` | jsx-text | 까지는 자동으로 정리됩니다. 그때까지는 오류가 아닙니다.<br>_시각 자체는 서버가 계산한 stale_recover_at 을 렌더한다. 자동 정리가 사라지거나 조건이 바뀌면 이 문장이 거짓이 된다._ | `apps/api-nest/src/db.service.ts#jobStaleRecovery`<br>`apps/api-nest/src/db.service.ts#recoverStaleRunningJobs` |
| `apps/admin-next/components/JobCard.tsx:164` | jsx-text | ⚠️ 작업자 응답이 끊겼습니다. 이대로면<br>_응답 없는 잡을 실패로 정리하는 동작의 서술._ | `apps/api-nest/src/db.service.ts#recoverStaleRunningJobs` |
| `apps/admin-next/components/PostDetailClient.tsx:89` | jsx-text | 근거 검사에 걸려 이 글에 들어가지 못했습니다. 값을 고쳐 승인하면 다음 생성부터 쓰입니다. | `apps/api-nest/src/post-insight.controller.ts#blockedForAcademies`<br>`apps/api-nest/src/academy-research-usage.ts` |
| `apps/admin-next/components/PostDetailClient.tsx:111` | muted-p | 보냈지만 본문에 나타나지 않은 값입니다. 결함이 아닙니다 — 5곳이 다 가진 편의시설처럼 비교 정보가 아니면 모델이 버리는 것이 맞습니다. | `apps/api-nest/src/post-insight.controller.ts#unusedResearchLines`<br>`apps/api-nest/src/academy-research-article-fields.ts` |
| `apps/admin-next/components/SettingsClient.tsx:111` | muted-p | 도메인 개요나 대시보드에서 「글 생성 / 검수 흐름 시작」(또는 세부 단계 시작)을 누르면 단계별 가이드가 표시됩니다. × 또는 Esc로 이번 안내만 닫을 수 있고, 「더 이상 안 보기」는 이후 자동 제안을 끕니다. | `apps/admin-next/lib/tour.ts` |
| `apps/admin-next/components/SettingsClient.tsx:196` | muted-p | 도메인 생성 시 고르는 업종 목록입니다. key는 프리셋·프롬프트에 쓰는 슬러그, 표시명은 화면 표시용입니다. 새 업종은 전용 프리셋이 없어 도메인이 빈 축으로 시작합니다(현재 실질 생성은 driving 기준). 이 설정은 서버에 저장되어 즉시 반영됩니다. | `apps/api-nest/src/constants.ts#PRESETS`<br>`apps/api-nest/src/admin.controller.ts` |
| `apps/admin-next/components/SettingsClient.tsx:227` | muted-p | 수집만 켜고 끕니다. 글 생성에는 어느 쪽이든 쓰지 않습니다. 생성 프롬프트와 품질 게이트에서 이미 빠져 있어, 켜도 글 내용이 달라지지 않습니다. 글에 다시 쓰려면 블로그 글이 실제 그 학원의 글인지 건별로 가려내는 검증 기능이 먼저 필요합니다. 그런 기능이 생긴다면 검증을 통과한 것만 골라 쓰는 방식을 검토해볼 만합니… | `apps/api-nest/src/worker.service.ts 프롬프트`<br>`apps/api-nest/src/quality-gate.ts` |
| `apps/admin-next/components/SettingsClient.tsx:251` | jsx-text | 서버에 저장되어 즉시 반영됩니다(재시작 불필요). | `apps/api-nest/src/admin.controller.ts settings/verticals` |
| `apps/admin-next/lib/api.ts:23` | lib-string | 콘텐츠 API에 연결할 수 없습니다<br>_프록시·base URL 설정에 매달린 진단 문구다._ | `apps/admin-next/app/api/admin/[...path]/route.ts`<br>`SEO_API_BASE_URL` |
| `apps/admin-next/lib/copy-facts.ts:33` | lib-string | 작성 대기(planned)만 · 위 목록의 상태·유형·검색 필터 반영 · 글유형마다 최소 1건 · 나머지는 지역을 골고루 · 같은 지역+키워드는 1건<br>_자동 선별 규칙을 사람 말로 옮긴 문장. 세 버튼 툴팁·추천 안내가 이것을 읽는다. selectSlotsForBatch 를 고치면 반드시 같이 고쳐라 — 기계가 판정할 수 없다._ | `apps/api-nest/src/db.service.ts#selectSlotsForBatch 선별 규칙` |
| `apps/admin-next/lib/domain-gate.ts:12` | lib-string | 도메인을 만든 뒤 원천 데이터 동기화 → 후보 생성 → 테스트 작성 순서로 진행하세요.<br>_권장 순서를 단정한다 — 후보 생성이 선행 조건이라는 사실에 매달린다._ | `apps/api-nest/src/slot.service.ts` |
| `apps/api-nest/src/admin.controller.ts:155` | api-error | 등록되지 않은 업종입니다. 작업환경에서 먼저 추가하세요.<br>_업종 레지스트리 검증 결과를 사용자에게 설명한다._ | `apps/api-nest/src/admin.controller.ts 업종 검증`<br>`apps/api-nest/src/db.service.ts getVerticals` |
| `apps/api-nest/src/admin.controller.ts:332` | api-error | LLM 호출 실패: ${result.error \|\| "빈 응답"} (codex/claude CLI 설치·인증 확인)<br>_LLM 실행 경로가 CLI 서브프로세스라는 사실에 매달린다. 프로바이더 방식이 바뀌면 안내가 거짓이 된다. 종속이 worker.service.ts 로 등록돼 있었는데 runLlm 은 llm-runner.ts 로 공용 추출됐고, 그래서 러너를 고쳐도 이 문구가 경고에 걸리지 않았다(llm-runner 에는 이미 CLI 가 아닌 openai_responses 경로가 있다)._ | `apps/api-nest/src/llm-runner.ts runLlm` |
| `apps/api-nest/src/admin.controller.ts:334` | api-error | LLM 응답에서 축 값을 추출하지 못했습니다. 다시 시도해 주세요. | `apps/api-nest/src/admin.controller.ts 축 제안` |
| `apps/api-nest/src/admin.controller.ts:348` | api-error | 검증할 방향성(direction)을 입력하세요. | `apps/api-nest/src/admin.controller.ts 방향성 검증` |
| `apps/api-nest/src/admin.controller.ts:359` | api-error | LLM 응답을 해석하지 못했습니다. 다시 시도해 주세요. | `apps/api-nest/src/admin.controller.ts 방향성 검증` |
| `apps/api-nest/src/admin.controller.ts:613` | api-error | 안전·사실(B) 이슈가 남아 있어 발행할 수 없습니다. 본문을 수정해 재검증하세요.<br>_DraftsClient 의 같은 규칙 설명 2건과 한 몸이다 — 등급 기준이 바뀌면 세 곳을 같이 고쳐야 한다._ | `apps/api-nest/src/quality-gate.ts`<br>`draft 격리 게이트` |
| `apps/api-nest/src/admin.controller.ts:882` | api-error | 작성할 planned 후보가 없습니다. 먼저 「글 생성」 탭 1단계의 「글 후보 만들기」로 후보를 만든 뒤 작성하세요. (검색어·유형·제외 목록도 확인하세요.)<br>_후보가 없을 때의 대처를 안내하며 버튼 이름(「글 후보 만들기」)과 그 위치(「글 생성」 탭 1단계)를 부른다 — 화면 흐름·버튼 이름이 바뀌면 같이 고쳐야 한다._ | `apps/api-nest/src/slot.service.ts` |
| `apps/api-nest/src/admin.controller.ts:1075` | api-error | 업종 key는 영문 소문자·숫자·하이픈만 사용하세요.<br>_검증 정규식과 한 몸이다._ | `apps/api-nest/src/admin.controller.ts 업종 key 검증` |
| `apps/api-nest/src/admin.controller.ts:1086` | api-error | 기본 업종(driving)은 삭제할 수 없습니다. | `apps/api-nest/src/constants.ts#DEFAULT_DRIVING_VERTICAL` |
| `apps/api-nest/src/admin.controller.ts:1088` | api-error | 이 업종을 쓰는 도메인이 ${inUse}개 있어 삭제할 수 없습니다. | `apps/api-nest/src/admin.controller.ts 업종 삭제` |
| `apps/api-nest/src/admin.controller.ts:1090` | api-error | 최소 1개 업종은 남겨야 합니다. | `apps/api-nest/src/admin.controller.ts 업종 삭제` |

## C — 순수 안내 (185건)

흐름 설명·투어 문구·빈 상태 문구. 사실을 주장하지 않으므로 코드 변경과 무관하다.
새로 추가된 문장이 사실을 주장하는데 C 로 남아 있는지는 `node scripts/copy-inventory.mjs --untagged` 로 점검한다.

<details><summary>전체 185건 펼치기</summary>

| 위치 | 담체 | 안내멘트 | 종속 대상 |
| --- | --- | --- | --- |
| `apps/admin-next/components/AcademyDetailClient.tsx:257` | muted-p | 조사된 셔틀 노선이 없습니다. | — |
| `apps/admin-next/components/AcademyDetailClient.tsx:273` | jsx-text | 수집된 후기가 없습니다. 원천에서 이 학원만 다시 받아 볼 수 있습니다. | — |
| `apps/admin-next/components/AcademyResearchClient.tsx:106` | confirm | DrivingPlus 전체 학원정보를 동기화합니다. 기존 원본 정보와 리뷰 원문이 갱신됩니다. 진행할까요? | — |
| `apps/admin-next/components/AcademyResearchClient.tsx:150` | confirm | 직접 등록한 「${row.name \|\| row.external_id}」을(를) 삭제할까요?\n조사 결과와 검토 상태도 함께 지워집니다. 되돌릴 수 없습니다. | — |
| `apps/admin-next/components/AcademyResearchClient.tsx:320` | jsx-text | 기본은 미시도·실패 학원만 대상입니다. | — |
| `apps/admin-next/components/AcademyResearchClient.tsx:380` | tooltip | 원천 목록에서 내려간 항목입니다. 자료는 보관하되 목록·동기화 대상에서 제외합니다. | — |
| `apps/admin-next/components/AcademyResearchClient.tsx:396` | tooltip | 원천 동기화가 아니라 사람이 직접 등록한 학원입니다. | — |
| `apps/admin-next/components/AcademyResearchClient.tsx:413` | jsx-text | 동기화된 학원이 없습니다. 원천에서 학원 목록과 후기를 먼저 받아야 합니다. | — |
| `apps/admin-next/components/AcademyResearchClient.tsx:485` | muted-p | 원천 동기화 목록에 없는 학원을 직접 넣습니다. 필수는 이름 하나이며, 나머지는 근거로 확인한 것만 채우세요. 여기 등록한 학원은 동기화를 다시 돌려도 사라지지 않고, AI 조사 대상에도 함께 들어갑니다. | — |
| `apps/admin-next/components/AcademyResearchClient.tsx:698` | confirm | ${label} ${selected.length}건을 「검증완료」로 올립니다.\n체크를 푼 ${unchecked.size}건은 그대로 둡니다. 진행할까요? | — |
| `apps/admin-next/components/DashboardClient.tsx:102` | muted-p | 운전면허·운전학원 도메인의 콘텐츠 생성·발행 작업을 운영하는 내부 관리자 화면입니다. | — |
| `apps/admin-next/components/DashboardClient.tsx:108` | muted-p | ℹ️ 현재 범위 — 이 관리자는 운전면허·운전학원(driving) 글 생성에 특화되어 구현돼 있습니다. 프리셋·글유형·품질 규칙이 이 주제 기준이라, 다른 주제의 글은 생성되더라도 품질을 보장할 수 없습니다. (업종은 추가할 수 있으나 전용 프리셋·품질은 아직 운전면허·운전학원에만 적용) | — |
| `apps/admin-next/components/DashboardClient.tsx:120` | muted-p | 생성 글 본문·CTA에 나가는 이름입니다. 비우면 표시 이름을 그대로 씁니다. 나중에 설정 탭에서 바꿀 수 있습니다. | — |
| `apps/admin-next/components/DashboardClient.tsx:158` | muted-p | 전체 도메인의 후보·대기·발행 상태를 보고 필요한 화면으로 이동합니다. | — |
| `apps/admin-next/components/DashboardClient.tsx:230` | field:desc | 새 도메인입니다. 원천 데이터·공통 설정(선택)을 준비하고 글 유형을 켜면 후보를 만들 수 있어요. | — |
| `apps/admin-next/components/DashboardClient.tsx:231` | field:desc | 글 유형은 켜져 있습니다. 지역을 동기화하고 「학원자료 연결」로 학원 자료를 가져온 뒤 후보를 만드세요. | — |
| `apps/admin-next/components/DashboardClient.tsx:232` | field:desc | ${(domain.planned_count ?? 0).toLocaleString()}개 대기 후보 중 하나만 먼저 작성해 품질을 확인하세요. | — |
| `apps/admin-next/components/DashboardClient.tsx:233` | field:desc | ${(domain.published_count ?? 0).toLocaleString()}개 발행 글을 미리보기/export/indexing으로 마감하세요. | — |
| `apps/admin-next/components/DashboardClient.tsx:234` | field:desc | 운영을 시작할 후보를 먼저 만들어야 합니다. | — |
| `apps/admin-next/components/DomainClient.tsx:95` | field:desc | 글유형 켜기 → 원천 데이터 → 후보 → 테스트 작성까지 순서대로 안내하는 생성 흐름 | — |
| `apps/admin-next/components/DomainClient.tsx:96` | field:desc | 작업 상태와 완성 글을 확인하고 export/indexing으로 넘기는 마감 흐름 | — |
| `apps/admin-next/components/DomainClient.tsx:102` | field:desc | 선택 준비(원천·공통설정·디자인) 후 글유형 켜기 → 생성 · 필요한 단계만 눌러도 됩니다 | — |
| `apps/admin-next/components/DomainClient.tsx:104` | field:desc | 지역 동기화 · 학원자료 연결(선택) | — |
| `apps/admin-next/components/DomainClient.tsx:105` | field:desc | 공통원칙·제외어·키워드(선택) | — |
| `apps/admin-next/components/DomainClient.tsx:107` | field:desc | 만들 글 유형 선택(새 도메인 필수) | — |
| `apps/admin-next/components/DomainClient.tsx:114` | field:desc | 생성 이후 확인, 내보내기, 색인 요청 | — |
| `apps/admin-next/components/DomainClient.tsx:148` | field:body | 왜 이 정보를 찾는지 공감한 뒤, 글에서 바로 얻을 수 있는 내용을 짧게 알려줍니다. | — |
| `apps/admin-next/components/DomainClient.tsx:149` | field:body | 절차, 비용, 기간을 순서대로 풀고 중간에 이미지를 배치합니다. | — |
| `apps/admin-next/components/DomainClient.tsx:150` | field:body | 처음 등록해도 되나요?\|주말에도 가능한가요?\|추가 비용은 언제 생기나요? | — |
| `apps/admin-next/components/DomainClient.tsx:151` | field:body | 주변 학원 찾기나 예약 확인으로 부드럽게 연결합니다. | — |
| `apps/admin-next/components/DomainClient.tsx:162` | field:body | 가격, 셔틀, 주말 수업, 도로주행 코스를 같은 기준으로 맞춰 비교합니다. | — |
| `apps/admin-next/components/DomainClient.tsx:163` | field:body | 표 아래에는 왜 이 항목이 중요한지 짧게 해석하는 문단이 붙습니다. | — |
| `apps/admin-next/components/DomainClient.tsx:164` | field:body | 직장인, 대학생, 장롱면허처럼 상황별 추천을 분리합니다. | — |
| `apps/admin-next/components/DomainClient.tsx:165` | field:body | 가까운 학원과 예약 가능한 시간을 확인하도록 연결합니다. | — |
| `apps/admin-next/components/DomainClient.tsx:176` | field:body | 송파, 잠실, 문정처럼 생활권이 다른 사용자의 이동 동선을 나눠 설명합니다. | — |
| `apps/admin-next/components/DomainClient.tsx:177` | field:body | 집/학교와 가까운지\|셔틀 시간이 맞는지\|도로주행 코스가 어렵지 않은지 | — |
| `apps/admin-next/components/DomainClient.tsx:178` | field:body | 퇴근 후 수업을 잡을 수 있어서 주말에 몰아서 배우는 부담이 줄었다는 식의 현실적인 후기를 넣습니다. | — |
| `apps/admin-next/components/DomainClient.tsx:179` | field:body | 내 위치 기준으로 가까운 학원을 찾도록 연결합니다. | — |
| `apps/admin-next/components/DomainClient.tsx:190` | field:body | 신분증, 시험 시간, 코스 확인처럼 놓치면 바로 문제가 되는 항목을 맨 위에 둡니다. | — |
| `apps/admin-next/components/DomainClient.tsx:191` | field:body | 신분증 챙기기\|시험장 도착 시간 확인\|좌석/거울 조정 연습\|감점 포인트 복습 | — |
| `apps/admin-next/components/DomainClient.tsx:192` | field:body | 방향지시등, 일시정지, 속도 조절처럼 반복되는 실수를 실제 상황 중심으로 설명합니다. | — |
| `apps/admin-next/components/DomainClient.tsx:193` | field:body | 불안한 구간만 추가 연습할 수 있는 학원/강습 탐색으로 이어집니다. | — |
| `apps/admin-next/components/DomainClient.tsx:204` | field:body | 시간과 비용이 동시에 부담되는 상황을 구체적으로 짚어 이탈을 줄입니다. | — |
| `apps/admin-next/components/DomainClient.tsx:205` | field:body | 단기반, 셔틀, 추가 비용 여부를 상담 전 질문 목록으로 정리합니다. | — |
| `apps/admin-next/components/DomainClient.tsx:206` | field:body | 상담 후 전체 일정을 한 번에 잡을 수 있어 편했다는 톤으로 신뢰를 보강합니다. | — |
| `apps/admin-next/components/DomainClient.tsx:207` | field:body | 비용과 가능한 일정을 바로 확인하는 버튼을 강하게 보여줍니다. | — |
| `apps/admin-next/components/DomainClient.tsx:218` | field:body | 제목, 핵심 요약, 대표 이미지 등 직접 적은 규칙을 발행 렌더러가 참고할 수 있게 저장합니다. | — |
| `apps/admin-next/components/DomainClient.tsx:219` | field:body | 표, 이미지, CTA 위치처럼 반복될 디자인 규칙을 명시합니다. | — |
| `apps/admin-next/components/DomainClient.tsx:220` | field:body | 상담, 예약, 내부 링크 등 마지막 행동을 어디에 둘지 정합니다. | — |
| `apps/admin-next/components/DomainClient.tsx:338` | muted-p | 등록되지 않은 도메인이거나 API 연결에 문제가 있을 수 있습니다. 대시보드에서 도메인을 만들거나 목록에서 다시 선택하세요. | — |
| `apps/admin-next/components/DomainClient.tsx:387` | muted-p | 먼저 후보를 만들고, 「후보 목록」에서 쓸 후보를 검색·체크한 뒤, 2단계 카드에서 1개 테스트 작성으로 품질을 확인하고 확장하세요.<br>_화면 구조(1단계 → 후보 목록 → 2단계 카드 순서) 설명. 카드 순서를 바꾸면 같이 고친다._ | — |
| `apps/admin-next/components/DomainClient.tsx:394` | jsx-text | 이 도메인에 등록된 작업의 진행 상태를 확인하세요 | — |
| `apps/admin-next/components/DomainClient.tsx:395` | muted-p | 작업은 도메인에 등록됩니다. 워커는 하나라 여러 도메인 작업이 순서대로 처리되므로, 대기가 길면 대시보드 「최근 작업 큐」에서 다른 도메인 작업이 앞서 있는지 볼 수 있습니다. | — |
| `apps/admin-next/components/DomainClient.tsx:404` | jsx-text | 완성 글 확인, 내보내기, 색인 요청을 한곳에서 처리하세요 | — |
| `apps/admin-next/components/DomainClient.tsx:405` | muted-p | 제목을 눌러 상세 미리보기를 확인하고 필요한 글만 선택해 Markdown/HTML로 내보내거나 색인 요청을 등록합니다. | — |
| `apps/admin-next/components/DomainClient.tsx:457` | field:body | 학원 자료는 두 곳에 나뉩니다. 원천 수집·AI 심층조사·검토 승인은 왼쪽 메뉴 「운전학원 자료」에서 하고, 이 탭은 그 자료를 이 도메인으로 가져옵니다. 1단계 「지역 동기화」 → 2단계 「학원자료 연결」 순서이며, 연결은 원천 API를 다시 부르지 않아 수십 초면 끝납니다. 글에 쓸 조사값 범위는 같은 탭 「조사값 신… | — |
| `apps/admin-next/components/DomainClient.tsx:458` | field:action | 자료를 새로 받거나 조사값을 승인했으면 「학원자료 연결」을 다시 눌러야 글에 반영됩니다 — 화면 위 「반영 대기」 배너가 그 신호입니다. | — |
| `apps/admin-next/components/DomainClient.tsx:462` | field:action | 입력 후 ‘저장’을 누르거나, 필요 없으면 다음으로 넘어가세요. | — |
| `apps/admin-next/components/DomainClient.tsx:463` | field:action | 특별한 요구가 없으면 그대로 두고 넘어가세요. | — |
| `apps/admin-next/components/DomainClient.tsx:464` | field:body | 새 도메인은 글 유형이 하나도 켜져 있지 않아 이 단계 없이는 후보를 만들 수 없습니다. 비교형·지역형·체크리스트형처럼 어떤 검색 의도에 맞출지 고르고 켜면 즉시 저장됩니다. 위에서 준비한 원천 데이터·공통 설정을 근거로 커스텀 유형을 만들 수도 있습니다. | — |
| `apps/admin-next/components/DomainClient.tsx:464` | field:action | 운영 초반엔 필요한 유형만 켜세요. 너무 많이 켜면 후보가 급증합니다. | — |
| `apps/admin-next/components/DomainClient.tsx:470` | field:body | 아래 목록에 후보가 있으면 1단계는 건너뛰어도 됩니다. 더 필요할 때만 「글유형」과 「개수」를 정하고 「글 후보 만들기」로 추가하세요. | — |
| `apps/admin-next/components/DomainClient.tsx:470` | field:body | 1단계 카드에서 「글유형」을 고르고 「개수」를 정한 뒤 「글 후보 만들기」를 누르세요. LLM은 호출하지 않고 기획 축·글유형 조합만 만듭니다. | — |
| `apps/admin-next/components/DomainClient.tsx:473` | field:action | 후보가 충분하면 다음 단계(2단계 글 작성)로 이동하세요. | — |
| `apps/admin-next/components/DomainClient.tsx:473` | field:action | 실행 후 바로 아래 「후보 목록」에 행이 생겼는지 확인하세요. | — |
| `apps/admin-next/components/DomainClient.tsx:487` | field:action | 버튼을 누르면 작업 큐 탭에서 진행 상태를 확인합니다. | — |
| `apps/admin-next/components/DomainClient.tsx:489` | field:body | 큐에 등록된 글 생성 작업이 대기·진행·완료·실패 중 어디에 있는지 봅니다. 실패하면 상세 카드의 에러를 확인하고 같은 조건으로 다시 시도합니다. | — |
| `apps/admin-next/components/DomainClient.tsx:489` | field:action | 완료 후 검수·내보내기 탭에서 결과를 검수합니다. | — |
| `apps/admin-next/components/DomainClient.tsx:611` | muted-p | 현재 단계의 대상 영역을 찾는 중입니다. 탭을 전환했거나 데이터가 아직 로딩 중이면 잠시 뒤 다시 표시됩니다. | — |
| `apps/admin-next/components/DomainClient.tsx:671` | muted-p | 「글 생성」 흐름은 원천 데이터·공통 설정·디자인(모두 선택) 준비 후 글유형 켜기(필수)로 이어지고, 후보 만들기·테스트 작성으로 마무리합니다. | — |
| `apps/admin-next/components/DomainClient.tsx:686` | muted-p | 「글 생성 흐름 시작」을 누르면 위 순서대로 카드 영역을 포커싱합니다. | — |
| `apps/admin-next/components/DomainClient.tsx:702` | jsx-text | 큰 흐름 안에서도 필요한 작업만 바로 열 수 있습니다 | — |
| `apps/admin-next/components/DomainClient.tsx:703` | muted-p | 운영자가 이미 중간까지 진행했다면 처음부터 다시 보지 않고, 필요한 단계 버튼만 누르면 됩니다. | — |
| `apps/admin-next/components/DomainClient.tsx:734` | field:desc | ${counts.failed.toLocaleString()}개 실패가 있어 같은 조건으로 다시 만들기 전에 에러를 먼저 봐야 합니다. | — |
| `apps/admin-next/components/DomainClient.tsx:735` | field:desc | ${counts.in_progress.toLocaleString()}개 작업이 진행 중입니다. 새 대량 생성보다 큐 상태 확인이 먼저입니다. | — |
| `apps/admin-next/components/DomainClient.tsx:736` | field:desc | ${counts.planned.toLocaleString()}개 후보가 대기 중입니다. 품질 확인 없이 대량 생성하지 않도록 테스트 1개부터 시작합니다.<br>_운영 권고. 코드가 강제하지 않는다._ | — |
| `apps/admin-next/components/DomainClient.tsx:737` | field:desc | 새 도메인입니다. 원천 데이터·공통 설정(선택)을 준비하고 글 유형을 켜면 후보를 만들 수 있습니다. 「글 생성」 흐름을 처음부터 따라가세요. | — |
| `apps/admin-next/components/DomainClient.tsx:738` | field:desc | 글 유형은 켜져 있습니다. 지역을 동기화하고 「학원자료 연결」로 학원 자료를 가져온 뒤 글 후보를 만드세요. | — |
| `apps/admin-next/components/DomainClient.tsx:739` | field:desc | 후보는 있지만 공통 작성 원칙이 비어 있습니다. 이 사이트에서만 쓰는 말투·태도를 적어 두면 글의 결이 일정해집니다. | — |
| `apps/admin-next/components/DomainClient.tsx:740` | field:desc | ${counts.published.toLocaleString()}개 완성 글이 있습니다. 미리보기 후 Markdown/HTML export와 색인 요청으로 마감하세요. | — |
| `apps/admin-next/components/DomainClient.tsx:741` | field:desc | 현재 바로 작성할 대기 후보가 없습니다. 조건을 확인하고 후보를 다시 생성하세요. | — |
| `apps/admin-next/components/DomainClient.tsx:790` | muted-p | 모든 글 유형에 공통 적용되는 말투·태도, 제외어, 그리고 키워드 마스터(아래 표)입니다. 글 유형별 방향성·축·키워드 선택은 「글유형/디자인」 탭의 커스텀 글유형에서 관리합니다(빌트인 글유형은 복제해 커스텀으로 조정). | — |
| `apps/admin-next/components/DomainClient.tsx:791` | placeholder | 처음 준비하는 독자도 이해할 수 있는 쉬운 표현을 쓰되, 신뢰감 있는 전문가의 설명 톤을 유지한다.&#10;광고성·낚시성 문구와 근거 없는 과장 표현을 쓰지 않는다.&#10;경쟁 브랜드나 특정 업체를 비방하지 않고 균형 있게 설명한다. | — |
| `apps/admin-next/components/DomainClient.tsx:792` | placeholder | 실내운전연습장\n실내운전연습장 추천\n대성자동차학원 찾기 전 볼 인근 후보<br>_제외어 입력 예시._ | — |
| `apps/admin-next/components/DomainClient.tsx:793` | placeholder | 후기 요약에서는 친절한 상담과 꼼꼼한 설명이 확인됩니다\n정리하면 선택 기준은 단순합니다 | — |
| `apps/admin-next/components/DomainClient.tsx:828` | jsx-text | 는 실측이 아닌 초기 추정 시드값입니다. 슬롯 생성 | — |
| `apps/admin-next/components/DomainClient.tsx:828` | jsx-text | 계산에만 쓰이며, 글의 내용·품질·길이는 바꾸지 않습니다. 추후 | — |
| `apps/admin-next/components/DomainClient.tsx:828` | jsx-text | 는 검색 데이터가 아닌 운영 우선순위 값으로, 수기 관리 항목입니다.) | — |
| `apps/admin-next/components/DomainClient.tsx:839` | jsx-text | 키워드가 없습니다. 「행 추가」 또는 「기본값으로 초기화」로 채우세요. | — |
| `apps/admin-next/components/DomainClient.tsx:883` | tooltip | 제목을 후보 수 규칙으로 확정 | — |
| `apps/admin-next/components/DomainClient.tsx:900` | muted-p | 이 도메인에서 쓸 글 유형을 켜고 끕니다(빌트인·커스텀 함께, 즉시 저장). 커스텀 유형은 맨 아래에서 만들고 여기서 켜세요. | — |
| `apps/admin-next/components/DomainClient.tsx:902` | muted-p | 담긴 글 유형이 없습니다. 아래 카탈로그에서 필요한 유형을 추가하세요. | — |
| `apps/admin-next/components/DomainClient.tsx:907` | muted-p | 모든 빌트인 글 유형이 이미 담겨 있습니다. | — |
| `apps/admin-next/components/DomainClient.tsx:911` | muted-p | 아직 안 켠 커스텀 글 유형입니다. 맨 아래에서 만들 수 있어요. | — |
| `apps/admin-next/components/DomainClient.tsx:913` | muted-p | 추가할 커스텀 글 유형이 없습니다. 맨 아래에서 만들어 보세요. | — |
| `apps/admin-next/components/DomainClient.tsx:922` | muted-p | 각 디자인이 어떤 화면인지 보여주는 참고용 목록입니다. | — |
| `apps/admin-next/components/DomainClient.tsx:934` | placeholder | 첫 화면에는 큰 제목과 핵심 요약 3개를 둔다. 비교표는 본문 상단에 배치한다. CTA는 중간 1회, 마지막 1회만 사용한다. 모바일에서는 카드형 목록으로 보이게 한다.<br>_커스텀 디자인 메모 입력 예시._ | — |
| `apps/admin-next/components/DomainClient.tsx:1015` | muted-p | 글유형이 참조하는 &apos;동작 원형&apos;입니다. 자세한 설명을 펼쳐 보세요. | — |
| `apps/admin-next/components/DomainClient.tsx:1017` | muted-p | 아키타입은 글의 검증된 &apos;동작 원형&apos;입니다 — 주축(지역/키워드)·주키워드 생성 규칙·작성 지침·품질 규칙을 정해 둔 틀이에요. 커스텀 글유형은 이 중 하나를 골라 참조하고, 키워드·페르소나·디자인·방향성 같은 세부만 조정합니다(주키워드 규칙·품질 지침은 아키타입 그대로).주축(아키타입이 결정, 변경 불… | — |
| `apps/admin-next/components/DomainClient.tsx:1035` | muted-p | 아직 커스텀 글유형이 없습니다. 위에서 만들거나 복제해 보세요. | — |
| `apps/admin-next/components/DomainClient.tsx:1048` | confirm | 커스텀 글유형 '${t.name}'을 삭제할까요? 이미 생성된 글에는 영향이 없습니다. | — |
| `apps/admin-next/components/DomainClient.tsx:1094` | muted-p | 이 글유형은 학원 근거형이 아니거나 학원 타입이 선택되지 않아 커버리지 정보가 없습니다. | — |
| `apps/admin-next/components/DomainClient.tsx:1096` | muted-p | 학원 타입: {data.academy_types.join(", ")} · 충분 기준 {data.threshold}곳 이상. 상태: 충분(직접+인근 {data.nearby_km}km로 {data.threshold}곳) {data.regions_with_min_for_best} · 보장({data.min_guarantee_k… | — |
| `apps/admin-next/components/DomainClient.tsx:1247` | confirm | persona 사용을 켰으면 값을 한 줄 이상 입력하세요. (비우려면 사용을 끄세요) | — |
| `apps/admin-next/components/DomainClient.tsx:1248` | confirm | intent 사용을 켰으면 값을 한 줄 이상 입력하세요. (비우려면 사용을 끄세요) | — |
| `apps/admin-next/components/DomainClient.tsx:1249` | confirm | modifier 사용을 켰으면 값을 한 줄 이상 입력하세요. (비우려면 사용을 끄세요) | — |
| `apps/admin-next/components/DomainClient.tsx:1272` | confirm | 참조 아키타입을 선택하세요. | — |
| `apps/admin-next/components/DomainClient.tsx:1277` | info-div | {mode === "create" ? "새 커스텀 글유형" : `편집 · ${initial?.template_id}`}{mode === "edit" && 편집 중} | — |
| `apps/admin-next/components/DomainClient.tsx:1284` | muted-p | {source ? "선택한 글유형의 값을 채웠습니다. 필요한 부분만 고치면 됩니다. weight·축 태그·기존 설정은 그대로 복제되고, 아키타입은 소스로 고정됩니다." : "빈 폼으로 직접 만들거나, 기존 글유형(빌트인/커스텀)을 골라 값을 채워 시작할 수 있습니다."} | — |
| `apps/admin-next/components/DomainClient.tsx:1287` | muted-p | 이름 · 참조 아키타입 · 키워드 선택 | — |
| `apps/admin-next/components/DomainClient.tsx:1295` | muted-p | 주축 {(kindOptions.find((o) => o.kind === kind)?.primary ?? "keyword") === "region" ? "지역형(지역+키워드)" : "키워드형"}{source ? " · 시작점을 고르면 소스의 아키타입으로 고정됩니다." : ""} | — |
| `apps/admin-next/components/DomainClient.tsx:1324` | placeholder | 예: 옆자리 선배가 이야기해 주듯 친근하게 쓰고, 지역 학원을 하나씩 소개하며 상담에서 물어볼 것으로 잇는다 | — |
| `apps/admin-next/components/DomainClient.tsx:1349` | tooltip | 켜 놓은 축의 값을 LLM 이 이 글유형(이름·방향성·아키타입)에 맞게 제안해 채웁니다. 제안이므로 검토·수정 후 저장하세요. | — |
| `apps/admin-next/components/DomainClient.tsx:1356` | placeholder | 퇴근 후 배우는 직장인\n주말만 가능한 직장인 (한 줄에 하나씩 · 필수) | — |
| `apps/admin-next/components/DomainClient.tsx:1360` | placeholder | 필기접수\n준비물 (한 줄에 하나씩 · 필수) | — |
| `apps/admin-next/components/DomainClient.tsx:1370` | placeholder | 필기시험부터\n상담전확인 (한 줄에 하나씩 · 필수) | — |
| `apps/admin-next/components/DomainClient.tsx:1379` | muted-p | 「원천 데이터」 탭에서 학원자료를 연결하면 타입 목록이 표시됩니다. | — |
| `apps/admin-next/components/DomainClient.tsx:1385` | jsx-text | 이 도메인에 연결된 학원이 없습니다(모든 타입 0건). 학원 타입을 골라도 실제 후보가 없어 지역 가이드·체크리스트로만 작성됩니다. | — |
| `apps/admin-next/components/DomainClient.tsx:1399` | muted-p | 위에서 고른 디자인의 레이아웃만 보여주는 예시 목업입니다. 실제 글 내용·방향성·축 값은 반영하지 않습니다. | — |
| `apps/admin-next/components/DomainClient.tsx:1408` | muted-p | 생성 시점 실제 후보 수로 제목 확정 · 미설정이면 LLM이 H1 결정 | — |
| `apps/admin-next/components/DomainClient.tsx:1422` | muted-p | tier가 없습니다. 「+ tier 추가」로 &quot;후보 N곳 이상일 때 이 제목&quot; 규칙을 만드세요. (없으면 LLM이 제목 결정) | — |
| `apps/admin-next/components/DomainClient.tsx:1432` | placeholder | 어떤 tier도 안 맞을 때 쓸 제목 (예: {지역} 운전학원 안내) | — |
| `apps/admin-next/components/DomainClient.tsx:1438` | tooltip | 입력한 내용을 모두 지우고 빈 폼으로 되돌립니다 | — |
| `apps/admin-next/components/DomainClient.tsx:1458` | field:body | 지정한 디자인 메모의 상단 구성과 문단 리듬을 따릅니다. | — |
| `apps/admin-next/components/DomainClient.tsx:1458` | field:body | 색상, 카드감, 여백, CTA 강조 방식을 디자인 메모에 맞춰 반영합니다. | — |
| `apps/admin-next/components/DomainClient.tsx:1584` | confirm | 「${name}」을(를) 이 도메인에서 뺄까요?\n다시 연결해도 돌아오지 않습니다. 아래 「제외한 학원」에서 해제하면 곧바로 되돌아오고, 자료 원본은 「운전학원 자료」에 그대로 남습니다. | — |
| `apps/admin-next/components/DomainClient.tsx:1589` | confirm | 「${name}」의 제외를 해제할까요?\n곧바로 이 도메인에 다시 연결됩니다. | — |
| `apps/admin-next/components/DomainClient.tsx:1597` | confirm | 이 도메인에서 학원 자료를 비웁니다.\n「운전학원 자료」의 원본과 조사값은 그대로 남고, 다시 연결하면 복구됩니다. 진행할까요? | — |
| `apps/admin-next/components/DomainClient.tsx:1616` | confirm | 「운전학원 자료」에 이미 받아 둔 학원 자료를 이 도메인으로 가져옵니다.\n원천 API 는 호출하지 않아 수십 초면 끝납니다. 진행할까요? | — |
| `apps/admin-next/components/DomainClient.tsx:1717` | confirm | 지역 축을 기본값(운전 프리셋 지역)으로 초기화할까요? 지금 지역 목록이 덮어써집니다. | — |
| `apps/admin-next/components/DomainClient.tsx:1780` | tooltip | 지역 축을 운전 프리셋 기본값으로 되돌립니다(테스트용 baseline) | — |
| `apps/admin-next/components/DomainClient.tsx:1807` | muted-p | 최근 지역 동기화(이 브라우저 기록): {lastSync.regions ? `${formatDateTime(lastSync.regions.at)} · ${lastSync.regions.count.toLocaleString()}개 반영${lastSync.regions.detail ? ` (${lastSync.regions.… | — |
| `apps/admin-next/components/DomainClient.tsx:1809` | jsx-text | 에만 쓰이며 글 내용은 바꾸지 않습니다(추후 | — |
| `apps/admin-next/components/DomainClient.tsx:1809` | jsx-text | 연동 시 실측 갱신 예정). 지역 동기화로 축을 교체하면 이 두 값은 비워집니다. | — |
| `apps/admin-next/components/DomainClient.tsx:1815` | muted-p | 지역이 없습니다. 위 「지역 동기화」 또는 「기본값으로 초기화」로 채우세요. | — |
| `apps/admin-next/components/DomainClient.tsx:1817` | muted-p | 보통은 위 동기화로 채웁니다. 지역 목록을 수동 조정할 때만 여세요. 한 줄에 하나: 값,가중치,월검색량,KD | — |
| `apps/admin-next/components/DomainClient.tsx:1838` | tooltip | 「운전학원 자료」가 이미 받아 둔 학원·후기·조사값을 이 도메인으로 가져옵니다. 원천 API 를 다시 호출하지 않아 수십 초면 끝납니다. | — |
| `apps/admin-next/components/DomainClient.tsx:1838` | tooltip | 이 도메인에서 학원 자료를 비웁니다. 「운전학원 자료」의 원본과 조사값은 그대로 남고, 다시 연결하면 복구됩니다. | — |
| `apps/admin-next/components/DomainClient.tsx:1841` | muted-p | 최근 연결: {academySyncedAt ? `${formatDateTime(academySyncedAt)} · 현재 ${remoteTotal.toLocaleString()}곳` : "아직 연결한 학원이 없습니다"} | — |
| `apps/admin-next/components/DomainClient.tsx:1867` | muted-p | {photoCount ? `사진 ${photoCount}장` : "사진 없음"} · 리뷰 {reviewCount}개 · 블로그 {blogReviewCount}개 | — |
| `apps/admin-next/components/DomainClient.tsx:1872` | muted-p | 검색 조건에 맞는 학원이 없습니다. 조건을 바꿔보세요. | — |
| `apps/admin-next/components/DomainClient.tsx:1873` | muted-p | 연결된 학원이 없습니다. 위 안내의 「학원자료 연결」을 누르세요. | — |
| `apps/admin-next/components/DomainClient.tsx:1994` | confirm | 요청한 개수 ${max.toLocaleString()}개는 글유형당 상한 ${cap.toLocaleString()}개로 제한됩니다.${typeof created === "number" ? | — |
| `apps/admin-next/components/DomainClient.tsx:2017` | confirm | ${label}: ${count}개 글 작성을 큐에 등록할까요? | — |
| `apps/admin-next/components/DomainClient.tsx:2046` | confirm | ${selected.size}개를 작성 대기(planned)로 되돌릴까요? 오류 메시지도 지워집니다.${warning} | — |
| `apps/admin-next/components/DomainClient.tsx:2088` | muted-p | 활성화된 글유형이 없습니다. 글유형/디자인 탭에서 유형을 켜세요. | — |
| `apps/admin-next/components/DomainClient.tsx:2104` | placeholder | 지역/키워드/후보 검색 예: 서울, 강남구 | — |
| `apps/admin-next/components/DomainClient.tsx:2157` | jsx-text | 위 목록에서 후보를 체크하면 켜집니다. | — |
| `apps/admin-next/components/DomainClient.tsx:2208` | jsx-text | 아직 작업이 없습니다. 글 생성 탭에서 “1개 테스트 작성”부터 등록하세요.<br>_빈 상태 문구._ | — |
| `apps/admin-next/components/DomainClient.tsx:2253` | muted-p | {scoped.length}개 글 · 이미지 {aggImgs}장(평균 {scoped.length ? (aggImgs / scoped.length).toFixed(1) : "0"}장) · 비용 ${aggCost.toFixed(3)} (평균 ${scoped.length ? (aggCost / scoped.length).toF… | — |
| `apps/admin-next/components/DomainClient.tsx:2292` | tooltip | 더 이상 쓰지 않는 글유형이라 켤 수 없습니다. | — |
| `apps/admin-next/components/DomainClient.tsx:2307` | confirm | 정말 삭제할까요? 모든 데이터가 삭제됩니다. | — |
| `apps/admin-next/components/DomainClient.tsx:2308` | muted-p | 도메인 목록·상단 전환 메뉴에서 이 도메인을 구분하는 이름입니다. 글에는 나오지 않으니 운영 편한 대로 적어도 됩니다. | — |
| `apps/admin-next/components/DomainClient.tsx:2308` | muted-p | 미리보기·발행 글·외부 사이트 CTA에 이 색이 반영됩니다. 저장 후 글 유형/디자인 탭에서도 확인하세요. | — |
| `apps/admin-next/components/DomainClient.tsx:2308` | muted-p | 이 도메인과 모든 후보·글 데이터가 함께 삭제됩니다. 되돌릴 수 없습니다. | — |
| `apps/admin-next/components/DomainClient.tsx:2506` | muted-p | 조사 현황을 불러오지 못했습니다. | — |
| `apps/admin-next/components/DomainClient.tsx:2520` | tooltip | 학원 한 곳이 하나로 세어집니다. | — |
| `apps/admin-next/components/DomainClient.tsx:2530` | tooltip | 학원 한 곳에 조사 항목이 여럿이라 학원 수보다 큽니다. | — |
| `apps/admin-next/components/DomainClient.tsx:2536` | muted-p | {summary.last_researched_at ? `최근 조사: ${formatDateTime(summary.last_researched_at)}` : "아직 조사한 학원이 없습니다."} {` · 조사 시도를 마친 학원 ${researched.toLocaleString()}곳`} {summary.matched < to… | — |
| `apps/admin-next/components/DomainClient.tsx:2643` | muted-p | 시·군·구 {sigungu.toLocaleString()} · 읍·면·동 {submunicipal.toLocaleString()} {status.synced_at ? ` · 최근 ${formatDateTime(status.synced_at)}` : ""} {shuttle && shuttle.with_shuttle > 0 … | — |
| `apps/admin-next/components/DomainClient.tsx:2651` | muted-p | 사전 상태를 불러오지 못했습니다. 갱신을 눌러 다시 받아보세요. | — |
| `apps/admin-next/components/DomainClient.tsx:2655` | jsx-text | 만 빠지고 경유지·이용 조건은 그대로 나갑니다. 글 생성은 계속됩니다. | — |
| `apps/admin-next/components/DraftsClient.tsx:67` | muted-p | 검수 대기 목록에서 반려한 글이 여기에 모입니다. 반려해도 본문은 지워지지 않아 나중에 다시 열어볼 수 있습니다. | — |
| `apps/admin-next/components/DraftsClient.tsx:74` | muted-p | 검수 후 발행한 글이 여기에 기록됩니다. 발행된 글 자체는 검수·내보내기 화면에서 확인합니다. | — |
| `apps/admin-next/components/DraftsClient.tsx:85` | jsx-text | 최근 생성에서 게이트에 걸린 글이 없음 — 정상입니다.<br>_빈 상태 해석._ | — |
| `apps/admin-next/components/JobCard.tsx:106` | muted-p | 예약 {formatDateTime(job.scheduled_at)} · 시작 {formatDateTime(job.started_at)} · 완료 {formatDateTime(job.finished_at)} · 대기 {String(job.payload_obj?.cooldown_sec ?? "-")}초 · 제한 {String… | — |
| `apps/admin-next/components/NeedDomainClient.tsx:57` | jsx-text | 백엔드가 실행 중인지, `SEO_API_BASE_URL` 설정을 확인하세요. | — |
| `apps/admin-next/components/PostDetailClient.tsx:60` | muted-p | 원문은 상단의 복사/다운로드 버튼으로 확인합니다. 상세 화면에는 발행 디자인만 표시합니다. | — |
| `apps/admin-next/components/PostDetailClient.tsx:81` | muted-p | 학원 {insight.used.academies}곳 · 후기 인용 {insight.used.quotes}건 · 이미지 {insight.used.images}장 · {insight.used.chars.toLocaleString()}자 | — |
| `apps/admin-next/components/PostDetailClient.tsx:104` | muted-p | 생성 시점 근거가 저장되지 않은 글입니다(기능이 붙기 전에 생성). 지금 다시 계산하면 그때와 다른 값이 나오므로 「안 쓰인 근거」는 보여주지 않습니다. | — |
| `apps/admin-next/components/PostDetailClient.tsx:108` | muted-p | 보낸 조사 근거는 모두 본문에 반영됐습니다. | — |
| `apps/admin-next/components/SettingsClient.tsx:101` | muted-p | 튜토리얼·생성 기본값처럼 이 브라우저의 작업 편의에만 영향을 주는 설정입니다. | — |
| `apps/admin-next/components/SettingsClient.tsx:124` | muted-p | 튜토리얼 안에서 「더 이상 안 보기」를 눌러도 여기서 다시 켤 수 있습니다. 설정은 이 브라우저에만 저장됩니다. | — |
| `apps/admin-next/components/SettingsClient.tsx:136` | muted-p | 「글 후보 만들기 / 글 작성」 화면의 작성 엔진·모델·이미지 옵션 초기값입니다. 자주 쓰는 조합을 저장해두면 매번 다시 고르지 않아도 됩니다. | — |
| `apps/admin-next/components/SettingsClient.tsx:187` | muted-p | 이 브라우저에만 저장됩니다. 저장 후 이미 열려 있는 작성 화면에는 다음에 그 화면을 다시 열 때부터 반영됩니다. | — |
| `apps/admin-next/components/SettingsClient.tsx:232` | muted-p | 끈 이유: 원천이 네이버 블로그 검색으로 학원명을 느슨하게 매칭해 다른 학원 글이 섞입니다. 2026-07-27 실측 539건 중 55건(10%)은 학원 고유명이 글 어디에도 없었고, 같은 글 18건이 이름이 비슷한 학원 2~3곳에 중복 배정됐습니다(중앙/천안중앙/북부중앙 등). 10%는 하한선입니다 — 고유명이 지역명인…<br>_2026-07-27 실측 근거(539건 중 55건·중복 18건). 코드가 아니라 측정에 매달린 값이라 재측정 전에는 고치지 않는다. 정본 docs/source-field-usage.md §3.6._ | — |
| `apps/admin-next/lib/domain-gate.ts:6` | lib-string | 도메인 관리를 하려면 운영 도메인이 필요합니다<br>_빈 화면 안내._ | — |
| `apps/admin-next/lib/domain-gate.ts:7` | lib-string | 사이트 도메인을 먼저 등록하면 기획, 축, 후보, 설정을 관리할 수 있습니다.<br>_빈 화면 안내._ | — |
| `apps/admin-next/lib/domain-gate.ts:11` | lib-string | 글 생성을 하려면 운영 도메인이 필요합니다<br>_빈 화면 안내._ | — |
| `apps/admin-next/lib/domain-gate.ts:16` | lib-string | 검수·보내기를 하려면 운영 도메인이 필요합니다<br>_빈 화면 안내._ | — |
| `apps/admin-next/lib/domain-gate.ts:17` | lib-string | 도메인을 만든 뒤 생성된 글을 미리보기, export, 색인 요청으로 마무리할 수 있습니다.<br>_빈 화면 안내._ | — |
| `apps/admin-next/lib/domain-gate.ts:21` | lib-string | 작업 큐를 보려면 운영 도메인이 필요합니다 | — |
| `apps/admin-next/lib/domain-gate.ts:22` | lib-string | 작업은 도메인에 등록됩니다. 도메인을 만들고 글 작성을 등록하면 이 화면에서 진행 상태를 확인할 수 있습니다. | — |
| `apps/api-nest/src/academy-research.controller.ts:175` | api-error | 수동 등록한 학원만 삭제할 수 있습니다. | — |
| `apps/api-nest/src/admin.controller.ts:754` | api-error | 실행 이력을 찾을 수 없습니다.<br>_단순 404 안내._ | — |

</details>
