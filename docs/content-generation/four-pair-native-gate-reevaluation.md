# 4개 pair T01 v2 native gate 재평가

재평가 시각: 2026-07-20. 새 글을 생성하지 않았고, 저장된 raw output과 snapshot의 `v2TypedFacts`만 읽어 `t01QualityIssues()`를 다시 적용했다.

- 입력: `data/content-generation-evaluation/codex-cli-single-pair-20260720/` 및 `data/content-generation-evaluation/codex-cli-additional-pairs-20260720/`
- 재평가 artifact: `data/content-generation-evaluation/t01-native-gate-reevaluation-20260720/summary.json`
- legacy native quality는 변경하지 않았다.

| 지역 | legacy 기존 native | v2 기존 native | v2 재평가 native | 제거된 rule | 새 rule | neutral hard (legacy/v2) |
| --- | ---: | ---: | ---: | --- | --- | --- |
| 익산시 | 3 | 6 | 4 | shuttle, pass-rate | 없음 | 0 / 0 |
| 동해시 | 4 | 6 | 4 | shuttle, pass-rate | 없음 | 0 / 0 |
| 고성군 | 4 | 4 | 2 | shuttle, pass-rate | 없음 | 0 / 0 |
| 원주시 | 2 | 5 | 3 | shuttle, pass-rate | 없음 | 0 / 0 |
| 합계 | 13 | 21 | 13 | 8건 | 0건 | 0 / 0 |

셔틀·합격률 hard failure 8건은 모두 제거됐다. 익산·동해·고성에는 근거 없는 셔틀 가능성 암시 warning이 각 1건 남는다. warning은 native hard total에 포함하지 않았으며, 생성물의 사실 오류 또는 품질 승패를 뜻하지 않는다.

남은 v2 native hard failure는 기존 구조 rule이다: `too_long_*` 2건, `adjacent_headings_without_body` 4건, `missing_available_image_slot` 4건, `exposes_internal_fact_language` 2건, `repeated_sentence_1` 1건. 이번 변경은 이 rule들의 구현, severity, 결과를 수정하지 않았다.
