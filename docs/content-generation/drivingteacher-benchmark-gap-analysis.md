# 운전면허 지역 비교 벤치마크 갭 분석

## 종합 판단

**결론: `existing_pattern_upgrade`.** T01 `local`은 비교표, 후보별 H3, 상황별 결론, 적은 후보의 인근 확장, 사실 부족 시 상담 질문이라는 벤치마크의 뼈대를 이미 지원한다. 하지만 비교 필드의 정규화·구조 선택의 데이터 조건화·접근성 근거·modifier의 컴파일·사실/해석 분리는 부족하다. 따라서 신규 최상위 패턴보다 T01의 데이터 기반 variant와 검수 강화가 비용 대비 낫다.

| 항목 | 상태 | 코드 근거 | 판단 |
|---|---|---|---|
| 검색 의도 반영 | partially_supported | `TEMPLATE_SPECS`의 keyword/persona/intent (`constants.ts:110-125`) | 유형/축으로 반영하지만 query parsing·의도 신뢰도는 없다. |
| 지역 특성 반영 | already_strong | `buildFacts` 지역, `local` region_overlay (`worker.service.ts:242-281`, `archetypes.ts:49-118`) | 주소·생활권·거리 지시가 있다. |
| 지역 내 수에 따른 구조 변화 | partially_supported | T01 2곳 미만 skip, candidate 수 기반 제목; 1곳은 요약표 (`constants.ts:101-105`, prompt) | 0~2 지역을 별도 “확장 이유→인접 비교→상황별 추천”으로 보장하지 않는다. |
| 인접 지역 확장 로직 | partially_supported | 20km/50km picker (`worker.service.ts:312-359`) | 거리 근거는 있으나 실제 이동 경로/셔틀·행정 인접성은 없다. 50km 보장은 이용 가능성을 과대 암시할 위험. |
| 제목 다양성 | implemented_but_ineffective | T01 rule은 두 template뿐, 그 외 H1 위임 | 후보 수 정확성은 강하지만 지역/세부 지역/기준 조합을 체계적으로 다양화하지 않는다. |
| 도입부 다양성 | partially_supported | 6 structure variants + “매번 다른 문장” prompt | variant는 seed 고정, 도입 타입을 명시/검증하지 않아 모델에 의존. |
| 비교 기준 선행 | partially_supported | local variant C에만 명시 | 충분한 비교 data일 때만 criteria-first가 선택돼야 하나 현재는 seed rotation. |
| 학원별 동일 필드 비교 | partially_supported | facts는 address/price/shuttle/hours/pass_rate/phone/type/거리 (`worker.service.ts:260-266`) | 필드가 문자열/결측 혼재, 표의 행/열 계약과 field completeness gate가 없다. |
| 학원별 차별점 | partially_supported | 후보 card와 후기/SEO facts | 동일 field→지역 의미→적합 이용자 순서를 강제하지 않는다. |
| 사실과 해석 구분 | partially_supported | 사실 없는 주장 금지, 상담 질문 지시 | 문장/표에서 fact와 interpretation label을 구분하거나 claim provenance를 저장하지 않는다. |
| 이용자 적합도 | already_strong | local guide가 추천 대상/“이런 사람” 결론 요구 | 근거가 약한 추천을 막는 적합도-evidence gate는 없다. |
| 후기 역할 | partially_supported | `reviewFactsForAcademy`, review facts unused gate | 긍정 후기만 수집/요약하고 source/date/대표성·중립성은 제어하지 않는다. |
| 최종 비교표 | partially_supported | 표는 반드시 1개지만 위치는 모든 variant에서 다름 | T01에는 보통 존재하나 “마지막 결정 지원”으로 강제되지 않는다. |
| 체크리스트 | already_strong | prompt와 quality gate가 리스트/✅ 요구 | 등록 전 확인 질문으로 잘 활용된다. |
| 상황별 추천 | partially_supported | local structure variants/결론 지시 | T01에서 지시되나 data-backed persona matrix가 없다. |
| 문체 제어 | already_strong | 문단/H2/상투구/가독성 gate (`quality-gate.ts`) | 친근 정보형 기본선은 강하다. |
| 과장 표현 방지 | already_strong | 위험 합격/기간, 금액, 후기, 후보 수 gates | “최고/압도적/합격률 우수” 등 평가 형용사와 self-claim pass rate의 범위 검증은 부족. |
| 데이터 부족 처리 | already_strong | facts 범위/상담 질문/후보 부족 지시 | 이 원칙은 프롬프트와 gate 모두에 있다. |
| 가격·셔틀 변동 정보 | partially_supported | fields + specific money gate | 기준일, 수강 과정, 추가비용, 최신성, 공식 source URL이 facts/본문에 정형화되지 않는다. |
| 기존 글 구조 반복 방지 | partially_supported | 6 deterministic variants, boilerplate/repeated sentence gates | variant를 data 조건이 아닌 seed로 고르며 글 간 구조 fingerprint 유사도는 없다. |
| 기존 글 문장 유사도 방지 | partially_supported | internal repeated sentence + post Jaccard 0.75 dedup | 의미 유사도/제목/section sequence는 미검사, dedup는 생성 후 noindex다. |

## 벤치마크 요소의 적정 구현 위치

| 후보 요소 | 권장 위치 | 근거 |
|---|---|---|
| FLAT_SEQUENTIAL_COMPARISON | 기존 `local` variant 보강 | 이미 후보 소개 우선 variant B가 있다. 비교 필드 계약과 선택 조건만 보강하면 된다. |
| CRITERIA_FIRST_GROUPED_COMPARISON | `local`의 data-gated variant | variant C가 토대다. 검증된 boolean field가 2개 이상일 때만 선택해야 한다. |
| SPARSE_REGION_EXPANSION | `local`의 신규 variant | 0~2/직접 후보 부족은 검색 의도와 구성이 달라 기존 seed variant보다 명시적 분기가 필요하다. |
| SELECTION_CRITERIA_INTRO | 기존 `local` structure 보강 | 모든 T01 도입에 “지역 제약+비교 범위+확인 가능한 기준” contract를 추가. |
| FINAL_COMPARISON_TABLE | 기존 `local` structure + gate | 표는 이미 필수. 끝부분의 결정용 표 위치와 필드 completeness를 검사. |
| FINAL_SELECTION_CHECKLIST | 기존 structure 보강 | 이미 체크리스트가 있어 별도 modifier 불필요. |
| PERSONA_RECOMMENDATION | 기존 persona + `local` 결론 보강 | 페르소나는 slot에 존재; facts로 뒷받침되는 조건만 추천하도록 하면 된다. |
| ADJACENT_REGION_EXPANSION | facts composer + sparse variant | picker는 존재하므로 명확한 직접/인접 메타와 접근 근거를 전달해야 한다. |
| GROUP_BY_VERIFIED_DIFFERENTIATOR | composition profile 또는 `local` data-gated variant | `self_test`, shuttle, weekend 같은 검증 boolean이 현재 운영 facts에 부족하다. 일반 modifier로 만들면 빈 주장 위험. |
| ANTICIPATED_OBJECTION | style/profile의 작은 prompt rule | 구조 자체가 아니라 제한적 문체 패턴이며, 사실으로 답할 수 있는 경우만 허용. |
| FRIENDLY_INFORMATIONAL_STYLE | 기존 design/문체 규칙 보강 | 디자인이 이미 tone/CTA owner이므로 새 modifier보다 style profile이 자연스럽다. |

## 핵심 질문에 대한 답

1. **벤치마크 수준인가?** 부분적으로 그렇다. T01의 비교표·카드·인근 후보·체크리스트는 동등한 기반이나, 비교 데이터 contract와 sparse 지역 전용 구성은 미달이다.
2. **정의는 있으나 프롬프트에서 약한 부분?** modifier, criteria-first, intro 다양성, 동일 비교 필드, 마지막 결정 지원이다. 모두 자연어 지시만 있고 선택/검수 계약이 없다.
3. **modifier가 많아도 결과 차가 작은 이유?** `modifier_1/2`는 한 줄 텍스트이고 facts query/structure/gate를 바꾸지 않는다.
4. **가장 큰 개선점?** 모든 후보에 대해 사실 필드를 정규 행렬로 만들고, 그 completeness로 순차/기준 우선/인접 확장 구조를 결정하는 것.
5. **복잡성 대비 낮은 요소?** 검증 가능 differentiator가 아직 없는 상태에서 group/rank를 만드는 것, 독립 최상위 pattern 신설, 외부 후기의 대량 인용이다.
6. **기존 DB만으로 가능한 것?** 주소·거리·유형·가격(있을 때)·셔틀(있을 때)·시간·전화·사진·후기 존재에 근거한 표/카드/결정 체크리스트.
7. **추가 수집 필요?** 취득 면허, 자체시험, 교육 일정, 수강 과정별 가격/추가비용/기준일, 셔틀 route/coverage, 주말·야간, 공식 URL/필드 출처. Research DB에는 일부 스키마가 있으나 생성 DB 합류가 필요하다.
8. **허위/과장 위험이 큰 요소?** BEST/합격률 우수 순위, 실제 접근성/셔틀 편리, 가격 비교, 후기 일반화, persona 추천, 50km 후보를 “인접”이라 부르는 경우.
9. **보강 vs variant?** 비교표/도입/필드/문체는 기존 T01 보강, sparse-region만 data-gated variant가 적합하다.
10. **최소 변경 Top 3:** (a) structured facts/표 field contract, (b) direct/nearby/sparse metadata 기반 structure selection, (c) modifier를 typed instruction으로 컴파일하고 무효 modifier를 숨김.
