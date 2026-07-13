# 다음 세션 인수인계 (2026-07-14)

> **2026-07-13 갱신: (b) writing_guide 재편+아키타입 14→5 통합, 그리고 남은 B(dormant 일괄 클린업)·C 전부 완료.**
> 커밋 `4d912dc`(b) · `0de4208`(B1+C design_presets) · `172dc74`(B2 academy_type_filter) · `e71c8fb`(B3 ai-fill) · `c222efb`(B4 PRESETS 세축).
> 전건 골든406 0-diff·typecheck·company-clean·qa. LLM 실생성 스모크(codex)·:4300 라이브 확인 완료. 설계문서 `docs/archetype-consolidation-plan.md`.
> 아래 §A/§B/§C 는 **완료된 과제의 기록**(참고용). 남은 선택 항목은 memory `archetype-refactor-roadmap` 「미해결(P5 이후 선택)」 참조.
> ⚠️ 라인 번호는 이동하니 함수명/문자열로 재확인. 커밋은 develop, 파일 지정(사용자 병렬 작업 `academy-research.*`/`sync-summary.*` 섞임).

## 현재 아키텍처 핵심 (꼭 읽기)

**글유형(spec) = 아키타입 참조(kind) + 데이터.** 아키타입(archetypes.ts, 코드 registry)은 `writing_guide`·`academy_centric`·`keyword_rule`·`primary`·`article_type`를 갖는 "검증된 동작 원형". 글유형이 데이터로 조정하는 것:
- `axis_values`(persona/intent/modifier) — 글유형별 **단일 소스**. 비면 그 축 미사용(도메인 폴백 제거됨).
- `academy_types` — 학원 타입 단일 소스. 비면 학원정보 미사용.
- `keyword_filter` — **권위**: 있으면 아키타입 `keyword_rule` 정규식 패턴 **무시**하고 그 키워드 직접 사용, 비면 패턴 폴백.
- `primary_override`(region|keyword) — free 모드(keyword_filter 있을 때) 지역 결합 여부. region=지역×키워드, keyword=지역없이.
- `default_direction`·`default_design`·`use_persona`/`with_intent`/`modifier_count`.

**슬롯 생성**: `slot.service.buildTopicUnits(spec, archetype, axes)`가 폴백/free 모드를 통합해 topic(주키워드·지역·sv/kd) 산출. 폴백 모드는 기존과 byte-동일.

**도메인 레벨 데이터**:
- **키워드 마스터** = 도메인 keyword 축(값+가중치+월검색량 sv+경쟁도 kd). `sv/kd`가 슬롯 `priority_score` 소스. UI: **「공통 설정」 탭 표**. 「기본값으로 초기화」 = 프리셋 keyword만 채움.
- **region 축** = DrivingPlus 동기화 데이터. UI: **「원천 데이터」 탭**(동기화 + 고급 접이식 CSV 편집).
- persona/intent/modifier 도메인 축 = **dormant**(글유형으로 이관).

**탭 구성**: 개요 · 공통 설정(원칙+제외어+키워드 마스터) · 글유형/디자인 · **원천 데이터**(지역·학원 동기화+편집) · 글 생성 · 작업 큐 · 검수·내보내기 · 설정. (「축」 탭 제거됨.)

---

## 이번 세션(2026-07-14) 완료 (develop 커밋)

- **글유형별 academy_types**(`81325e5`, UI `b5a3a8f`) — 학원 타입 단일 소스. 빌트인 T01/T07/T14/T15=`[exam_academy,academy]`, T11=`[license_test_course,license_center]`(⚠️데이터 0건→후보0). export의 axis_values 누락도 보정. `post-rendering.fallbackImagesForPost`도 글유형 기준(load-bearing).
- **persona/intent/modifier 축 폴백 제거**(`fcd887c`) — `resolveAxisPool(spec,axis)` 프리셋 전용. 「축」탭 region/keyword만. 커스텀 폼 축 켜면 값 필수 검증.
- **T01 persona/modifier 확장 + 재배치**(`04af8c6`) — T01 persona 8→57·modifier 6→7(부적합 제외), 제거분을 T13(실기/불안 11)·T12(등록절차)·T15(도로주행 modifier)에 재배치.
- **골든 러너 개선**(`23b785e`) — diff 유형별 요약 + `--verbose`.
- **AI 축 값 제안**(`2c8abd2`, 프롬프트 보강 `6108c38`) — `llm-runner.ts` 신규(worker의 runLlm 추출·공용). `POST templates/suggest-axes`(kind/이름/방향성/**writing_guide/공통원칙** → runLlm → JSON 파싱). 커스텀 폼 「🤖 AI로 축 값 제안」. 가짜 도메인 「AI 자동생성」 제거.
- **keyword 필터/(a) 키워드·지역 데이터화**(`9eb6d82` subset → `dfe44b5` **권위 승격 + primary_override**) — buildTopicUnits 통합. 골든0-diff(폴백 byte-동일).
- **빌트인 14종 keyword_filter 기본값**(`305b33d`) — pick 유형 "첫매칭 1키워드" 공백 해소(T04→1종·2종 둘다 등). **골든 560→406**(중복 슬롯 제거 = 개선).
- **키워드 선택 UI**(`f597555`) — 체크박스 → 텍스트영역(한 줄에 하나)+풀 칩 토글(임의 키워드 자유).
- **키워드 마스터 표**(`8cce8b2`) — 「축」탭 CSV → 「공통 설정」 탭 표(키워드·가중치·월검색량·KD). 삭제버튼 한 줄(`056b354`). 「공통원칙」→「공통 설정」 개명(`ed2425a`).
- **preset axes 필터**(`8971b46`) — `applyPreset(…, onlyAxes?)` + `POST axes/preset {axes:["keyword"]}`. 키워드 마스터 「기본값으로 초기화」 버튼(`a09a550`, 문구정리 `d6dd5f4`) — keyword만 채움(region 보존).
- **「축」탭 제거**(`ecf7e69`) — region 편집기→「원천 데이터」탭 접이식 이전. Axes 컴포넌트·AXES 상수·탭 항목 제거. 「학원자료」→「원천 데이터」 개명.

**검증**: 각 커밋 골든(현재 **406**)·typecheck·qa:posts·company-clean. SlotService 종단검증 여러 건(academy_types 15·free모드 4·keyword필터 5 등). AI 축 제안은 **실제 codex 스모크** 통과. ⚠️ 라이브 UI(:4300) 실조작은 사용자 몫(미자동).

---

## 남은 작업

### A. (b) writing_guide 재편 + 아키타입 ~5종 통합 — **✅ 완료(`4d912dc`)**
- **배경(합의됨)**: (a)로 키워드/지역이 데이터화되면서, 아키타입의 진짜 값어치는 **writing_guide(작성 방식) + academy 동작** 뿐임이 드러남. 사용자와 합의: 아키타입을 **작성방식 기준 ~5종**으로 통합하고 싶음.
- **관찰**: 14 아키타입이 `article_type` 기준 ~5종으로 겹침 — local_best_comparison / general_best / cost_comparison / exam_best / local_access. `written_registration/tips/app`(필기 3형제)처럼 **구조 동일·패턴만 다른** 준중복 다수(패턴은 이제 keyword_filter로 대체 가능).
- **핵심 제약(정직)**: `writing_guide`와 `primary`(지역 결합)가 **완전 독립 아님**. 예: `local_best` writing_guide는 "지역 안 학원 비교"를 전제 → 지역 끄면 지침 헛돎(텍스트 레벨, 치명적 실패는 아님). 그래서 **primary_override 완전 자유는 이 재편 후**. 지금 UI는 안내로만.
- **접근(미착수, 설계 필요)**: writing_guide를 지역-중립/지역-인식으로 정리 → 준중복 아키타입 합치기 → 각 유형이 "작성방식(아키타입) + 키워드/지역/축(데이터)" 조합. **품질 바닥(writing_guide)** 이 흔들리므로 착수 전 설계안 + 사용자 확인 필수.
- **리스크**: 높음(writing_guide=생성 품질 좌우). 전면 리팩터.

### B. `design_presets` 심층 백엔드 클린업 + dormant 일괄 제거 — **✅ 완료(`0de4208`·`172dc74`·`e71c8fb`·`c222efb`)**
- **design_presets**(기존): db.service 테이블(2 CREATE+마이그레이션)·`list/get/create/deleteDesignPreset`·`designPresetOut`; admin.controller `extractDesignPresetFromHtml`·`getUploadedDesignPresetForPost`·글상세/렌더 uploaded 분기·export `"uploaded:"` 허용; worker `buildPrompt/buildRepairPrompt/designWritingGuide/designStructureGuide/uploadedPresetGuide`의 `designPreset` 파라미터·`isSelectableDesign`/토큰필터 `"uploaded:"`; lib/types `DesignPreset`(=아래 C). 데이터 안전: `design_presets` 0행·`uploaded:` 0 확인.
- **academy_type_filter dormant**(academy_types 이관): `domains.academy_type_filter` 컬럼·`db.academyTypeFilter()`·`domainOut` 필드·PATCH 직렬화·`updateDomain` allow-list·`lib/types DomainConfig.academy_type_filter`.
- **도메인 persona/intent/modifier 축 dormant**(폴백 제거): `PRESETS`의 세 축·`listAxes`가 채우지만 무효(생성/정합성 미사용). `AXES` 상수는 region/keyword만 유효. 정리 시 PRESETS/listAxes에서 세 축 제거 검토.
- **`axes/ai-fill` 엔드포인트 dormant**: admin.controller `aiFill`(실제 AI 아니고 applyPreset 재호출). 프론트 호출부 0. 제거 시 docs/admin-json-api.md 확인.
- **리스크**: worker·렌더 load-bearing(design_presets). 중~높음. **전체 점검 때 권장.**

### C. `lib/types` `DesignPreset` 죽은 타입 — **✅ 완료(B1 `0de4208`과 함께 제거).**

---

## 검증 관례 (필수)
- **골든 0-diff**: `npm run test:golden`(러너 `apps/api-nest/scripts/tests/golden-runner.ts`, 픽스처 `golden-slots.json`, **현재 406 슬롯**; 의도 변경 시만 `--update`). 개선된 러너는 **유형별 diff 요약** + `--verbose`.
- 커밋 게이트: `verify:company-clean && typecheck && qa:posts (&& test:golden)`를 `&&`로 묶어(bare git commit 금지, pre-commit 훅이 company-clean 자동).
- UI는 typecheck + `:4300` 실조작(완전 자동 아님). **커밋은 파일 지정**(같은 파일 `DomainClient.tsx`에 사용자 병렬 작업이 자주 섞임 — 사용자 먼저 커밋 후 내 것 파일 지정).

## 참고 (패턴 원본)
- 글유형별 데이터 필터 패턴(academy_types/keyword_filter): db `custom_templates` 컬럼 + `TemplateSpecShape` + create/update/import/spec/out + controller create/clone/export + slot.service 소비 + 커스텀 폼. LLM 재사용: `llm-runner.ts`.
- 상세 세션 이력·모델은 memory `archetype-refactor-roadmap`.
