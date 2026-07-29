# T01 Hybrid v1 Prompt 계약

Hybrid는 기존 `buildPrompt()`의 legacy narrative scaffold를 사용하고, 뒤에 T01 hybrid 계약을 추가한다. 계약은 typed 후보 facts, 실제 소재지, 주변 후보 구분, 대표 리뷰와 FAQ/checklist 역할만 전달한다.

생성 prompt의 핵심 제약은 다음과 같다.

- 제공된 후보와 확인된 사실만 사용한다.
- 주변 후보를 요청 지역 소재 후보로 표현하지 않고 km·이동시간을 쓰지 않는다.
- 후보 설명은 사실 → 지역 이용자 의미 → 적합 이용자 → 중요한 확인사항 순으로 유도한다.
- 리뷰는 제공된 대표 1건만 연결된 학원 설명 뒤에 표시한다.
- 체크리스트는 행동 목록, FAQ는 추가 설명으로 분리하며 중복 FAQ는 생략한다.

비교표 셀 검증, 셔틀·합격률 문맥, 리뷰 count/source, semantic overlap 같은 상세 규칙은 prompt에 rule ID나 내부 필드명으로 노출하지 않고 quality gate에서 검사한다.

