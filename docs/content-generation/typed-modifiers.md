# T01 v2 typed modifier adapter

기존 slot의 `modifier_1/2` 문자열과 비T01 동작은 유지한다. T01 v2에서만 문자열을 `T01TypedModifier`로 해석한다.

| legacy label | 활성 조건 | v2 처리 |
|---|---|---|
| `비용절약` | 후보 중 tuition 존재 | 가격이 있는 후보만 언급, 최저/가성비 순위 금지 |
| `셔틀편리` | 후보 중 shuttle 존재 | 기록된 셔틀만 언급 |
| `가까운`/`근처` | insufficient가 아님 | 실제 지역·직선거리와 편의성 평가 분리 |
| `상담전확인` | 항상 | 결측 fact 확인 체크리스트 |
| `야간반`/`주말반` | 현재 structured schedule fact 없음 | 비활성, `no_structured_schedule_fact` 기록 |
| 기타 | 조건 없음 | 새 학원 사실을 만들지 않는 일반 지침 |

비활성 modifier는 v2 legacy prompt의 `수식어:` 줄에서도 제거되며, reason은 structured payload에 남는다. 호환성/priority/conflict의 일반 메타모델은 아직 도입하지 않았다. 현재 labels 간 실제 conflict 규칙이 없으므로 추측 규칙을 추가하지 않았다.
