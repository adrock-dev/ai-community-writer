# 익산시 단일 pair: native와 neutral failure 분리

기준 artifact는 `data/content-generation-evaluation/codex-cli-single-pair-20260720/`이다. 전북특별자치도 익산시, 후보 ID 순서 `120, 149, 140, 122, 112`, `B_supplement`, `gpt-5.6-luna`의 원본 prompt·출력·snapshot·quality log를 읽기 전용으로 확인했다.

| 모드 | native hard failure | 분류 |
| --- | --- | --- |
| legacy | `too_long_5957` | `not_applicable` (neutral 사실 hard failure가 아닌 길이 신호) |
| legacy | `adjacent_headings_without_body` | `true_content_error` (H2 다음 H3 구조 신호) |
| legacy | `missing_available_image_slot` | `ambiguous` (본문 placeholder가 있어 renderer-level 확인 필요) |
| v2 | `too_long_5667` | `not_applicable` |
| v2 | `adjacent_headings_without_body` | `true_content_error` |
| v2 | `exposes_internal_fact_language` | `true_content_error` (“긍정 수강생 리뷰 보충자료” 노출) |
| v2 | `missing_available_image_slot` | `ambiguous` |
| v2 | `t01_unverified_shuttle_claim` | `false_positive` |
| v2 | `t01_unverified_pass_rate_claim` | `false_positive` |

셔틀 failure의 실제 문장은 “셔틀 운행 여부 …”와 “실제 셔틀 노선과 운행일은 변동될 수 있으니 … 직접 물어보세요”이고, 합격률 failure도 “합격률은 확인되지 않았으므로”다. 운행·합격률을 단정하지 않는데 `t01QualityIssues()` 정규식이 확인 질문·미확인 고지를 긍정 주장으로 오인했다.

legacy는 길 후보의 review evidence에 있는 “셔틀·방문 동선 만족” 요약을 언급하며, 합격률 긍정 주장은 없다. 이 failure는 modifier가 새 사실을 만들었다는 증거가 아니라 기본 상담 체크리스트와 v2 missing-fact 고지에 native regex가 반응한 것이다.

같은 typed snapshot의 neutral 평가 결과는 legacy hard `0`, v2 hard `0`, legacy gate gap `0`, v2 prompt-induced `0`, v2 gate improvement `0`, false positive `2`다. v2 내부 fact label 노출 warning은 `1`건이다. native `3` 대 `6`을 품질 비교값으로 쓸 수 없으며, 원본·snapshot·native log·neutral 결과가 모두 존재하므로 익산 분석 gate는 통과했다.

