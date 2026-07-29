# T01 후보 provenance

후보 출처는 기존 `buildFacts()` 평면 문자열에서 사라졌다. v2는 selection trace를 사용해 최종 5곳 표본까지 아래 정보를 보존한다.

| 단계 | legacy | T01 v2 |
|---|---|---|
| `selectAcademiesForRegion()` | direct/supplement/far 로컬 배열 | trace candidate에 source/reason/rank 기록 |
| slot seed 표본 | academy row만 유지 | 같은 row와 trace를 academy ID로 결합 |
| facts/prompt | 거리 일부 문자열만 남음 | stored region, address, source, relation, 직선거리, missing field JSON 유지 |
| quality gate | provenance 검사 없음 | 보충/far 후보의 실제 지역·확장 고지와 직선거리 오표현 검사 |

동일 후보가 여러 query 결과에 있어도 기존 direct 우선 dedupe 결과만 final candidate가 된다. v2는 후보를 새로 선택하지 않는다.
