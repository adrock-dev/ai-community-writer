# Codex CLI 4-Pair 자동 결과

익산시 B supplement, 동해시 B supplement, 고성군 C far, 원주시 E facts-sparse를 평가했다. 각 pair는 동일 candidate snapshot·순서·slot seed·model을 공유했다.

| 지역 | native legacy | native v2 | neutral legacy hard | neutral v2 hard | neutral warning (L/V2) | v2 false positive |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 익산시 | 3 | 6 | 0 | 0 | 0 / 1 | 2 |
| 동해시 | 4 | 6 | 0 | 0 | 1 / 0 | 2 |
| 고성군 | 4 | 4 | 0 | 0 | 1 / 0 | 2 |
| 원주시 | 2 | 5 | 0 | 0 | 0 / 0 | 2 |
| 합계 | 13 | 21 | 0 | 0 | 2 / 1 | 8 |

Native 합계는 모드별 gate 계약이 달라 품질 승패에 사용하지 않는다. Neutral 사실 안전 hard failure는 `0/0`이다. 다만 v2 native shuttle/pass-rate rule이 총 8회 false positive였으므로 전체 A/B 전에 문맥 규칙 진단이 필요하다. 4-pair 생성 시간 평균은 legacy 78.356초, v2 72.936초이며 CLI 비용은 측정하지 않았다.

