# T01 후보 선정 fixture 검증

검증일: 2026-07-20  
게이트 상태: **passed**

## 실행 근거

`apps/api-nest/test/academy-candidate-selection.test.ts`는 임시 SQLite DB와 실제 `DbService.listAcademies()` 및 실제 `selectAcademiesForRegion()`을 사용한다. selection 규칙을 test에서 재구현하지 않는다. 후보 선택 본체는 기존 `WorkerService.pickAcademiesForRegion()`이 호출하는 `academy-candidate-selection.ts`로 동일 동작 추출되었다.

실행 명령:

```text
npm --prefix apps/api-nest test -- --run test/academy-candidate-selection.test.ts test/readonly-candidate-trace.test.ts test/structure-variant.test.ts test/quality-gate.test.ts test/slot-title.test.ts test/article-pattern-filter.test.ts
```

결과: **6 files / 91 tests passed**. 이어서 `npm --prefix apps/api-nest run typecheck`도 통과했다.

## Fixture 결과

| Fixture | 입력 shape | 실제 결과 |
|---|---|---|
| A direct 충분 | `region LIKE` 유효 후보 7 | direct 이름순 7, supplement/far 0, `buildFacts()` 본문 후보 5 |
| B pool 부족 | direct 2, 20km 내 5 | 최소 2를 만족해도 pool 7 미달이라 supplement 5 실행, 최종 7, 본문 5 |
| C filter/dedupe | direct 1, 20km 후보 1, 좌표 없음·다른 type·dummy 포함 | type 필터와 usability filter 유지, direct 중복 제거, 좌표 없음은 미선택 |
| D far | direct/20km 0, 30/44/60km 후보 | 30/44km가 가까운 순으로 far 2, 60km 제외 |
| E 부족 | 50km 밖 후보만 존재 | 최종 0, 가상 후보/중복 없음, facts 후보 수 0 |
| G fields 부족 | 가격/셔틀이 후보별로 불균형 | 현재 facts는 값이 있는 필드만 평면 문자열화, 운영시간을 만들지 않음 |
| provenance loss | 보충 후보에 ID·stored region 부여 | selection trace에는 존재, `buildFacts()` 문자열에는 ID·stored region·source 없음 |

## 재현된 상수와 조건

- 최소 보장: 2 (`ACADEMY_MIN_FOR_BEST`)
- 후보 풀: 7 (`ACADEMY_MAX_CANDIDATES`)
- 본문 표본: 최대 5 (`ACADEMY_USED_PER_POST`)
- 20km: supplement 점수 후보의 거리 기준
- 50km: merged 결과가 2 미만일 때만 far guarantee
- 최초 direct는 `region LIKE`, 보충은 direct가 **7 미만**일 때 실행한다. 2 미만일 때만 실행한다는 조건은 아니다.

## 확인된 제한

`academies` 스키마에 active/enabled 컬럼은 없다. 따라서 fixture의 “상태 필터”는 현재 구현의 더미명 및 최소 usable field 필터를 의미하며, 존재하지 않는 활성 상태 조건을 추가하지 않았다.

초기 분석 문서와 실제 코드 사이에 후보 selection의 의미를 바꾸는 차이는 발견하지 못했다. 다만 이전 문서의 “주소명 direct” 표현은 부정확하며, fixture는 실제 SQL 의미대로 `stored_region_like`로 기록한다.
