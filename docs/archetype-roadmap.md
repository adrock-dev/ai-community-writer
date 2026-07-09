# 아키타입/글유형 데이터화 — 마스터 로드맵

> 흩어진 글유형 하드코딩을 아키타입으로 통합하고, 레시피를 데이터화(상수=기본/복구 + DB=오버라이드/커스텀)하는 다단계 리팩터. **북극성 = 생성 글의 품질/완성도.**
> 문서 구성: 이 파일(전체 로드맵/스케치) · `archetype-audit.md`(Phase 0 전수조사) · `archetype-2b2-plan.md`(다음 단계 정밀 스펙).
> **원칙: 정밀 스펙은 "다음 단계"에만 작성한다. 먼 단계는 스케치로 두고, 도달 시 정밀화한다.**

## 왜 이 개편을 하는가 (배경/동기)

**출발점(문제 제기)**: 축 구조상 **모든 글유형이 동일한 전역 축(persona/intent/modifier)을 공유**해서, 글유형에 따라 조합 미스매치가 생긴다. 예: 필기시험 팁 글(T09)에 "셔틀버스 이용 희망자" 같은 학원선택형 persona가 붙는다. → LLM이 억지로 반영하거나 무시 → **생성 글의 품질·완성도 저하, 실패율↑.**

**근본 원인**(전수조사 결과, `archetype-audit.md`):
1. **유형별 로직이 흩어진 하드코딩** — "이 글이 무슨 유형인가"를 코드가 `template_id`·`kind`·`article_type` 등 **3~4가지 방식으로 따로** 답하고, 로직이 slot.service·worker 등 여러 곳에 분산. 새 유형은 이 하드코딩을 못 받아 오작동.
2. **레시피(조합 규칙)와 데이터(축 값)가 따로 관리** — 서로 어긋나면 빈/일반론 조합이 조용히 생겨 품질 저하.
3. **모든 게 코드 상수** — 운영자가 유형을 조정·추가하려면 코드 수정·배포 필요.

**개편의 목표**:
- 유형별 로직을 **아키타입으로 통합** → 충돌·중복 taxonomy 제거, 새 유형이 검증된 로직을 재사용.
- 레시피를 **데이터화**(상수=기본/복구 + DB=오버라이드/커스텀) → 운영자가 코드 없이 조정·생성, DB 초기화에도 빌트인 안전.
- 궁극적으로 **조합↔데이터 정합성을 가시화**(Phase 3)해 생성 **전에** 얇은 글을 방어.

**핵심 관점**: "더 많은 글을 찍자"가 아니라 **"조합 품질·완성도를 높이자"**. 모든 단계는 이 품질 북극성으로 판단한다.

## 모델 철학 (틀리면 안 됨)

- **아키타입** = 코드 registry(`archetypes.ts`, kind 키). "고르는 대상". DB화 안 함 → 코드 품질 보장. 커스텀도 기존 아키타입을 **참조(select)** 하지 새로 authoring 하지 않는다.
- **글유형** = 아키타입 참조(kind) + 파라미터. 빌트인=상수 기본 + DB 오버라이드 / 커스텀=full DB row.
- **복구**: 빌트인은 상수라 DB 초기화에도 안전. 커스텀만 DB 의존.
- **용어(정본)**: **레시피 파라미터** = 글유형이 갖는 조정 가능 값(`use_persona`·`with_intent`·`modifier_count`·`axis_tags`·`direction`·`design`). "조합/조정" 등 변형 표현 대신 "레시피 파라미터"로 통일. (아키타입의 동작 원형 primary/keyword_rule/academy_centric/writing_guide 와는 구분.)

## 현재 위치 (develop, 미푸시)

| 커밋 | 단계 |
|---|---|
| `8558015` | 축/공통원칙 리팩터 (+사용자 WIP 혼재) |
| `f99c521` | Phase 1 — 아키타입 통합(키워드 인터프리터/academy_centric/writing_guide) |
| `0773f55` | Phase 2a — 아키타입 registry(kind 키)/글유형 분리 |
| `26a8371` | Phase 2b-1 — 빌트인 레시피 파라미터 오버라이드 |
| `b5dd85a` | company-clean 금지어 정정 |

**다음: Phase 2b-2** (정밀 스펙 → `archetype-2b2-plan.md`).

---

## 남은 단계 스케치

### Phase 2c — 커스텀 내구성(export/import) + 재시드
- **목표**: 빌트인은 상수라 복구 공짜. 커스텀만 DB 의존이니 **export/import**로 wipe 대비.
- **접근**: `GET /domains/:domain/templates/export`(custom_templates + template_overrides JSON) / `POST .../import`. 선택적 "빌트인 재시드" 유틸(상수→오버라이드 초기화)은 사실상 불필요(상수가 이미 기본).
- **결정할 것**: export 범위(글유형+오버라이드만 vs 축까지). 추천: 편집 상태(글유형+오버라이드)만.
- **위험**: 낮음(대부분 직렬화). 2b-2 끝나면 작음.

### Phase 2d — select/clone API (안전한 새 유형 경로)
- **목표**: 맨땅 authoring 대신 **기존 글유형/아키타입 복제 후 조정** → 검증된 로직 재사용, 품질 보존.
- **접근**: `POST /domains/:domain/templates/clone` { source_template_id } → source(빌트인/커스텀)의 kind+파라미터를 복사한 custom row 생성(새 유니크 id/name). 이후 오버라이드/편집.
- **결정**: 복제 소스 = 기존 글유형(빌트인 포함) 우선. "아키타입만 골라 빈 파라미터로 시작"은 부차.
- **위험**: 낮음. 2b-2의 CRUD 위에 얹힘.

### Phase 3 — 레시피↔데이터 정합성 가시화 (★품질 레버리지)
- **목표**: 네가 우려한 "레시피/데이터 충돌"의 정공법. **생성 전에** 이 레시피가 현재 데이터로 만들어내는 조합을 보여줘 얇은/일반론 글을 사전 방어.
- **접근**: 읽기 전용 `GET /domains/:domain/templates/coherence` — 유형별로 (a) 태그 필터 후 persona/intent/modifier 수, (b) 아키타입 keyword_rule 정규식에 매칭되는 keyword 수, (c) 학원 데이터 있는 region 수 계산 → 경고("T14: 이 지역 학원 2곳뿐, BEST 억지 위험").
- **결정**: 계산만(behavior 무변). UI(Phase 4)에서 글유형 카드에 미리보기로 노출.
- **위험**: 낮음(순수 read/compute). **품질 관점에서 최대 레버리지 단계.**

### Phase 4 — template-중심 UI (+ PR3 디자인 통합)
- **목표**: `글유형/디자인` 탭을 **영역 중심 → 글유형 중심 카드**로 재편. 카드 하나에 아키타입 선택·파라미터·방향성·디자인·축 태그·학원타입·**정합성 미리보기(Phase 3)**. 커스텀 생성/복제(2d)도 여기서.
- **접근**: `Templates` 컴포넌트(대형) 재작성. **PR3 = `design_template_overrides` → `template_overrides` 통합**을 여기서 수행(디자인도 글유형 카드의 한 필드).
- **위험**: 중간~높음. `resolveGenerationDesign`은 **모든 발행 글의 디자인 결정(load-bearing)**. 두 저장 경로(디자인 표/오버라이드 편집기)를 **하나의 카드·하나의 저장으로 병합**해야 클로버링 방지. e2e 재검증 필수.
- **연계**: 학원자료 탭의 "생성 사용 타입"(academy_type_filter)을 이 재편에서 정리 — 도메인 공통 정책은 공통원칙 탭으로, 유형별은 카드로.

---

## 공통(cross-cutting) — 모든 단계 적용

### 검증 규율 (필수)
- 각 단계 **골든 0-diff**로 빌트인 동작 불변 증명. 픽스처: `apps/api-nest/scripts/tests/golden-slots.json`(556 슬롯).
- 방법: 격리 API(`ADMIN_PORT=8790 SEO_DB_PATH=<scratch> API_WORKER=0 npx tsx src/main.ts`) → 전 글유형 slots/generate(max 40) → 슬롯 필드 스냅샷 diff. 오버라이드/커스텀은 **긍정 테스트** 추가.
- **커밋 전 3종 게이트 모두**: `verify:company-clean` + `typecheck` + `qa:posts`. (2a/2b-1 때 company-clean 누락으로 금지어 유입 사고 → 반드시 3종 다.)

### 기지의 함정 체크리스트
1. **JSON 컬럼 write 직렬화** — 객체를 TEXT 컬럼에 넣을 땐 `JSON.stringify`(PATCH/CRUD). template_overrides에서 이걸 빠뜨려 유실 버그 겪음.
2. **slot_id 는 domain+template_id 해시** — 도메인 간 충돌 방지(과거 버그 수정됨). 커스텀 id는 빌트인과 유니크해야.
3. **키워드 축 정렬 의존** — `buildKeyword`는 keywordAxis가 listAxes 정렬(weight DESC)이라 가정. 순서 바뀌면 slug/제목 달라짐.
4. **article_type 미통합** — `articleTypeForSlot`는 텍스트 의존이라 아직 상수/regex. 커스텀도 텍스트로 분류됨(별도 처리 불필요).
5. **PR3(디자인 통합)은 load-bearing** — Phase 4에서 신중히, 두 writer 병합 + e2e.

### 참고
- 전수조사(유형별 하드코딩 12곳 인벤토리): `archetype-audit.md`.
- 품질 baseline: `output/`(구 프로세스 생성글). 회귀 의심 시 `git diff pre-axis-refactor`(태그).
