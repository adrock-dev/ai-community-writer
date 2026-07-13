# 다음 세션 인수인계 (2026-07-13)

> 이번 세션에서 "축 값 프리셋 + 디자인/글유형 탭 대정비 + 글유형 on/off 통합"을 마쳤고,
> 아래를 **다음 작업**으로 남겼다(#3은 검증 결과 **오탐 종료**, #1은 **2026-07-14 완료**). 상세 세션 이력·핵심 모델은 memory `archetype-refactor-roadmap` 참조.
> ⚠️ 라인 번호는 이동할 수 있으니 함수명/문자열로 재확인할 것.
> **남은 작업: #2 + #4(design_presets 심층 클린업 + 죽은 타입) 뿐.**

## 이번 세션 완료 요약 (커밋 `b4fa6c3` ~ `fa5cb81`, develop)
- **축 값 프리셋**: Stage1 배선(`resolveAxisPool` @ axis-tags.ts — spec.axis_values 있으면 도메인 축 풀 '대체', 없으면 태그필터 폴백) → Stage2b 커스텀 axis_values(컬럼+폼) → Stage2a 빌트인 14종 콘텐츠(골든 556→560).
- **디자인/글유형 탭 대정비**: ③ TemplateOverridesEditor 제거(clone→커스텀 대체), HTML 프리셋·전체 강제 제거, 미리보기 커스텀 폼 이동, '화면 구상'→'디자인' 용어 통일, 디자인 영역 평면화(표), 디자인 섹션을 커스텀 아래로.
- **글유형 on/off 통합 허브**: ①'이 도메인의 글 유형'이 빌트인+커스텀 on/off 를 즉시저장으로 제어. 커스텀 매니저=정의 전용(켜기/끄기 제거). 후보 목록 유형 필터에 커스텀 포함.
- **공통원칙**: 편집 보이스 3줄로 재정의(안전/데이터 규칙은 buildPrompt 하드코딩과 중복 제거).

---

## 남은 작업 (우선순위)

### 1. 글유형별 `academy_types` 분기 — **완료(2026-07-14)**
- **핵심 모델(중요)**: 학원 타입은 **글유형 `academy_types`가 단일 소스**. 선택값 있으면 그 타입 학원만, **비어 있으면 학원정보를 아예 안 씀**(지역형이어도 가이드/체크리스트 중심). 지역 유무와 무관하게 academy_types 가 게이트. 도메인 레벨 폴백/필터는 **제거**(아래).
- **빌트인 기본값**(사용자 지정): T01=`[exam_academy,academy]` · T07=`[exam_academy,academy]` · T11=`[license_test_course,license_center]`(⚠️ 현재 데이터에 해당 타입 0건 → T11 당장은 학원 후보 0. 서버가 그 타입 내려주면 채워짐) · T14=`[exam_academy]` · T15=`[exam_academy,academy]`. 나머지(키워드형 등)는 미설정=학원 미사용.
- **학원 타입 5종 정식 목록**: `constants.ts ACADEMY_TYPES = [academy, exam_academy, license_test_course, indoor_academy, license_center]`. 서버는 현재 2종만 내려주지만 5종 전부를 커스텀 폼 체크박스에 노출(`/options.academy_types`).
- **도메인 「글 생성 사용 타입」 제거**: 이제 학원 타입은 글유형별 단일 소스라 도메인 레벨 필터는 삭제. `Academies` 패널의 해당 섹션·상태(`generationTypes`)·핸들러·투어 스텝(`academy-types`)·`ACADEMY_TYPE_COPY`/`typeLabel` 제거. **`domains.academy_type_filter` 컬럼·`db.academyTypeFilter()`·domainOut 필드·PATCH 직렬화·updateDomain allow-list 는 dormant**(design_presets 처럼 후속 정리 대상). 워커 generate 결과의 `academy_type_filter` 필드도 제거.
- **변경 위치**:
  - `constants.ts`: `TemplateSpecShape.academy_types?: string[]`, `ACADEMY_TYPES`, T01/T07/T11/T14/T15 값.
  - `db.service.ts`: `custom_templates.academy_types` 컬럼(스키마 2곳+마이그레이션), `parseAcademyTypes`/`serializeAcademyTypes`, `getTemplateSpec`(빌트인 통과)·`customTemplateSpec`·`customTemplateOut`·create/update/import 직렬화.
  - `admin.controller.ts`: create/clone(`spec.academy_types` 복사)/update(body 통과)/export 배선 + `/options.academy_types`. **덤: export 맵이 `axis_values`도 누락하던 것 함께 보정**.
  - `worker.service.ts`: `resolveAcademyTypes(spec)`(preset 있으면 그것, 없으면 `[]`) + `pickAcademiesForRegion(…, academyTypes)`(빈 배열=후보 0)·`buildFacts` 스레딩. 생성 루프·prune 통일.
  - `post-rendering.ts`: `fallbackImagesForPost` 도 포스트 글유형 academy_types 기준(없으면 학원 이미지 폴백 없음). **렌더 경로라 load-bearing**.
  - UI(`DomainClient.tsx`,`types.ts`): 커스텀 폼 학원 타입 체크박스(5종, 기본 미선택, 집계 카운트 병합). **지역형 kind(primary=region)일 때만 노출**(academy_centric 아님 — regional_hub/local_exam_mix 도 학원 씀).
- **검증 완료**: 골든 0-diff, typecheck(양쪽), qa:posts, verify:company-clean, **DbService 직접 종단검증 15건**(빌트인 값 / resolve preset·empty / listAcademies 실필터 academy 7·exam_academy 329·둘 336·시험장계열 0). LLM 실생성·라이브 UI 조작은 미실행(수동 확인 필요).

### 2. `design_presets` 심층 백엔드 클린업 (dormant 완전 제거)
- **현재**: 프론트 UI·POST/DELETE 엔드포인트·getDomainDetail 포함은 제거됨(`cbcb740`). **남은 dormant**:
  - db.service: `design_presets` 테이블(2곳 CREATE + 마이그레이션), `listDesignPresets`/`getDesignPreset`/`createDesignPreset`/`deleteDesignPreset`/`designPresetOut`.
  - admin.controller: `extractDesignPresetFromHtml`, `getUploadedDesignPresetForPost`, 글 상세/렌더의 uploaded 테마 분기(`uploadedDesignTheme`/`uploadedDesignChips`), export 필터의 `"uploaded:"` 허용.
  - worker.service: `buildPrompt`/`buildRepairPrompt`/`designWritingGuide`/`designStructureGuide`/`uploadedPresetGuide`의 `designPreset` 파라미터, `isSelectableDesign`의 `"uploaded:"` 허용, 디자인 토큰 필터의 `"uploaded:"`.
  - lib/types: `DesignPreset`(죽은 타입, #4).
- **추가 dormant(2026-07-14, #1에서 발생)**: `domains.academy_type_filter` 컬럼 + `db.academyTypeFilter()` + `domainOut` 의 `academy_type_filter` 필드 + admin.controller PATCH 직렬화(L118 근처) + `updateDomain` allow-list 의 `academy_type_filter` + `lib/types` `DomainConfig.academy_type_filter`. 학원 타입이 글유형 단일 소스로 이관돼 더는 읽지 않음. #2와 함께 정리 권장.
- **데이터 안전**: 이번 세션에 `design_presets` 0행 / posts·customs·domains의 `uploaded:` 디자인 0 확인.
- **접근**: 워커 시그니처에서 `designPreset` 제거(리팩터), 렌더 분기 제거, db 함수·테이블 제거, `"uploaded:"` 허용 제거.
- **검증**: 골든 0-diff(슬롯 생성 무관) + **실생성 1건 + 글 상세 렌더 확인**(프롬프트/렌더 경로 변경이므로).
- **리스크**: 워커·렌더 load-bearing. 중~높음. **프로젝트 전체 점검 때 권장.**

### 3. ~~커스텀 clone 시작점 `axis_values` 프리필 버그~~ — **오탐, 종료(2026-07-14)**
- **결론: 버그 아님. 코드 수정 불필요.** `listCustomTemplates`(db.service:445)는 `.map(customTemplateOut)`을 거치고, `customTemplateOut`(≈L1006)이 `axis_values: parseAxisTags(row.axis_values) ?? {}`로 **이미 파싱**한다. `getDomainDetail`·`/templates` 모두 이 경로를 씀. 인수인계서에 적힌 "raw JSON 문자열 미파싱"은 오독이었음(dba960c/Stage2b 시점부터 파싱됨).
- **빈 채로 보였던 이유**: DB의 기존 커스텀들이 Stage 2b 이전 생성이라 `axis_values`가 비어 있어, 복제 시 빈 값이 그대로 채워진 것(정상 동작). 실제 값을 넣고 복제하면 프리필 정상 — 다음 세션이 probe DB로 검증함.
- 원 세션이 브라우저로 재현하지 않고 코드에서 추측한 **오탐**(원인 진단도 틀림). 참고용 기록으로만 남김.

### 4. `lib/types` `DesignPreset` 죽은 타입 — #2와 함께 제거.

---

## 검증 관례 (필수)
- 각 단계 **골든 0-diff**: `npm run test:golden`(러너 `apps/api-nest/scripts/tests/golden-runner.ts`, 픽스처 `golden-slots.json`, 현재 560 슬롯; 의도 변경 시만 `--update`).
- 커밋 게이트: `verify:company-clean && typecheck && qa:posts (&& test:golden)`를 `&&`로 묶어 커밋(bare git commit 금지, pre-commit 훅이 company-clean 자동).
- UI는 typecheck + `localhost:4300` 실조작(완전 자동 e2e 아님).

## 참고 (패턴 원본)
- **축 값 프리셋 패턴**(academy_types 분기의 템플릿): `resolveAxisPool`(axis-tags.ts), `spec.axis_values`, Stage2b 커스텀 컬럼·폼.
- 커밋은 develop 브랜치. 다른 파일에 사용자 병렬 작업(`academy-research.*`)이 섞일 수 있으니 커밋 시 파일 지정.
