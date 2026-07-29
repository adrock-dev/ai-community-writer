# FAQ·체크리스트 의미 중복 분석

현재 기본 prompt는 checklist를 포함시키고 FAQ는 구조 회전일 때 2~4개로 둔다([worker.service.ts](../../apps/api-nest/src/worker.service.ts:782)). T01 v2 FAQ도 seed의 6번째 회전에서 선택된다([t01-data-gated.ts](../../apps/api-nest/src/t01-data-gated.ts:399)). 두 섹션을 함께 만들 때 topic 예약이 없다.

실제 중복 예:

| pair | FAQ | checklist | 의미상 중복 |
| --- | --- | --- | --- |
| 익산 legacy | “수강료는 전화로 무엇을 물어봐야 하나요?”, “셔틀이 있나요?”, “수강 기간은?” | 교육비/추가 비용, 셔틀 노선·시간, 평일·주말·예약 | 비용 검증, 셔틀 확인, 일정 확인 |
| 동해 legacy | 비용·셔틀·기간·초보 질문 | 비용, 셔틀, 저녁/주말, 시작일/대기기간, 초보자 피드백 | 비용·셔틀·일정·초보 교육 |
| 고성 legacy | 비용·셔틀·수강기간 | 면허별 비용, 고성 출발 셔틀, 첫 수업/횟수/예약 | 비용·셔틀·일정 |

문장 자체가 달라도 `topic=shuttle, intent=verification, action=contact_academy`처럼 동일하므로 중복이다. v2가 FAQ를 생략한 pair에서는 문제가 줄었지만, FAQ 선택 여부가 내용 중복을 해결하는 규칙은 아니다.

책임 위치: 본문·표·checklist 후보를 만든 **후**, FAQ 후보를 만들 때 semantic dedupe 하는 것이 적합하다. 사후 gate만으로 제거하면 끊긴 문장/섹션을 수리해야 하고, 생성 전만으로는 실제 FAQ 표현을 알 수 없다. 따라서 생성 prompt가 topic budget을 주고, output semantic gate가 경고/repair 근거를 제공하는 이중 구조가 필요하다.
