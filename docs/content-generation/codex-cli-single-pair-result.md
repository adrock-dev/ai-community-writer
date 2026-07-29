# Codex CLI 단일 Legacy/V2 pair 결과

기준일: 2026-07-20

## 실행 조건

| 항목 | 값 |
| --- | --- |
| canonical 결과 경로 | `data/content-generation-evaluation/codex-cli-single-pair-20260720/` |
| target region | 전북특별자치도 익산시 |
| 유형 | `B_supplement` |
| 후보 ID/순서 | `120`, `149`, `140`, `122`, `112` |
| 후보 출처 | stored region-like 4곳 + nearby supplement 1곳 |
| slot seed | `live-ab-01-전북특별자치도 익산시` |
| provider / model | `codex` / `gpt-5.6-luna` |
| CLI | `/Users/leemj/.local/bin/codex`, `0.144.6` |
| timeout | 600초 |
| repair / fallback | 비활성 |
| DB | `data/admin.db` 읽기 전용 |
| execution profile | `content_generation` |

pair integrity는 target region, 후보 ID 배열, 후보 순서, slot seed, model, timeout, 공통 요청 매개변수 모두 `true`였다.

## 생성 및 quality 결과

| 항목 | Legacy | T01 v2 |
| --- | ---: | ---: |
| 생성 성공 | 예 | 예 |
| 본문 길이 | 5,957자 | 5,667자 |
| 생성 시간 | 76.534초 | 72.786초 |
| 표 | 1 | 1 |
| hard failure | 3 | 6 |
| warning | 0 | 0 |
| repair | 0 | 0 |
| CLI usage | 실행 당시 runner 미보존 | 실행 당시 runner 미보존 |
| 비용 | `not_measured_chatgpt_cli` | `not_measured_chatgpt_cli` |

Legacy hard failure: `too_long_5957`, `adjacent_headings_without_body`, `missing_available_image_slot`.

T01 v2 hard failure: `too_long_5667`, `adjacent_headings_without_body`, `exposes_internal_fact_language`, `missing_available_image_slot`, `t01_unverified_shuttle_claim`, `t01_unverified_pass_rate_claim`.

v2는 김제시 supplement 후보를 익산시 내부 후보로 오인하지 않고 주변 확장 후보·직선거리 근거로 구분했다. 그러나 quality gate가 확인하지 못한 셔틀·합격률 주장을 탐지했다. 이는 품질 우열 결론이 아니라, repair 없이 최초 생성물만 기록한 결과다.

생성 직후 Codex usage parser를 보완했으므로 향후 pair에는 CLI usage를 보존할 수 있다. 이 canonical pair는 보완 전 실행되어 usage가 `null`이다. 재실행하지 않았다.

## 제외 artifact

진단 중 evaluator 완료 상태가 늦게 반영되어 `data/content-generation-evaluation/codex-cli-single-pair-20260720-retry/`에 의도하지 않은 retry가 시작됐다. 이 retry는 중단했으며 complete pair가 아니므로 본 결과·지표·준비도에 포함하지 않는다. 운영 DB에는 쓰기 작업이 없었다.
