# T01 Hybrid Four-Triple Result

실행 상태: `not_executed_after_phase_1_gate_failure`

요청된 4개 표본은 익산시(B_supplement), 동해시(B_supplement), 고성군(C_far), 원주시(E_facts_sparse)였다. 새 결과 경로에서 익산시 clean triple만 먼저 실행했다.

익산시 Hybrid native gate가 `t01_hybrid_empty_checklist` hard failure를 반환해 clean triple gate가 `failed`가 되었으므로, 사용자 지시의 Phase 2 조건에 따라 동해시·고성군·원주시 A/B/C 생성은 실행하지 않았다.

따라서 이 실험에서 실제로 생성된 콘텐츠는 Legacy/v2/Hybrid 3개이며, 4 triple/12 콘텐츠 결과나 모드별 비교 결론은 존재하지 않는다.
