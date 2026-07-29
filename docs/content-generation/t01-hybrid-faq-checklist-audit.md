# T01 Hybrid FAQ / Checklist Audit

대상: `t01-hybrid-abc-clean-20260720-1710`, 익산시 Hybrid 1건.

Hybrid final markdown에는 FAQ heading이 없고, 등록 전 체크리스트에는 6개의 실행 항목이 있다. 같은 topic + verification intent를 FAQ 질문으로 반복한 항목은 확인되지 않았다. 빈 FAQ heading도 없다.

그러나 native gate의 checklist parser는 `-`, `*`, 숫자 목록만 항목으로 계산한다. 생성문은 `✅` marker를 사용했기 때문에 실제 내용과 달리 `hybrid_empty_checklist`를 hard failure로 반환했다.

이는 semantic dedupe가 중복을 제거한 결과가 아니라 marker parsing의 false positive다. 이번 작업은 quality gate 변경 금지이므로 parser를 바꾸지 않았고, 이 hard failure로 Phase 2를 중단했다.
