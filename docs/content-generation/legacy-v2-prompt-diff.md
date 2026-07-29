# Legacy와 T01 v2 Prompt 차이

비교 기준은 익산 pair의 [legacy prompt](../../data/content-generation-evaluation/codex-cli-single-pair-20260720/prompts/legacy/pair-01.md)와 [v2 prompt](../../data/content-generation-evaluation/codex-cli-single-pair-20260720/prompts/v2/pair-01.md), 고성 pair의 v2 contract다. 공통 기반 prompt는 `buildPrompt()`([worker.service.ts](../../apps/api-nest/src/worker.service.ts:734))이며 v2는 그 뒤에 contract를 붙인다([worker.service.ts](../../apps/api-nest/src/worker.service.ts:156)).

| directive 계층 | legacy | historical v2 | 자연스러움 영향 | 사실 안전성 영향 | hybrid 처리 |
| --- | --- | --- | --- | --- | --- |
| 역할/SEO/문체 | 공통 | 공통 | legacy의 자연스러운 지역 도입 지시가 유용 | 중립 | 유지 |
| 후보 facts | 평면 문자열, SEO 키워드·좌표·후기 테마 포함 | 동일 평면 facts + structured JSON | 과도한 입력이 나열형 문장을 유도 | v2 JSON은 ID/결측/provenance 보존 | typed payload로 대체하고 독자 문장에는 내부 key 미노출 |
| 지역 관계 | 생활권으로 풀어 씀 | `stored_region_like`, supplement/far, storedRegion 규칙 | v2가 방어적으로 반복될 수 있음 | 지역 오표현 방지에 필요 | 도입 한 번 + 해당 후보 카드/표에 실제 지역만 |
| 거리 | historical legacy/v2 모두 km를 facts로 제공 | 직선거리 정의와 금지 설명까지 상세 | 고성·동해에서 반복 | 도로거리/시간 오표현 방지 | 현재 코드처럼 본문 payload에서 제거; gate에서 검사 |
| variant | seed 회전 구조 | data-gated compatible variant와 directive | 구조가 목적에 맞음 | 후보 부족/확장 후보 안전 | 유지 |
| modifier | 문자열 라벨 | typed 활성/비활성 directive | modifier 설명이 늘 수 있음 | 부적합 modifier 제거 | 구조성 modifier만 짧게 적용 |
| 리뷰 | “후기 흐름”, 리뷰 수, 블로그 theme | 같은 legacy facts + reviewEvidencePresent | theme 반복·홍보성 | 원문 대조 불가 | 기사 전체 대표 review 1건만 payload |
| FAQ | legacy FAQ 구조 회전 | v2 `includeFaq` seed 회전 | FAQ와 checklist가 중복될 수 있음 | 중립 | semantic dedupe 뒤 선택적으로 생성 |
| 체크리스트 | 항상 포함 | 사실 비어 있는 항목을 묻도록 강화 | “확인” 문구 반복 | 안전 | 행동만 남기고 짧게 |
| gate 예방 문구 | 일반 금지 | candidate-only, relation, km, verification 규칙 상세 | 내부 검수 언어를 모델이 본문에 번역할 위험 | 높은 안전성 | 짧은 원칙만 prompt; 세부 검사는 gate |

현재 코드와 historical v2의 차이: 현재 `t01StructuredPromptPayload()`는 거리/좌표/radius를 제거하고([t01-data-gated.ts](../../apps/api-nest/src/t01-data-gated.ts:122)), `variantDirective()`도 km를 쓰지 말도록 바뀌었다([t01-data-gated.ts](../../apps/api-nest/src/t01-data-gated.ts:410)). 그러므로 hybrid는 historical v2 prompt를 복제하면 안 된다.
