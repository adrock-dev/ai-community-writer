# T01 Legacy Plus FAQ·체크리스트 dedupe

생성 후 `dedupeLegacyPlusDecisionSupport()`이 checklist와 FAQ를 읽기·구조적으로 정리한다.

- checklist는 `-`, `*`, 숫자, `✅/☑/✔` 불릿을 모두 인식한다.
- FAQ는 H3 block 단위로 처리한다.
- normalized text, topic, intent, action을 비교한다.
- 같은 확인 행동이면 checklist를 남기고 FAQ block 전체(질문·답변)를 제거한다.
- 유효 FAQ가 없으면 FAQ heading도 함께 제거한다.
- FAQ끼리 또는 checklist끼리 중복은 warning으로 남긴다.

예를 들어 “셔틀 운행 여부와 노선을 문의하세요”와 “셔틀버스는 운행하나요? 학원에 문의해야 합니다”는 같은 verification topic으로 본다. 반면 주변 후보를 왜 포함했는지 설명하는 FAQ는 checklist의 실행 행동과 역할이 달라 유지될 수 있다.

후처리는 의미를 새로 만들지 않고 중복 block만 제거한다. Legacy·v2·Hybrid에는 적용하지 않는다.
