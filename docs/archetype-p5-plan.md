# Phase 5 정밀 설계: "유형 + 개수" 생성 재편 (관리/생성 경계 명확화)

> ⚠️ **상태(2026-07-13)**: P5 완료. 이후 축 값 프리셋(글유형별 persona/intent/modifier), 디자인/글유형 탭 대정비(③ 제거·프리셋 삭제·평면화), 글유형 on/off 통합 허브까지 진행됨. 최신 상태는 memory `archetype-refactor-roadmap`.

> 목적: 운영자 멘탈모델을 **관리=유형 정의·노출 / 생성=유형 고르고 개수 넣고 생성**으로 맞춘다. 슬롯·축은 배경으로 내린다.
> 전제: 아키타입 리팩터(2a→P4c-3b) 완료. 이 문서는 요약이 아니라 실행 스펙이다.
> 원칙: **엔진(슬롯 생성/선택 로직)은 건드리지 않는다.** 재편은 UI 오케스트레이션 + 얇은 배선 + 용어/카피 정리. load-bearing(resolveGenerationDesign, generateSlotsForDomain 점수/조합)은 무변경 → 골든 0-diff 로 방어.

## 0. 확정된 사실 (코드 기준, 틀리면 안 됨)

- **슬롯(slot) = 글 후보(candidate). 같은 것.** DB/코드=`slots`(slot_id), 운영자 문구=`후보`. 이중 명칭이 혼란 원인 → UI 는 "후보"로 통일(코드 식별자는 slot 유지).
- **엔진은 결정론적. 랜덤 없음.** `generateSlotsForDomain`(slot.service) 의 `seed` 파라미터는 시그니처에만 있고 미사용. `Math.random` 없음. 그래서 골든 556 0-diff 성립.
- **디자인은 글유형에 속함**(PR3 완료). `template_overrides[tid].design` → 레거시 → `spec.default_design`. `resolveGenerationDesign`(worker.service, export). **생성 시점 디자인 선택은 없음/추가 안 함**(혼합 배치에서 유형-디자인 미스매치 유발하므로 자동 매칭이 더 정확).
- **생성은 이미 2단계**(DomainClient `Slots` 컴포넌트, "1단계 글 후보 만들기" / "2단계 글 작성"):
  - `POST slots/generate`(admin.controller:365) → `generateSlotsForDomain({ maxPerTemplate })`. **enabled 전 글유형** 대상(또는 opts.templates). LLM 없음. 유형×축 전개 → 우선순위 점수(검색량·경쟁도·weight) → primary 간 인터리브(균형) → 유형별 상한 → dedup(멱등) → 제외어.
  - `POST jobs/generate`(admin.controller:509) → `{ slot_ids | (q, template, max, balanced), writerOpts }`. slot_ids 없으면 `selectSlotsForBatch({template, limit:max, balanced})`(db.service:593: 우선순위 상위 N, 지역 균형 옵션, 주제 dedup). **후보가 없으면 400**(자동 생성 안 함, line 531).
- **커스텀 글유형은 UI 관리 가능**(P4c-3a: CustomTemplatesManager). `templates_enabled` 로 켜야 후보 순회됨.

## 1. 재편 골자

### (A) 용어 통일 — "슬롯" → "후보"
- 운영자 화면 문구를 "후보"로 통일. 코드/DB/식별자(slot_id, listSlots 등)는 유지. 표시 문자열만.

### (B) 생성 페이지 = "유형 + 개수 + 생성" (핵심)
현재 2단계·슬롯목록 중심을 **한 흐름**으로:
- **주 UI 카드**: `[글유형 선택(enabled 커스텀/빌트인)] + [개수 N] + [생성]`.
- 누르면 **오케스트레이션**:
  1. 그 유형의 planned 후보가 N개 미만이면 **먼저 그 유형만 `slots/generate`**(자동 후보 확보).
  2. `jobs/generate({ template, max:N, balanced })` 로 상위 N 선택·작성 큐 등록.
- **"개수 N" 의미 명시**(카피): 랜덤 아님 → **우선순위 상위 N개(+지역 균형 옵션)**.
- **테스트 우선**: "1개 테스트 생성" 유지(QA 후 대량).
- **고급(접이식)**: 기존 후보 목록 검색·개별 선택·수동 후보 관리·개별 삭제 — 숨기되 **기능 보존**(현재 `Slots` 하위 전부).

### (C) 관리/생성 경계 명확화
- **글유형 탭**: "유형 정의(kind+파라미터+디자인) + 노출 토글"로. `templates_enabled` = "생성 페이지에 후보로 노출". 디자인 영역 슬림화(§3).
- **축·학원자료 탭**: "생성용 배경 데이터"로 위치·카피 명확화(운영자는 생성 때 안 봄).

## 2. 배선/오케스트레이션 (엔진 무변경)

- **자동 후보 확보**가 유일한 신규 로직. 두 경로:
  - **경로1(권장, 저위험): 프론트 오케스트레이션.** 생성 카드가 (a) `listSlots({template, status:planned})` 로 개수 확인 → (b) 부족하면 `slots/generate` → (c) `jobs/generate`. 새 백엔드 없음.
  - **경로2: 얇은 백엔드 오케스트레이터** `POST domains/:domain/generate-by-type { template, count, balanced, ...writerOpts }` 가 ensure-slots + select + enqueue 를 한 번에.
- **함정**: 현재 `POST slots/generate`(admin.controller:365)는 **enabled 전 유형** 생성이라 `body.max_per_template` 만 받음 — **한 유형만** 생성하려면 `templates`/`template` 파라미터를 받도록 확장 필요(generateSlotsForDomain 은 이미 opts.templates 지원). 이 작은 확장이 P5 유일한 백엔드 변경 후보.

## 3. 디자인 영역 슬림화 (P4c-3b 후속, 함께)

- 미리보기 윗부분 정리: **중복 읽기전용 요약표 제거**, "화면 구상 종류" 설명 **접이식(도움말)**, 프리셋 관리·전체 강제는 **"고급" 접이식**, 미리보기 유지. 편집은 글유형별 편집기 한 곳(P4c-3b 완료, custom 포함=4b6cad1).
- **상세 감사(영역별 필요여부 + stale 카피 목록): `docs/design-area-audit.md`.** 이 카드의 블록별 판정(기능/정보성/중복)과 PR3 이후 안 맞는 문구(line 707/757/395)를 정리해둠. 슬림화 착수 시 이걸 근거로.

## 4. 절대 안 건드리는 것 (load-bearing)

- `generateSlotsForDomain` 점수/조합/인터리브, `selectSlotsForBatch` 선택 로직, `resolveGenerationDesign`. 전부 무변경 → 골든 0-diff 로 증명. 랜덤 도입 금지.

## 5. 서브스텝 + 검증

- **P5a**: (선택)`slots/generate` 에 `template`/`templates` 파라미터 확장 — 한 유형만 후보 생성. 검증: 골든 0-diff + 격리(그 유형만 생성되는지) + 기존 전체 생성 불변.
- **P5b**: 생성 페이지 "유형+개수" 주 UI + 자동 후보 확보 오케스트레이션(경로1). 고급(기존 슬롯 UI) 접이식. 검증: 4300 실조작(유형+개수→후보 확보→큐 등록→1개 테스트), typecheck.
- **P5c**: 용어 "후보" 통일 + 관리/축/학원 카피 정리 + 디자인 영역 슬림화(§3). 표시 전용. 검증: typecheck + 4300 + 골든 0-diff(백엔드 무변경).

## 6. 커밋 전 필수 (매 서브스텝)

`verify:company-clean && typecheck && qa:posts && test:golden` 를 `&&` 로 커밋에 묶는다. bare git commit 금지. UI 는 4300 실조작 + 사용자 시각 확인(완전 자동 e2e 아님을 명시).

## 7. 결정 필요(다음 세션 착수 시 사용자 확인)

- 자동 후보 확보: **경로1(프론트, 권장)** vs 경로2(백엔드 오케스트레이터).
- "개수 N" 균형 기본값: balanced ON(전국 골고루) vs OFF(우선순위 순수 상위). 추천: 유형별 성격 따라 기본 제시하되 토글.
- 고급(기존 슬롯 목록 UI) 유지 범위 — 전부 접이식 보존 권장.
