# 다음 세션 인수인계 (2026-07-13)

> 이번 세션에서 "축 값 프리셋 + 디자인/글유형 탭 대정비 + 글유형 on/off 통합"을 마쳤고,
> 아래를 **다음 작업**으로 남겼다(그 중 #3은 이후 검증 결과 **오탐으로 종료**). 상세 세션 이력·핵심 모델은 memory `archetype-refactor-roadmap` 참조.
> ⚠️ 라인 번호는 이동할 수 있으니 함수명/문자열로 재확인할 것.

## 이번 세션 완료 요약 (커밋 `b4fa6c3` ~ `fa5cb81`, develop)
- **축 값 프리셋**: Stage1 배선(`resolveAxisPool` @ axis-tags.ts — spec.axis_values 있으면 도메인 축 풀 '대체', 없으면 태그필터 폴백) → Stage2b 커스텀 axis_values(컬럼+폼) → Stage2a 빌트인 14종 콘텐츠(골든 556→560).
- **디자인/글유형 탭 대정비**: ③ TemplateOverridesEditor 제거(clone→커스텀 대체), HTML 프리셋·전체 강제 제거, 미리보기 커스텀 폼 이동, '화면 구상'→'디자인' 용어 통일, 디자인 영역 평면화(표), 디자인 섹션을 커스텀 아래로.
- **글유형 on/off 통합 허브**: ①'이 도메인의 글 유형'이 빌트인+커스텀 on/off 를 즉시저장으로 제어. 커스텀 매니저=정의 전용(켜기/끄기 제거). 후보 목록 유형 필터에 커스텀 포함.
- **공통원칙**: 편집 보이스 3줄로 재정의(안전/데이터 규칙은 buildPrompt 하드코딩과 중복 제거).

---

## 남은 작업 (우선순위)

### 1. 글유형별 `academy_types` 분기 (기능 — 사용자 제안, 이관 합의)
- **목표**: 학원 타입 필터를 도메인 레벨 → 글유형별로. **축 값 프리셋(axis_values)과 동일 패턴.**
- **현재**: `worker.service.ts` 학원 facts 수집부(≈L280)에서 `this.db.academyTypeFilter(domain)`(도메인 레벨)을 **모든 유형에 동일 적용** → `listAcademies(domain, { region, academy_types })`.
- **접근**: `TEMPLATE_SPECS`에 `academy_types?: string[]`(빌트인=코드) + `custom_templates`에 컬럼(커스텀). 워커가 "유형 프리셋 있으면 그것, 없으면 도메인 `academy_type_filter` 폴백"(=`resolveAxisPool`과 동형). UI: 커스텀 폼에 입력 추가, 「학원자료」 탭의 도메인 필터는 **기본값**으로 유지.
- **효과 범위(중요)**: `academy_centric` 유형만 — **T01 local_best · T11 test_center · T14 academy_profile + 그 kind 커스텀**. 나머지 정보성 유형은 학원 facts 자체를 안 모으므로 무관.
- **검증**: 골든(도메인만 설정 시 0-diff), 실생성 1건으로 학원 facts 필터 확인.
- **리스크**: 워커(생성) load-bearing. 중.

### 2. `design_presets` 심층 백엔드 클린업 (dormant 완전 제거)
- **현재**: 프론트 UI·POST/DELETE 엔드포인트·getDomainDetail 포함은 제거됨(`cbcb740`). **남은 dormant**:
  - db.service: `design_presets` 테이블(2곳 CREATE + 마이그레이션), `listDesignPresets`/`getDesignPreset`/`createDesignPreset`/`deleteDesignPreset`/`designPresetOut`.
  - admin.controller: `extractDesignPresetFromHtml`, `getUploadedDesignPresetForPost`, 글 상세/렌더의 uploaded 테마 분기(`uploadedDesignTheme`/`uploadedDesignChips`), export 필터의 `"uploaded:"` 허용.
  - worker.service: `buildPrompt`/`buildRepairPrompt`/`designWritingGuide`/`designStructureGuide`/`uploadedPresetGuide`의 `designPreset` 파라미터, `isSelectableDesign`의 `"uploaded:"` 허용, 디자인 토큰 필터의 `"uploaded:"`.
  - lib/types: `DesignPreset`(죽은 타입, #4).
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
