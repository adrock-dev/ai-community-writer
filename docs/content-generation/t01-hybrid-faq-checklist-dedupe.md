# T01 Hybrid FAQ·Checklist 중복 제거

`dedupeHybridDecisionSupport()`는 생성 후 checklist와 FAQ를 읽기 전용 규칙으로 정규화한다.

각 항목은 `topic`, `intent`, `action`으로 판정한다. 동일 topic·intent·action 또는 정규화된 동일 문장은 중복이다.

- 실행 행동은 checklist를 우선 보존한다.
- 같은 확인 행동을 질문형으로 바꾼 FAQ는 제거한다.
- FAQ 내부 중복도 제거한다.
- 유효한 FAQ가 없으면 FAQ heading을 새로 만들지 않는다.
- “상담받은 내용을 기록”은 “학원에 상담 문의”와 구분해 오탐하지 않는다.

gate는 남은 semantic overlap을 warning으로, 빈 heading·빈 item·완전 동일 문장을 hard failure로 기록한다.

