# T01 Phase A 검증 게이트

판정: **passed**

| Gate | 증거 | 상태 |
|---|---|---|
| region-like 후보 재현 | Fixture A/B/C, 실제 `DbService.listAcademies` | passed |
| supplements 조건 재현 | Fixture B: direct 2인데 pool 7 미달로 실행 | passed |
| far 조건 재현 | Fixture D/E: merged<2일 때만 50km | passed |
| 2/7/5/20/50 | fixtures + imported constants | passed |
| direct/supplement/far 순서 | Fixture A/B/D 이름·거리 순 assertion | passed |
| 중복/유형/usability | Fixture C | passed |
| 출처 손실 위치 | Fixture provenance loss: selection trace → `WorkerService.buildFacts()` flat text | passed |
| T01 seed variant | fixture test + existing `structure-variant.test.ts` | passed |
| modifier 문자열 삽입 | `buildPrompt()` snapshot assertion | passed |
| 비T01 영향 확인 | shared worker/archetype map 검토 + legacy tests | passed |
| 실제 코드 호출 | fixture가 `selectAcademiesForRegion`(worker가 호출)·DbService·buildFacts를 호출 | passed |

Phase B 진행 근거: 후보 selection 결과를 바꾸지 않는 typed adapter/structured T01 prompt/quality rule을 T01 opt-in mode에 격리할 수 있다.

제외 사항: 운영 DB trace, LLM 생성 결과, 외부 데이터 수집은 실행하지 않았다. 따라서 Phase B의 A/B는 deterministic prompt·variant·quality dry-run 수준으로 제한한다.
