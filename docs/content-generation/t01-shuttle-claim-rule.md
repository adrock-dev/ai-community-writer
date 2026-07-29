# T01 v2 셔틀 claim rule

대상 rule은 `t01_unverified_shuttle_claim`이다. T01 v2 typed candidate 중 어느 후보에도 `shuttle` fact가 없을 때만 평가한다.

| 문맥 | 판정 |
| --- | --- |
| “셔틀버스를 운행합니다”, “무료 셔틀을 제공합니다”, “특정 지역 셔틀이 있습니다” | hard failure |
| “셔틀 운행 여부는 확인이 필요합니다”, “노선·시간을 문의하세요”, “운행 정보는 확인되지 않았습니다” | pass |
| “셔틀 운행을 보장하는 것은 아니다”, “셔틀이 운행되는지 묻기”, “직선거리가 셔틀 이용 가능성을 뜻하지 않는다” | pass |
| “셔틀 이용이 가능할 수 있습니다” | warning: `unverified_shuttle_implication` |
| “이 학원은 셔틀을 운영하므로 자세한 시간은 확인하세요” | hard failure |

마지막 행은 확인 권고가 있어도 먼저 “운영”이라는 사실을 주장하므로 통과시키지 않는 경계 사례다. 실제 셔틀 fact가 존재하면 이 rule은 hard failure를 내지 않는다.

이번 변경은 T01 v2 native gate에만 적용된다. legacy 및 비T01 gate의 셔틀 판정 계약은 바뀌지 않는다.
