# Codex CLI 추가 3-Pair 결과

결과 경로: `data/content-generation-evaluation/codex-cli-additional-pairs-20260720/`. 고정 snapshot만 사용했고 `codex` / `gpt-5.6-luna` / CLI `0.144.6` / timeout `600초` / `content_generation` profile로 실행했다. repair, fallback, 운영 저장은 비활성이다.

| pair | 지역 | 유형 | 후보 출처 | legacy/v2 | integrity |
| --- | --- | --- | --- | --- | --- |
| 01 | 강원특별자치도 동해시 | B_supplement | region-like 2 + 삼척시 supplement 1 | 성공 / 성공 | 전체 true |
| 02 | 강원특별자치도 고성군 | C_far | region-like 1 + 속초시 far 1 | 성공 / 성공 | 전체 true |
| 03 | 강원특별자치도 원주시 | E_facts_sparse | region-like 3 | 성공 / 성공 | 전체 true |

source snapshot은 기존 `live-ab-20260720`의 `pair-03`, `pair-05`, `pair-08`이다. Native failure 수는 동해 `4/6`, 고성 `4/4`, 원주 `2/5`이지만 다른 gate 계약이므로 비교 지표가 아니다. Neutral hard failure는 세 pair 모두 `0/0`이며 v2 shuttle/pass-rate native failure는 모두 confirmation/missing-fact 문맥의 false positive다.

