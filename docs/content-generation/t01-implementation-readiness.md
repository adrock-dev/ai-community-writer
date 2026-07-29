# T01 개선 구현 준비도 및 영향 범위

## 최종 판정

**additional_validation_required**

코드 구조상 DB migration 없이 T01 전용 typed candidate adapter와 data-gated composition을 추가할 수 있다. 그러나 기존 후보 조회의 의미가 “주소명 직접”과 다르고, 실제 학원 fixture가 없어 candidate provenance/region relation/부족 지역의 결과를 재현 검증하지 못했다. 아래 요구사항을 확정하고 fixture 또는 읽기 전용 dry-run trace를 마련한 뒤 구현해야 한다.

## 가장 안전한 경계

권장 결론은 **`t01_internal_pipeline_branch`**다.

```text
공통: slot 검증 → template/archetype 결정 → 기존 후보 조회(Row[])
                             ├─ T01: normalizeCandidate → T01 variant/composition → structured payload → T01 gate
                             └─ 기존 경로: buildFacts(string) → 기존 prompt → 기존 gate
```

- **T01 전용:** `AcademyCandidate` normalization, retrieval source/inclusion reason, `region_relation`, 직선거리 설명, 데이터 조건 variant, 후보별 비교표/지역 표기 검수.
- **공통으로 opt-in 가능:** gate issue severity metadata, typed modifier metadata, feature/generation mode, repair failure history. 기존 `string[]` issue와 string modifier의 입력/출력은 유지해야 한다.
- **공통에 두면 안 됨:** T01의 거리 확장 구조, 학원 카드의 region label, 후보별 표 field 강제. T11/T14와 T07/T15는 같은 facts 흐름이라도 검색 의도와 최소 후보 수가 다르다.
- **새 최상위 글유형:** 불필요. 기존 T01의 비교 검색 의도·제목·관리자 노출을 유지한 채 내부 strategy로 격리할 수 있다.

## 공통 파일별 실제 영향

| 파일 | T01 전용 코드 | 공유 대상/영향 | 하위 호환 위험 | T01 확장점 |
|---|---|---|---|---|
| `worker.service.ts` | 없음. `pickAcademiesForRegion`, `buildFacts`, prompt/repair는 generic | 모든 생성; 학원 selection은 T01/T11/T14/T07/T15에서 관련 | 높음: facts/prompt를 바꾸면 다른 archetype 출력 변경 | `template_id === 'T01'` 뒤 strategy 호출 가능 |
| `archetypes.ts` | `local`이 T01의 kind | `local`은 custom/local template도 재사용 가능; `local_single`, `local_hub`도 variant logic 공유 | 중간: local 전체 structure가 변함 | T01 spec-level selector를 worker에서 별도 적용 |
| `quality-gate.ts` | 없음 | 모든 generated post와 test | 높음: issue 추가는 모든 글 실패 가능 | T01 rule set을 별 함수/옵션으로 opt-in |
| `constants.ts` | `T01` spec/title rule | T03~T15 모두 `TEMPLATE_SPECS`, 후보 상수도 공유 | 중간 | T01 전용 constants는 spec에 추가 가능하나 기존 의미 변경 금지 |
| `axis-tags.ts` | 없음 | 모든 template의 persona/intent/modifier 풀·override | 중간 | typed metadata lookup을 legacy string과 병행 |
| `slot.service.ts` | 없음 | 모든 slot 생성; academy coverage는 UI 판단 | 높음: slot ID/recipe 변화가 모든 golden 변경 | T01 mode를 slot payload에 넣지 말고 generation time 선택 우선 |

## 제안 변경별 영향도

| 변경 | 분류 | 영향 파일/글 유형 | 인터페이스·출력 영향 | 격리/테스트 |
|---|---|---|---|---|
| typed academy candidate | t01_only_safe | worker + T01 adapter | 내부 DTO 추가; legacy facts 유지 가능 | T01 fixture: direct/nearby/guaranteed |
| retrieval source 보존 | t01_only_safe | worker + T01 prompt | T01 새 facts/payload에만 노출 | source가 표/카드/gate에 일관되는지 |
| region relation 계산 | t01_only_safe | worker + T01 adapter | T01만 relation label | 주소/상위구역/타시도/unknown cases |
| data-gated T01 variant | t01_only_safe | T01 strategy, possibly archetypes labels | feature on일 때 T01 구조 변화 | seed legacy mode off/on snapshot |
| typed modifier specification | shared_but_backward_compatible | axis-tags/slot/worker | string modifier 허용을 유지하면 opt-in | T01+비T01 modifier selection snapshots |
| structured prompt payload | shared_with_regression_risk | worker/buildPrompt | 문자열 prompt contract 변경 위험 | T01 only prompt builder 우선 |
| gate severity | shared_but_backward_compatible | quality-gate/worker | `string[]`를 유지하고 metadata 추가 | legacy result exact match + opt-in severity |
| repair 횟수/원인 추적 | shared_but_backward_compatible | worker | 기본 max=2·실패 의미 유지 필요 | retry routing and no-repeat tests |
| feature flag/generation mode | shared_but_backward_compatible | worker/config resolver | flag off=byte-equivalent legacy | all archetype routing |
| A/B 실행 지원 | unnecessary (현재 단계) | orchestration/worker | 운영 경로를 넓힘 | 먼저 deterministic fixture harness로 충분 |

## 글 유형별 회귀 위험

| 글 유형 | 공유 함수 | T01 개선 영향 | 위험 | 격리 필요 | 최소 테스트 |
|---|---|---|---|---|---|
| T01 `local` | worker facts/prompt/gate/slot seed | 직접 대상 | high | 아니오(대상) | legacy/new prompt payload, variant, rules |
| T11/T14 `local_single` | worker facts/prompt/gate, seed | candidate adapter를 공통에 넣으면 단독 소개 facts 변동 | medium | 예 | 1개 후보 제목/표/gate snapshot |
| T07/T15 `local_hub` | worker facts/prompt/gate, modifiers/slot | region facts와 prompt 변화 가능 | medium | 예 | region hub prompt/slot snapshot |
| T03/T12/T13 `guide` | worker prompt/gate/modifier/slot | common modifier/gate/prompt 변경 시 영향 | medium | 예 | modifier/gate snapshot |
| T04/T05/T10 `compare` | worker prompt/gate/modifier/slot | structure/gate 공통 변경 시 영향 | medium | 예 | compare prompt/gate snapshot |
| T06/T08/T09 `exam` | worker prompt/gate/modifier/slot | 공통 modifier/gate 영향 | low~medium | 예 | exam prompt/gate snapshot |

모든 빌트인은 하나의 `processGenerate()`를 사용한다. `academy_centric`은 T01/T11/T14에서 true지만, `buildFacts()` 자체는 모든 archetype에서 호출된다. 따라서 `buildFacts()` 반환 계약을 곧바로 바꾸는 방식은 피해야 한다. [worker.service.ts:109-116,242-281] [archetypes.ts:30-37]

## 전략 비교

| 전략 | 판정 | 근거 |
|---|---|---|
| A. T01 내부 adapter/strategy | 우선 권장 | typed candidate와 region/source/gate가 T01 특화이며 legacy facts를 보존 가능 |
| B. archetype별 pipeline branch | 조건부 | T01 전용 분기가 worker에 과도해질 때 A의 내부 구현으로 사용. `local` 전체가 아니라 `template_id` 또는 opt-in mode로 제한 필요 |
| C. 하위호환 공통 확장 | 제한적으로 권장 | severity, typed modifier metadata, feature flag, repair reason은 legacy 호출을 유지하고 opt-in일 때만 |
| D. 별도 최상위 글유형 | 기각 | T01과 검색 의도/입력/관리자 목적이 근본적으로 다르지 않다. 격리 목적만으로 template을 추가하면 운영 복잡성만 증가 |

## 구현 전 확정해야 할 계약

1. direct의 뜻을 `stored_region_like`로, 보충의 이유를 `address_contains | administrative_prefix | geo_nearby | min_guarantee`로 명명한다.
2. `region_relation`은 **요청지역 내부/같은 상위행정구역/기타/unknown**처럼 계산 가능 범위만 정의한다. 현 주소 파싱만으로 ‘인접 행정구역’을 확정하지 않는다.
3. `accessibility_evidence`는 `straight_line_distance`, `shuttle_text`, `none`을 별도 보존한다. 직선거리를 접근성 우수나 이동시간으로 번역하지 않는다.
4. 새 variant 조건은 pool 수가 아니라 최종 본문 candidate 표본과 typed completeness를 사용한다.
5. T01 feature flag off일 때 현재 `facts text → prompt → seed variant → gate`가 유지된다는 회귀 계약을 둔다.

## 필요한 fixture 및 테스트

- direct 후보만 2+인 T01
- direct 부족, `geo_nearby`가 실제 final sample에 포함된 T01
- 20km 밖 50km 보장도 2 미만인 T01
- 후보는 2+이나 공통 비교 필드가 부족한 T01
- 주소는 있으나 좌표 없음, 좌표는 있으나 주소/region 판정 불가, 셔틀 문자열 있음/없음
- T11 또는 T14, T07 또는 T15, guide/compare/exam 대표 각 1개 prompt/선택 modifier/gate snapshot
- legacy string modifier, legacy facts, flag off routing

현재 저장소에는 위 academy fixture가 없다. DB migration은 필요하지 않지만, 이 fixture 및 deterministic T01 adapter 테스트는 구현 단계에서 새로 마련해야 한다.

## 예상 수정 단위와 롤백

예상 수정은 `worker.service.ts`(T01 strategy 호출), 새 T01 adapter/strategy 모듈, `archetypes.ts` 또는 T01 전용 composition 정의, T01 전용 gate 모듈, 관련 tests가 중심이다. shared severity/modifier/flag를 채택할 경우에만 `quality-gate.ts`, `axis-tags.ts`, `slot.service.ts`, `constants.ts`가 추가된다.

롤백 단위는 feature/generation mode 하나여야 한다. flag off는 현재 T01 및 비T01의 prompt와 selection을 보존하고, T01 strategy·candidate DTO·T01-specific gate를 한 단위로 제거/비활성화할 수 있어야 한다.
