# T01 v2 variant 선택

기존 `local` archetype의 여섯 seed structure variant는 legacy에 유지된다. v2는 그 위에 data-gated composition을 선택하고, v2 prompt에는 선택된 composition guide를 직접 주입한다. seed는 호환 후보가 둘 이상일 때만 tie-breaker다.

| variant | 조건 | 구조 의미 |
|---|---|---|
| `insufficient_comparison` | 후보 2 미만 또는 후보 전체의 공통 필드 2 미만 | 부족함을 숨기지 않고 확인 가능한 후보·체크리스트 중심 |
| `distance_expanded_comparison` | final body 후보 중 `supplement` 또는 `far_guarantee` 존재 | 확장 이유·실제 지역·직선거리 의미를 밝힌 뒤 비교 |
| `criteria_first_grouped_comparison` | 모두 region-like이고 academy type이 둘 이상 | 검증된 운영 형태만으로 그룹화 가능 |
| `region_like_comparison` | 위 조건 외 | 동일 확인 가능 필드의 순차 비교와 비교표 |

거리 확장/정보 부족 후보는 seed가 다른 legacy 구조를 선택할 수 없다. 다만 LLM의 최종 문장 품질은 별도 A/B 생성 평가가 필요하다.
