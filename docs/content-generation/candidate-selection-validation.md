# 후보 선택 검증: T01 지역 비교

## 검증 결과 요약

“주소명 기준 조회 후, 최소 학원 수에 못 미치면 거리 보충”은 정확한 설명이 아니다. 실제 동작은 **저장된 `region` 컬럼 LIKE 직접 조회 → 목표 풀 크기 7 미달 시 혼합 보충 → 전체 결과가 최소 2 미달일 때만 50km 보장 보충**이다.

## 직접 조회

| 질문 | 코드 근거와 답 |
|---|---|
| 어느 필드? | 생성 시 `academies.region`, SQL `region LIKE ?`다. [db.service.ts:821-824] |
| 주소/행정코드? | `address`나 행정코드로 SQL 조회하지 않는다. `region`은 적재 시 `roadAddress`에서 가장 긴 포함 SEO 지역을 찾거나 주소 앞 1~2 토큰으로 만든 파생값이다. [db.service.ts:797,1204-1219] |
| 매칭 방식? | `%${region}%` LIKE; exact/prefix/정규식이 아니다. |
| 행정 수준/정규화? | 입력 `slot.region`과 저장된 문자열의 부분 포함이다. 시·도/시군구/읍면동 수준을 명시적으로 구분하지 않고, 명칭변경 alias·행정코드 예외·정규화도 없다. |
| 필터? | `domain`, T01의 `academy_type IN ('exam_academy','academy')`, `isUsableAcademy()`. 활성 상태 필터는 없다. [constants.ts:111] [worker.service.ts:318,427-433] |
| 정렬? | DB `ORDER BY name`, 거리순이 아니다. [db.service.ts:841] |
| 중복? | 직접 배열 내부를 별도 dedupe하지 않는다. DB unique는 `(domain, region, name)`이므로 다른 region의 동일 external ID는 이론상 가능하다. [db.service.ts:155] |

## 수치와 조건

| 항목 | 실제 값/출처 | 의미 |
|---|---|---|
| T01 최소 생성 후보 | 2 (`TITLE_RULES.T01.min_generate`) [constants.ts:101-105] | facts의 최종 표본 수가 2 미만이면 slot skip |
| 기본 최소 비교 기준 | 2 (`ACADEMY_MIN_FOR_BEST`, 고정) [constants.ts:87-91] | 후보 selection의 50km 보장 및 archetype 기본값 |
| T01 풀 상한 | 7 (`ACADEMY_MAX_CANDIDATES`, env 가능) [constants.ts:82-86] | T01 `local`은 override 없음 |
| 본문 후보 상한 | 5 (`ACADEMY_USED_PER_POST`, env 가능) | 7개 풀에서 slot 시드 표본 |
| 직접 조회 limit | `max(limit*3, 20)` → T01 21 | 사용성 필터 뒤 재조회 없음 |
| 전체 후보 조회 limit | 5,000 | 같은 타입의 사용 가능 후보 |
| 인근 거리 | 20km (`SEO_ACADEMY_NEARBY_MAX_KM` 가능) | Haversine 직선거리 |
| 최소 보장 거리 | 50km (`SEO_ACADEMY_MIN_GUARANTEE_MAX_KM` 가능) | 최종 수가 2 미만일 때만 |
| 정렬 | 보충은 score(0/1/2/3) → 거리 → 한국어 이름; far는 거리만 | 직접 후보는 이름순 후 선행 |

`direct.length >= 7`이면 즉시 반환한다. 직접 후보가 2~6곳인 경우에도 최소 2를 충족했더라도 보충 단계가 실행된다. 따라서 “최소 수 미달시에만 거리 조회” 가정은 반박된다. [worker.service.ts:318-322]

## 거리/보충 알고리즘

```text
target = seo_regions에서 domain + 요청 region 정확 일치, level 내림차순 1개
academy point = academies.latitude/longitude (= 적재된 roadLatitude/roadLongitude)
distance = Haversine(R=6371), km, 소수 첫째 자리

score 0: row.region === 요청 region
score 1: academy.address.includes(요청 region)
score 2: 좌표 거리 <= 20km
score 3: row.region 또는 address가 sameAdministrativePrefix
```

근거: [worker.service.ts:323-345,522-555] [db.service.ts:807-814]. 이는 도로 이동거리·대중교통·셔틀 가능성을 계산하지 않는다. 좌표가 하나라도 없으면 거리는 `null`이고 거리 기준에는 참여하지 못한다.

`sameAdministrativePrefix()`는 공백 토큰 중 `도/시/군/구` 계열 접미사만 뽑아 첫 토큰과 두 번째 또는 세 번째 토큰의 동등성만 본다. 이 함수는 행정 인접 여부가 아니라 단순 문자열 토큰 동등성이다. [worker.service.ts:547-555]

## 필터와 중복 제거

- direct와 all 모두 동일한 `academy_types` 및 `isUsableAcademy`를 적용한다. **활성 상태 필터는 양쪽 모두 없다**(스키마 미존재).
- direct 외 보충은 `external_id || id || name` 키가 direct에 있으면 제외한다. far도 result 키를 제외한다. [worker.service.ts:326-355]
- 이 중복 제거는 direct 내부 중복, 이름이 같은 서로 다른 실체, external ID가 비어 있고 이름이 다른 중복을 보장하지 않는다.
- `SlotService.matchRegionAcademies()`는 관리자 coverage 화면용 유사 구현이며, 실제 worker와 완전히 동일하지 않다. 예를 들어 coverage의 direct는 메모리 `region.includes`, nearby는 거리만 사용하고 worker의 주소 포함/행정 prefix 보충은 반영하지 않는다. [slot.service.ts:218-245] 운영 판단 화면을 생성 결과의 정확한 trace로 간주하면 안 된다.

## 후보 출처와 지역 관계가 사라지는 위치

| 시점 | 직접/보충 구분 | 실제 주소/요청지역 관계 | 비고 |
|---|---|---|---|
| direct 조회 직후 | `direct` 로컬 배열 | `row.region`, `address` 원본 유지 | source 필드는 아직 없음 |
| scored/supplements/far | 코드 블록으로만 암묵적 구분 | score·`distanceKm` 로컬값 | `withDist`는 `distance_km`만 행에 붙임 |
| `result` 병합 후 | 없음 | 원본 `address`,`region`은 Row에 남음 | `direct`와 result의 출처 tag 없음 |
| `seededSample` 후 | 없음 | 동일 | slot seed가 후보 조합을 바꿈 |
| `buildFacts` | 없음 | `주소`, 선택적 `지역 중심 기준 거리`만 문자열화 | 원본 `region`은 누락 |
| prompt | 없음 | facts의 주소 문장만 LLM이 해석 | typed payload 없음 |
| 카드/비교표 | 없음 | LLM 출력에 의존 | renderer는 H3만 카드화 [post-rendering.ts:5-21] |
| quality gate | 없음 | 주소/거리 관계 검증 없음 | 표 존재·이름 일부 정도만 검사 |

따라서 “주소 후보와 거리 후보의 구분은 최종 prompt까지 유지된다”는 가정은 반박된다. 현 상태에서 보존되는 가장 가까운 신호는 보충/far에만 생길 수 있는 `지역 중심 기준 거리` 텍스트이며, 주소 포함/행정 prefix 보충 후보에도 거리 태그가 붙을 수 있고, 직접 후보에는 붙지 않는다.

## Region relation과 accessibility 판정

현 구현으로는 다음을 typed하게 구분할 수 없다.

| 관계 | 현재 판정 가능성 |
|---|---|
| 요청 주소 완전 일치 | 없음. `row.region === region`만 있고 주소 전체 비교 없음 |
| 같은 시군구, 동만 다름 | `region` 문자열/주소 포함 또는 token heuristic에 간접 의존 |
| 같은 시도 다른 시군구 | token heuristic 또는 거리; explicit relation 없음 |
| 다른 시도 | score가 무한대일 수 있으나 50km 보장에는 거리만으로 들어올 수 있음 |
| 판정 불가 | 좌표/주소가 없으면 가능하며 상태를 facts에 표시하지 않음 |

셔틀·대중교통·도로 이동시간은 접근성 evidence로 합성되지 않는다. 셔틀 문자열이 있으면 단지 facts에 보존될 뿐이며, 없는 경우 “접근 가능”을 뒷받침할 근거가 없다.

## 실제 사례/fixture

`golden-slots.json`에는 T01 슬롯(예: 서울·수원·안산)과 modifier만 있지만 academy rows가 없다. 후보 후보군을 만들 수 있는 fixture, candidate snapshot, dry-run input은 발견하지 못했다. 그러므로 A~D 유형의 실제 지역 trace(직접/보충 개수, 주소, 거리, 최종 variant, gate 결과)는 **not_verifiable**이며 이번 문서에 가상의 사례를 쓰지 않았다.
