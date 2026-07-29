# T01 Hybrid v1 구현 결과

## 구현 범위

`t01_hybrid_v1`을 T01 전용 opt-in generation mode로 추가했다. generation mode 생략 및 `legacy`는 기존 legacy, `t01_data_gated_v2`는 기존 v2를 유지한다. hybrid를 비T01에 요청하면 명시적으로 거부한다.

핵심 경로는 `WorkerService.processGenerate()` → 기존 후보 선택 → `buildT01DataGatedContext()` → `buildT01HybridContext()` → hybrid prompt → `normalizeGeneratedMarkdown()` → `dedupeHybridDecisionSupport()` → `t01HybridQualityIssues()`다.

## 변경 파일

- `apps/api-nest/src/t01-hybrid.ts`: hybrid context, 대표 리뷰 selector, prompt contract, decision-support dedupe, hybrid gate.
- `apps/api-nest/src/worker.service.ts`: T01-only routing, hybrid prompt/gate/dedupe 적용, 운영 Markdown 정규화 helper export.
- `apps/api-nest/src/admin.controller.ts`: 명시적 mode 검증 및 비T01 hybrid 요청 거부.
- `apps/api-nest/src/scripts/run-live-t01-ab.ts`: `--include-hybrid` 평가 경로, snapshot review hydration, 운영과 같은 Markdown/title 후처리.
- `apps/api-nest/test/t01-hybrid.test.ts`: review·dedupe·gate 회귀.

DB migration, 후보 선택, legacy/v2 prompt 및 기본 provider/generation mode는 변경하지 않았다.

## 검증

- 전체 Vitest: 18 files / 178 tests passed
- typecheck: passed
- build: passed

