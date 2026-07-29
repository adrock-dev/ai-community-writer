# T01 Hybrid 콘텐츠 전략

## 권장 결론

판정: **build_hybrid_mode**. 단, 대표 review selector와 FAQ/checklist semantic dedupe를 포함한 최소 구현 범위가 선행 조건이다. legacy 또는 v2의 교체가 아니라 별도 opt-in `t01_hybrid_v1`을 권장한다.

## 유지·단순화 판단

| v2 기능 | 판단 | 이유 |
| --- | --- | --- |
| typed academy candidate | required | 후보별 facts·결측·ID 기준 |
| retrieval source/stored region/region relation | required | 인근 후보 오표현 방지 |
| straight-line distance | simplify | 내부 추출/검증용만 남기고 본문 payload에서 제외 |
| data-gated variant/compatible filter | required | seed가 부적합 구조를 선택하지 않게 함 |
| typed modifier adapter | optional | 구조·facts 조건이 필요한 modifier만 사용 |
| v2 severity/claim context detector | required | prompt를 길게 만들지 않고 사실 claim 검수 |
| legacy flat facts | remove from hybrid payload | SEO keyword·좌표·review theme가 나열 문장을 유도 |

## Hybrid 동작

`기존 pickAcademiesForRegion()` → 기존 T01 typed candidate/provenance/variant → article-level review selector → legacy narrative scaffold → FAQ/checklist semantic budget → T01 v2 factual gate + review/dedupe gate.

후보 설명은 “확인된 사실 → 지역 독자에게 주는 의미 → 적합한 이용자 → 필요한 확인사항” 순서지만, 모든 missing field를 카드마다 나열하지 않는다. 인근 후보가 있으면 도입에서 포함 이유를 한 번 설명하고, 해당 후보 카드/표에 실제 소재지만 다시 밝힌다. km는 쓰지 않는다.

## 구현 방식 비교

| 방식 | 장점 | 위험 | 판정 |
| --- | --- | --- | --- |
| A. legacy prompt에 v2 facts/review 주입 | 작은 diff | legacy facts와 typed facts가 충돌하고 gate/variant 결합이 흐림 | 차선 |
| B. v2 prompt 안전 지시 축약 + legacy narrative block | 기존 v2 경로 재사용 | v2 contract와 base prompt의 중복 지시가 남음 | 가능 |
| C. 공통 narrative template + mode별 adapter | 장기적 정리 | 공통 계층 회귀 범위 증가 | 추후 style profile 단계 |
| D. 별도 hybrid generation mode | legacy/v2 보존, A/B/C 공정, rollback 용이 | T01 내부 코드가 하나 늘어남 | **권장** |

예상 변경 위치(향후 구현): `t01-data-gated.ts`(hybrid context/selector/contract/gate), `worker.service.ts`(T01-only mode routing), 신규 `t01-review-selection.ts`, 신규 `t01-decision-support.ts`, 관련 T01 tests와 A/B runner. DB migration·비T01 변경은 필요 없어야 한다.
