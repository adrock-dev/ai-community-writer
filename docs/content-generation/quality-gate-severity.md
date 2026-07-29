# T01 v2 quality severity

legacy 및 비T01의 `articleQualityIssues(): string[]` 계약은 바꾸지 않았다. v2만 `T01QualityIssue`를 추가로 계산한다.

| severity | 현재 rule | worker 처리 |
|---|---|---|
| `hard_failure` | 표 후보 누락, 후보 H3 중복, 비primary 후보 실제 지역/확장 고지 누락, 직선거리의 도로거리·이동시간 오표현, 근거 없는 가격·셔틀·합격률·후기, 표 수강료 불일치 | 기존 repair loop의 실패 원인으로 추가, 최종 차단 |
| `warning` | 거리 확장 설명 부족, 질문형 과다 | 성공 job의 `quality_warnings`에 기록 |
| `score_penalty` | 상담 확인 전환 반복, H2 과밀 | 성공 job의 `quality_warnings`에 기록; 현재 점수 합산/차단은 하지 않음 |

repair 최대 횟수는 기존 payload `max_repair_attempts`(기본 2, 0~3 clamp)다. v2는 같은 hard-failure signature가 다시 나오면 추가 repair를 중단하고 `t01_repair_stop_reason` 및 전후 failure history를 job result에 남긴다. legacy repair 흐름은 변경하지 않았다.
