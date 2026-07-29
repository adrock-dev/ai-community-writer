# 현재 콘텐츠 생성 아키텍처

조사 기준일: 2026-07-20. 이 문서는 실행 경로를 읽어 작성한 현황 분석이며, 구현을 변경하지 않는다.

## 결론 요약

생성은 관리자 UI가 만든 `slots` 레코드를 Nest 작업 큐가 처리하는 단일 LLM 본문 생성 흐름이다. 지역 비교의 사실 재료는 `academies`/`seo_regions` SQLite 테이블에서 조립되고, 생성 뒤에는 규칙 기반 품질 게이트와 최대 두 번의 LLM 보정이 있다. 별도의 제목 LLM 호출, section-plan LLM 호출, 생성 시점 웹 검색, 게시물 버전 테이블은 없다.

## 실제 호출 흐름

```text
관리자 입력(DomainClient)
→ 글유형/축 조합으로 slot 생성(SlotService)
→ 생성 작업 enqueue(AdminController)
→ template/archetype·persona·intent·modifier 해석(WorkerService)
→ academies/seo_regions/기존 글 조회 및 facts 조립(WorkerService)
→ 제목 규칙 해석 또는 H1 위임(WorkerService)
→ 단일 본문 Markdown 프롬프트(runLlm)
→ normalize + 규칙 기반 품질 게이트
→ 필요 시 repair 프롬프트 최대 2회
→ 최종 surface gate·이미지 생성
→ posts 저장 + Markdown artifact 출력
```

| 단계 | 구현과 데이터 전달 | 프롬프트/모델 | 실패 처리·현재 한계 |
|---|---|---|---|
| 관리자 입력 | `apps/admin-next/components/DomainClient.tsx:1456-1617`가 provider, model, 디자인, 웹 토글, 이미지, 슬롯을 `/jobs/generate`에 보낸다. | UI의 model 문자열은 `WorkerService`의 `runLlm`에 그대로 전달된다. | UI는 웹 사용을 표시하지만 `use_web_research`는 enqueue payload(`admin.controller.ts:615-629`) 이후 worker에서 읽히지 않는다. |
| 패턴 결정 | `SlotService.generateSlotsForDomain` (`slot.service.ts:25-126`)가 `templates_enabled`, `TEMPLATE_SPECS`, 축 조합으로 `slots`를 upsert한다. 작업 시 `DbService.getTemplateSpec`과 `getArchetype`을 다시 해석한다. | `constants.ts:110-125`, `archetypes.ts`의 recipe/structure가 본문 프롬프트에 주입된다. | 자동 선택은 검색 결과를 실시간 분류하는 기능이 아니라, 활성 템플릿과 축의 결정적 조합 생성이다. |
| modifier 결정 | `resolveAxisPool`과 `modifierPairs`가 글유형의 `axis_values.modifier`에서 0~2개를 slot의 `modifier_1/2`에 넣는다 (`slot.service.ts:66-96`, `axis-tags.ts:66-84`). | 본문/repair 프롬프트에는 `수식어: ${modifier_1}, ${modifier_2}` 한 줄로만 전달된다 (`worker.service.ts:737, 828`). | modifier별 instruction/compiler가 없으므로 선택과 본문 차이가 모델의 해석에 의존한다. |
| DB 조회 | `WorkerService.buildFacts`가 지역, 학원 타입, 후보 풀을 사용한다 (`worker.service.ts:242-281`). `academies`의 주소·수강료·셔틀·시간·합격률·전화·SEO·후기·좌표·사진을 문자열 facts로 만든다. | facts가 본문과 repair 프롬프트의 `확인된 콘텐츠 재료`에 삽입된다. | `academy_types`가 빈 글유형은 지역이 있어도 학원 데이터가 0개다 (`worker.service.ts:306-309`). |
| 인접 지역/추가 데이터 | `pickAcademiesForRegion`은 직접 매칭 뒤 주소/행정 접두/20km 반경 후보를 보강하고, 최소 수 미달이면 50km까지 최근접 후보를 보장한다 (`worker.service.ts:312-359`). 거리만 facts에 추가한다. | 프롬프트는 거리 있는 후보를 “인근 후보”로 구분하라고 지시한다 (`worker.service.ts:749-750`, `851`). | 경로·대중교통·셔틀 실제 접근성은 계산하지 않는다. `use_web_research`는 생성에 미구현이다. 별도 Academy Research는 존재하지만 생성 facts에 합류하지 않는다. |
| 사실 데이터 구성 | `buildFacts`가 후보명, 필드, 후기 요약, 운영 형태, 좌표, 이미지 키, 관련 글 후보를 만든다. 후보는 slot seed로 고정 샘플링된다. | 없는 값/후보를 만들지 않는 원칙은 `buildPrompt`와 `DRIVING_*_PRINCIPLES`에 있다. | research DB의 courses, shuttle routes, sources는 이 경로에서 조회하지 않는다. 데이터 freshness/출처 날짜가 facts에 없다. |
| 제목 생성 | `TITLE_RULES`는 T01/T11/T14만 후보 수 기반 제목을 강제한다 (`constants.ts:101-105`, `worker.service.ts:117-127, 997-1053`). 그 외에는 본문 H1을 추출한다. | 별도 제목 생성 프롬프트/LLM 호출은 **미구현**. | T01 제목은 BEST/후보 수 중심이며 세부 지역·비교 기준 다양성은 없다. |
| 목차/section plan | `structureGuideForArchetype`가 slot-seed로 구조 variant를 골라 본문 프롬프트에 넣는다 (`archetypes.ts:337-379`, `worker.service.ts:724-729`). | 본문 생성 프롬프트 안의 자연어 구조 지시다. | 별도 outline/section-plan 생성·검수·저장 단계는 **미구현**. 모델이 구조를 직접 생산한다. |
| 본문 생성 | `buildPrompt` (`worker.service.ts:805-934`) → `runLlm` (`llm-runner.ts`) → Markdown normalize. | codex/claude CLI, 요청 model 또는 provider 기본값. 기본 timeout 600초(이미지 시 1200초). | CLI 오류/빈 응답은 slot `failed`; 취소·일일 한도·제외어·학원 수 미달은 `skipped`. |
| 사실/형식 검수 | `articleQualityIssues`와 `postSurfaceQualityIssues` (`quality-gate.ts:87-164`)가 길이/H2/표/리스트/후보명/H3/이미지/가격·후기·위험 주장/상투구 등을 검사한다. 실패 시 `buildRepairPrompt`로 최대 2회 재작성. | repair도 본문과 동일 model. | 필드별 claim-to-source 대조, 인접 후보의 이동 가능성, 가격 기준일, 셔틀 노선, 모든 사실의 정확성은 규칙으로 검증하지 않는다. |
| 중복 검사 | 생성 중 글 내부 반복문장과 상투구를 차단한다. 별도 `dedup` job은 모든 post pair의 Jaccard 유사도(기본 0.75)를 계산해 낮은 priority post를 `noindex`로 바꾼다 (`worker.service.ts:361-377`). | 없음. | 의미 유사도/문장 재구성/제목 유사도는 측정하지 않으며 생성 전에 기존 글과 비교하지 않는다. |
| 저장/출력/SEO | `DbService.insertPost`가 Markdown, meta description, 이미지, provider/model/session/tokens, 지역/학원명을 `posts`에 저장한다. `metaDescription`은 첫 일반 문단 155자다 (`worker.service.ts:1055`). `post-rendering.ts`가 Markdown→HTML·학원 카드·표·이미지를 렌더한다. | 없음. | schema에 post version/revision은 없고 동일 slot 재생성도 새 post일 수 있다. SEO title은 H1, description은 추출값뿐이며 keyword/OG 생성 전용 단계는 없다. |

## 데이터 저장소와 정규화

- 운영 생성 DB는 `data/admin.db`의 SQLite. 스키마는 `apps/api-nest/src/db.service.ts:20-180`에 있다.
- `academies`는 기본 정보, 후기 JSON, 블로그 후기 JSON, 사진·좌표·유형·원본 URL·동기화 시각을 가진다. `seo_regions`는 지역/level/위경도다.
- `DrivingplusApiService`는 외부 API payload를 텍스트·좌표·후기 구조로 정규화하고 긍정/안전 후기만 보존한다 (`drivingplus-api.service.ts:30-209`). `DbService.upsertDrivingplusAcademies`는 주소를 SEO 지역에 매핑하고 review summary를 만든다 (`db.service.ts:785-820`).
- 별도 `academy_research.db`의 Academy Research는 검색→페이지 fetch→LLM JSON 추출로 수강 과정, 셔틀 노선, 출처 URL을 저장한다 (`academy-research.service.ts`, `academy-research-web.ts`). 이는 현재 글 생성 worker와 별도 서비스/DB여서 facts에 사용되지 않는다.

## 근거와 미구현 판정

**근거:** `WorkerService.processGenerate`에는 facts 구성 뒤 `buildPrompt → runLlm`만 있고 outline/title/web retrieval 호출이 없다. `use_web_research`는 컨트롤러와 UI에는 있으나 worker 검색 결과에는 참조가 없다. `posts` 스키마에는 revision/version 부모 키가 없다.

**추론:** 현재 시스템의 가장 강한 품질 제어점은 “검증된 facts에 없는 변동 사실을 만들지 말라”는 프롬프트와 표·후보명·금액·후기·위험 표현 게이트다. 그러나 검수는 주로 형식/문자열 대리 지표이므로 사실별 provenance와 비교 완결성을 보장하지 않는다.
