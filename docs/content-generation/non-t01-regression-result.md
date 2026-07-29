# 비T01 회귀 결과

`shouldUseT01DataGatedMode()`은 정확히 `T01`과 명시적 `t01_data_gated_v2`의 조합만 true로 반환한다.

- T01 + v2: true
- T01 + legacy: false
- T14 + v2: false
- T01과 유사한 custom template ID + v2: false

`t01-mode-isolation.test.ts`는 T14 legacy prompt가 기존 string modifier를 유지하고 T01 structured contract를 포함하지 않음을 확인한다. `structure-variant.test.ts`, `quality-gate.test.ts`, `slot-title.test.ts`, `article-pattern-filter.test.ts`는 Phase A와 최종 suite 모두에서 통과했다.

`template-endpoints.test.ts`는 API가 `generation_mode=t01_data_gated_v2`만 job payload에 보존하고, 생략 또는 임의 값은 `legacy`로 고정하는 것을 검증한다.

공통 extraction이 바꾼 것은 Worker 내부 후보 선택 구현의 위치뿐이며 SQL/filter/order/sample 규칙은 fixture가 고정한다.
