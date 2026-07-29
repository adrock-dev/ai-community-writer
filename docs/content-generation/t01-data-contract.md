# T01 v2 데이터 계약

## 입력과 불변성

T01 v2는 `WorkerService.pickAcademiesForRegion()`과 같은 `selectAcademiesForRegion()` 결과를 다시 사용한다. 후보 SQL, type/usability filter, 2/7/5/20km/50km 기준, dedupe, 정렬, slot seed 표본은 바꾸지 않는다. `academy-candidate-selection.test.ts`의 parity test가 legacy와 v2의 후보 ID와 순서를 비교한다.

## typed candidate

`T01AcademyCandidate`는 저장 모델이 아닌 생성 중간 모델이다.

| 필드 | 근거/의미 |
|---|---|
| `academyId`, `academyName`, `academyType` | 기존 academy row의 `external_id/id/name`, `academy_type` |
| `storedRegion`, `address`, 좌표 | 기존 DB row의 값만 복사 |
| `retrievalSource`, `inclusionReason`, `retrievalRank` | 기존 선택 단계와 selection trace |
| `straightLineDistanceKm` | 기존 Haversine 직선거리. 이동시간·도로거리·접근성 평가는 아님 |
| `regionRelation` | `target_region`, `same_parent_region`, `other_region`, `unknown`; region 문자열의 보수적 토큰 비교 |
| `tuition`, `shuttle`, `operatingSchedule`, `passRate`, `phone` | 해당 row에 있는 값만 보존 |
| `missingFields` | 주소/수강료/셔틀/운영시간/합격률/전화의 빈 값 |

`retrievalSource`는 `stored_region_like`, `supplement`, `far_guarantee`다. `supplement`는 기존 코드의 점수 보충 단계이며 address 포함·행정구역 접두·20km 이내 중 어떤 이유인지는 `inclusionReason`으로 별도 기록한다. 따라서 source와 실제 지역 관계를 혼동하지 않는다.

## prompt payload

v2 prompt에는 legacy facts를 계속 넣되, 별도 JSON 계약으로 target region, 임계값, 후보 provenance, actual region/address, 직선거리, 결측 필드, variant와 typed modifier를 넣는다. 이 계약은 legacy 구조/수식어보다 우선하며, 거리 후보를 요청 지역 소재 또는 실제 이동 편의로 표현하지 못하게 지시한다.
