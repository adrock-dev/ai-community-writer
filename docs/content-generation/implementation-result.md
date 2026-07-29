# T01 데이터 기반 개선 구현 결과

구현일: 2026-07-20  
상태: **완료 — opt-in, 기본 legacy**

## 구현 경계

`WorkerService.processGenerate()`는 `slot.template_id === "T01"` 및 job payload의 `generation_mode === "t01_data_gated_v2"`일 때만 T01 v2 context를 만든다. 이외 모든 경우에는 기존 facts, structure seed, string modifier, quality gate 경로를 유지한다.

- `apps/api-nest/src/academy-candidate-selection.ts`: 기존 후보 선택을 동작 변경 없이 추출하고 trace를 부가했다.
- `apps/api-nest/src/t01-data-gated.ts`: typed candidate, variant resolver, typed modifier adapter, structured contract, T01 quality rule을 제공한다.
- `apps/api-nest/src/worker.service.ts`: 동일한 picker 결과에 provenance를 붙여 v2 prompt/quality만 opt-in한다.
- `apps/api-nest/src/admin.controller.ts`: 생성 job payload에 `legacy`(기본) 또는 `t01_data_gated_v2`를 기록한다. 관리자 UI는 변경하지 않았다.

DB migration, academy 데이터 변경, 외부 API/학원 정보 수집은 없었다.

## 검증 결과

- 후보 fixture/trace/T01 v2/isolation: **4 files, 25 tests passed**
- 관련 regression 묶음: **8 files, 104 tests passed**
- 전체 API test suite: **13 files, 137 tests passed**; `typecheck` 및 `build` 통과.
- LLM을 호출하지 않았다. 따라서 결과 문체·실제 생성 품질 향상은 주장하지 않고, payload·variant·prompt·quality rule dry-run만 검증했다.
