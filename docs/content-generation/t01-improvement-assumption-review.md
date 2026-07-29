# T01 개선안 가정 재검토

## 판정 기준

`confirmed`는 코드가 그대로 보장하는 경우, `partially_confirmed`는 일부만 맞거나 구현 간 불일치가 있는 경우, `refuted`는 실제 동작이 다른 경우, `not_verifiable`는 저장소 fixture/실행 근거로 판정할 수 없는 경우다.

| 가정 | 상태 | 코드 근거 | 현재 실제 동작 | 구현안 영향/수정 필요 |
|---|---|---|---|---|
| 자체 수집 학원정보가 핵심 facts다 | confirmed | `buildFacts()`가 `academies`를 읽어 prompt facts를 만든다. [worker.service.ts:242-281] | 생성 시 API 호출 없음 | DB adapter를 전제로 해도 됨 |
| 주소명 조회 후 거리 보충 | partially_confirmed | `region LIKE` 직접 조회 후 보충 [db.service.ts:821-842] | 저장 시 주소에서 파생한 region을 조회; 생성 시 address query 아님 | 요구사항을 “stored-region 직접 조회”로 고쳐야 함 |
| 최소 학원 수 기준이 하나로 관리 | refuted | 7(pool), 5(used), 2(min), title 2가 별개 [constants.ts:75-105] | 환경 변수와 고정값·archetype 값이 혼재 | 조건 이름을 각각 분리해야 함 |
| 거리 후보 출처가 prompt까지 보존 | refuted | `withDist`는 거리만 추가 [worker.service.ts:326-358] | `direct/nearby/guaranteed` tag 없음 | typed candidate에 retrieval source 필요 |
| 거리 후보 실제 지역이 prompt에 전달 | partially_confirmed | `address`는 문자열 facts에 있음 [worker.service.ts:260-267] | DB `region`은 prompt에 없음; LLM이 주소를 해석해야 함 | `actual_region`/relation 필요 |
| 거리 정보만으로 접근성이 해석 | refuted | Haversine을 선택 점수로만 사용 [worker.service.ts:522-540] | 접근 가능/좋음 판정 함수 없음 | 거리=직선거리임을 명시, 셔틀/교통은 별 evidence로 분리 |
| facts가 문자열 중심 | confirmed | `GenerationFacts.text: string`, 후보 `parts.join(' / ')` | 객체는 images/count/name만 | structured payload 병행 필요 |
| variant가 seed 중심으로 선택 | confirmed | FNV seed modulo 6 [archetypes.ts:341-358] | 데이터 조건 입력 없음 | data-gated T01 variant가 필요하면 별 selector 필요 |
| modifier가 단순 문자열 | confirmed | `resolveAxisPool()`은 `{value}`, `modifierPairs()`는 string pair, prompt가 join [axis-tags.ts:78-83] [slot.service.ts:372-379] [worker.service.ts:828] | 타입은 축의 `modifier`일 뿐 modifier specification은 없음 | 새 타입보다 기존 slot string과 호환하는 metadata registry/adapter가 안전 |
| quality gate severity 구분이 없다 | confirmed | `articleQualityIssues(): string[]`, nonempty면 failure [quality-gate.ts:87-129] [worker.service.ts:159-173] | internal link만 별도 warning | typed severity를 넣으면 opt-in으로 해야 함 |
| typed normalization을 DB 변경 없이 도입 가능 | confirmed | Row에 id/address/region/coords/type/source/sync fields 존재 [db.service.ts:126-153] | 내부 adapter만 추가 가능 | raw Row를 보존한 뒤 prompt DTO를 추가 |
| 기존 후보 결과를 유지하며 개선 가능 | partially_confirmed | worker 내부에 후보 선택과 facts 변환이 분리 | `buildFacts`가 모든 archetype과 공유 | T01 분기 뒤 adapter로 해야 출력 회귀를 피함 |
| 신규 T01 최상위 패턴은 필요 없다 | confirmed | T01 `local`에 6 structure variants와 비교 목적이 이미 있음 [archetypes.ts:49-114] | 문제는 intent가 아니라 data/provenance 계약 | 최상위 template 추가는 불필요 |
| 거리 확장은 T01 내부 variant가 적합 | partially_confirmed | 거리 보충은 T01과 shared worker의 후보 선택에 존재 | 구조 차이는 현 variant에 없음 | 거리 source가 실제 final 후보에 있을 때만 variant 조건으로 사용 |

## T01 구조와 variant

T01은 `local` archetype의 다음 6개 구조를 가진다: 비교표 우선, 후보 소개 우선, 기준 우선, 추천 결론 우선, 생활권·동선 우선, FAQ 포함. 모두 비교표와 후보 H3/상담 확인을 지시한다. [archetypes.ts:61-114]

판정: **“현재 구조 선택은 후보 데이터 조건보다 seed 회전에 더 크게 의존한다” = confirmed.** `structureSeed(slot)`은 slot ID 또는 지역/키워드이며, `structureGuideForArchetype()`은 후보 객체·거리·누락 필드를 받지 않는다. [worker.service.ts:800-803,805-828] [archetypes.ts:341-358] 후보 수는 제목 skip/제목 tier와 facts 개수에는 영향을 주지만 variant에는 영향을 주지 않는다.

### 제안 variant의 적합성

| 개념 | 판정 | 조건을 둔다면 | 권장 위치 |
|---|---|---|---|
| ADDRESS_ONLY_COMPARISON | 적합 | 최종 후보 모두 retrieval source=`direct`이며 후보>=2 | T01 data-gated variant |
| DISTANCE_EXPANDED_COMPARISON | 적합하나 전제 필요 | 최종 표본에 `nearby` 또는 `guaranteed`가 실제 포함 | T01 data-gated variant |
| CRITERIA_FIRST_GROUPED_COMPARISON | 현재는 부적합 | 동일한 검증 필드가 최소 기준 이상 존재할 때 | 이후 composition rule; 지금은 data completeness/field semantics 없음 |
| INSUFFICIENT_COMPARISON | 적합 | 최종 후보<2 또는 비교 공통 필드 임계 미달 | 새 최상위 pattern이 아니라 T01의 failure/limited-information composition |

조건은 **주소 후보 수가 아니라 최종 facts 표본의 typed 후보 수와 provenance**여야 한다. pool이 7이어도 `seededSample`이 본문에 쓰는 후보는 최대 5이고, title/min gate는 facts 표본 수를 사용한다. [worker.service.ts:245-252,117-127]

## modifier 검증

현재 modifier 값은 T01 preset의 `가까운`, `근처`, `비용절약`, `상담전확인`, `셔틀편리`, `야간반`, `주말반` 등 문자열이다. template의 `axis_tags`는 값의 호환성을 선택할 뿐, 값별 prompt fragment·필수 facts·구조 영향·충돌 규칙은 정의하지 않는다. [constants.ts:111] [axis-tags.ts:78-143] 선택 결과는 slot columns 두 개와 prompt 한 줄뿐이다. 따라서 “modifier가 단순 문자열이므로 typed 조건과 데이터 요구사항이 필요하다”는 **confirmed**지만, DB schema가 아닌 하위호환 metadata adapter가 우선이다.

예: `셔틀편리`를 선택해도 실제 shuttle facts 부재를 감지하거나 해당 modifier를 대체/비활성화하는 코드가 없다. 이 상태에서 modifier 자체를 강화하면 허위 의미 신호 위험이 있다.

## quality gate 검증

| 대상 | 현재 검사 | 미검사/한계 |
|---|---|---|
| 없는 가격/숫자 | price facts가 전혀 없는데 특정 금액이면 fail | facts의 가격과 출력 가격의 일치·다른 숫자 일반 검증 없음 [quality-gate.ts:110-112,240-254] |
| 주소/거리/지역 | 없음 | 잘못된 주소, 거리 후보를 요청 지역 소재로 표시, 거리 수치 일치 모두 미검사 |
| 셔틀/합격률 | 없음 | facts 유무/값 일치 미검사 |
| 후기 | review facts가 전혀 없는데 후기 표현이면 fail | 후보별 후기 근거·허위 후기·과장 요약의 검증 없음 [quality-gate.ts:111-125] |
| 표/후보 | 표 존재, 후보 이름 일부가 표에 있는지, H3 일부, 후보 수 과장 | 모든 후보/필드의 표 일치, 동일 학원 중복 소개 미검사 |
| 문체/반복 | 길이·H2·표·체크리스트·긴 문장·상투구·동일 문장 | 질문형 과다의 정량 검사 없음 |

severity는 없다. `articleQualityIssues`와 `postSurfaceQualityIssues`는 문자열 배열이고, 전자는 issue가 하나라도 남으면 hard fail이다. 내부 링크만 `internalLinkIssues()`로 별도 warning이다. repair 기본은 2회, payload로 0~3회이며 같은 실패 반복을 기억하거나 중단하는 장치는 없다. [worker.service.ts:158-187]

## 구현 전 요구사항 수정

1. “주소명 후보”를 **`stored_region_like` 후보**로 명명한다. 원본 주소가 아닌 파생 `region` 조회임을 계약에 명시한다.
2. `nearby`라는 이름을 거리 20km만 뜻하게 쓰지 않는다. 현 보충에는 `address_contains`, `administrative_prefix`, `geo_nearby`가 섞여 있다. typed source는 retrieval stage와 inclusion reason을 분리해야 한다.
3. `region_relation`과 `accessibility_evidence`를 retrieval source와 분리한다. 거리=직선거리이며 접근성 추천 근거가 아님을 prompt/quality 계약에 명시한다.
4. 주소·셔틀·가격·후기 등의 “검증”은 flat facts 문자열 정규식이 아니라 candidate ID를 유지한 structured payload가 있어야 후보별로 할 수 있다.
5. criteria-first/grouping은 공통 필드의 존재·동일 의미·확인일 요건을 먼저 정의하지 않으면 도입하지 않는다.
6. T01 신규 최상위 글유형은 요구하지 않는다. 최종 후보 condition을 기반으로 한 T01 내부 composition/strategy가 더 작은 변경 경계다.
