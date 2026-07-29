# T01 Legacy Plus 4-Pair 생성 결과

## 실행 범위

새 평가 결과는 `data/content-generation-evaluation/t01-legacy-plus-blind-20260721-0940/`에 저장했다. 과거 smoke artifact는 재사용하지 않았다.

| 표본 | 유형 | Legacy | Legacy Plus | pair 무결성 |
| --- | --- | --- | --- | --- |
| 전북특별자치도 익산시 | B_supplement | 성공 | 성공 | 통과 |
| 강원특별자치도 동해시 | B_supplement | 성공 | 성공 | 통과 |
| 강원특별자치도 고성군 | C_far | 성공 | 성공 | 통과 |
| 강원특별자치도 원주시 | E_facts_sparse | 성공 | 성공 | 통과 |

모든 생성은 `codex` / `gpt-5.6-luna` / Codex CLI `0.144.6` / `content_generation` / timeout 600초로 실행했다. repair, fallback, 운영 DB 저장은 비활성이다. 각 pair는 생성 전에 하나의 고정 snapshot을 읽고 두 mode가 같은 후보 ID·순서·slot seed·model·timeout·CLI binary/version을 사용했다.

총 8개 생성물의 평균 생성 시간은 76.026초다. CLI usage는 각 quality log와 private metrics에 보존했으며 비용은 `not_measured_chatgpt_cli`로 기록했다.

## 현재 review 계약과 요청 검증 조건의 차이

현재 코드의 Legacy Plus 계약은 **글 전체 1개가 아니라 적격 후보 학원별 최대 1개**다. 따라서 익산 3건, 동해 2건, 고성 2건, 원주 3건의 source review가 선택됐다. 요청에 포함된 “글 전체 0~1개, 2개 이상 실패” 조건은 현재 코드와 일치하지 않는다. 이 문서는 코드 우선 원칙에 따라 학원별 review 계약으로 audit했으며, 이 차이를 readiness blocker로 별도 기록했다.

## Native 결과

Native hard issue는 mode별 rule 계약이 달라 직접 품질 점수로 비교하지 않았다.

| mode | native hard issue 수 | 실제 항목 |
| --- | ---: | --- |
| Legacy | 3 | 익산 length 1, 동해 length 1·문장 반복 1 |
| Legacy Plus | 6 | 익산 length 1·review generalized 1, 동해 review source/count 3, 고성 review generalized 1 |

동해 Legacy Plus는 모델이 요구된 한 줄 review 형식 대신 source와 quote를 각각 인용 줄로 분리해 출력했다. 고성·익산의 `review_generalized`는 review 주변의 안전한 비일반화 문장이 native detector에 걸린 사례인지 별도 code-level 재검증이 필요하다. 이번 작업에서는 gate를 변경하지 않았다.

## 결론 제한

생성·무결성·blind material 작성은 완료됐지만 사람 평가 전에는 어느 mode가 더 자연스럽거나 유용한지 결론 내리지 않는다.
