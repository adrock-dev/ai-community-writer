# T01 live A/B 자동 결과

## 실행 가능성 결과

실제 생성 콘텐츠가 없으므로 품질 우열을 평가한 결과가 아니다. 자동 평가는 입력 snapshot, pair 무결성, 실행 실패 및 비어 있는 결과만 정확히 기록했다.

| 항목 | legacy | T01 v2 |
| --- | ---: | ---: |
| 계획 pair | 8 | 8 |
| 사전 제외 (`min_generate=2`) | 1 | 1 |
| 실제 provider 호출 | 7 | 7 |
| 생성 성공 | 0 | 0 |
| 생성 실패 | 7 | 7 |
| 본문 기준 hard failure `empty_output` | 7 | 7 |
| warning | 0 | 0 |
| repair 실행 | 0 | 0 |
| 입력/출력 token | provider 미반환 | provider 미반환 |
| 비용 | provider 미반환 | provider 미반환 |

근거 파일은 `data/content-generation-evaluation/live-ab-20260720-escalated/metrics/automatic-metrics.jsonl` 및 `execution-summary.json`이다.

## 자동 검사 범위와 이번 실행값

평가 스크립트는 후보명, 본문 길이, H2/H3, 문단/표/목록, 공통 facts 사용률, 질문/감탄사, 금지 최상급 표현, distance expansion 공개, 결정 지원 섹션을 계산하도록 만들었다. 생성 결과가 빈 문자열이므로 7개 호출의 모든 콘텐츠 지표는 0 또는 `false`다. 이는 legacy/v2의 실제 품질 차이가 아니라 provider 실행 불가의 결과다.

T01 v2 전용 `t01QualityIssues()`도 본문이 없을 때 실행하지 않았고, 기존 quality gate의 `empty_output`만 기록했다. 읽기 전용 평가기는 post/job 상태를 바꾸지 않기 위해 worker repair 경로를 호출하지 않았으므로 repair 효율성도 비교할 수 없다.

## 사실·지역 정확성

본문이 없으므로 다음을 콘텐츠 오류 0건으로 해석하면 안 된다.

- 입력에 없는 학원/가격/셔틀/후기/합격률 생성
- stored region 오표현
- 거리 후보를 대상 지역 소재로 표현
- 직선거리의 이동시간·도로거리 오표현
- 비교표 facts 불일치

이들은 생성 가능한 환경에서 실제 output에 대해 다시 검사해야 한다. 현재 기록의 `region-related=0`, `table=0`은 검사 대상 텍스트가 없었다는 의미다.

## 품질 결론

자동 결과로 legacy와 v2의 승자를 정하지 않는다. 사람 평가도 아직 유효하게 시작할 수 없다.
