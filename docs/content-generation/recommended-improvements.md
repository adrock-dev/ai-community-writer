# 권장 개선안

이 문서는 변경 계획이며, 이번 분석에서는 코드를 변경하지 않았다.

## A. 최소 변경안

| 우선순위 | 대상 파일·함수 | 변경 | 기대 효과 | 위험 | 테스트 |
|---|---|---|---|---|---|
| 1 | `apps/api-nest/src/worker.service.ts` `buildFacts`, `buildPrompt`, `buildRepairPrompt`; `quality-gate.ts` | candidate facts를 자유 문자열만이 아니라 내부 typed object로 조립한 뒤 동일 필드(위치, direct/nearby, 유형, price+기준일, shuttle, hours, license, self-test, review evidence)를 표 contract와 prompt에 제공. 결측은 `확인 필요`로만 렌더. | 비교 가능성·사실/해석 구분·데이터 활용률이 가장 크게 개선. | prompt 길이/모델 순응도, 기존 문자열 기반 helpers 회귀. | unit: facts fixture→표 행/결측; quality gate: 후보 2+에서 동일 필드 row; golden runner. |
| 2 | `worker.service.ts` `pickAcademiesForRegion` 결과 metadata, `archetypes.ts` `local.structure_variants` | 후보의 direct/nearby/guaranteed·거리와 direct count를 facts에 명시. T01 structure를 seed가 아니라 data condition으로 선택: 3+ 충분→순차/criteria; 0~2 또는 guaranteed 포함→sparse expansion(확장 이유→직접/가까운→인접→표→상황별 선택). | 벤치마크의 지역 수 적응과 인접 지역 설명을 달성. | 50km 후보를 “인접”으로 오해할 수 있음. max 거리/실제 접근 근거 없으면 “가장 가까운 후보”로 한정. | boundary fixture: 0,1,2,3 direct; 20/50km; title count, prompt snapshots. |
| 3 | `axis-tags.ts`, `slot.service.ts`, `worker.service.ts`; `constants.ts` modifier metadata | modifier를 현재 문자열 나열에서 small typed map으로 바꿔 allowed template, fact requirement, prompt phrase, optional section impact를 정의. 자료 없는 `셔틀편리/야간반/주말반`은 slot 후보에서 제외 또는 “확인 질문” variant로 강등. `가까운`/`근처` 통합. | 선택한 modifier가 결과를 실질적으로 바꾸고 무근거 강조를 줄임. | 슬롯 수/기존 slot 재현성 변화. | modifier별 prompt snapshot과 no-data behavior; `article-pattern-filter` 회귀. |
| 4 | `quality-gate.ts`, `worker.service.ts` repair issues | T01 전용 gate 추가: direct/nearby label, 후보별 최소 facts→지역 의미→적합 이용자 순서, 직접 후보 부족 시 expansion reason, 후기에는 evidence qualifier. | 정의돼 있으나 약한 벤치마크 규칙을 executable contract로 전환. | 과도한 gate로 repair 실패 증가. | positive/negative markdown fixture; repair 최대 횟수/실패율 관찰. |
| 5 | `admin.controller.ts`, `DomainClient.tsx` | UI의 “웹 자료 수집 후 작성”은 생성 worker가 구현하기 전 숨기거나 “별도 Academy Research 후 동기화”로 명확히 표시. | 운영자가 실제 외부 조사된다고 오인하지 않음. | UI 문구 변경이 운영 절차에 영향. | API payload contract/UI smoke. |

## B. 확장 변경안 (A의 결과가 부족할 때만)

필요한 구조는 새 최상위 pattern system이 아니라 `local`의 **composition profile**이다. `T01`의 검색 의도/데이터 source/저장 구조를 보존한다.

```text
T01 local
├─ flat_sequential: 3+ 후보와 공통 필드 충분
├─ criteria_grouped: 검증된 boolean differentiator가 2개 이상
└─ sparse_region_expansion: direct ≤2 또는 nearby/guaranteed 필요

style profile: friendly_informational (기존 designWritingGuide를 확장)
modifier: typed emphasis only (사실 선택·구조를 임의 변경하지 않음)
```

### 구조 조건

- `flat_sequential`: 최소 3 후보와 address/type 등 공통 field 충족 시. 각 후보를 동일 field→지역 의미→적합 사용자→검증 후기 순으로 소개하고 끝에서 비교표.
- `criteria_grouped`: `self_test`, `shuttle_available`, `weekend`, `night_class`, `licenses`처럼 field-level source가 있는 값만 group key로 사용. 순위/BEST/합격률은 group key 금지.
- `sparse_region_expansion`: 지역 내 0~2 후보 또는 direct 후보 부족 시. 지역 제약/확장 근거→직접 후보→거리 명시 인근 후보→비교표→상황별 선택. 50km 이상은 “인접”으로 자동 명명하지 않는다.

### 추가 데이터 경계

`academy_research.db`에는 courses, shuttle routes, self test, weekend/night, source URL/meta가 이미 있으나 `WorkerService.buildFacts`는 `admin.db.academies`만 사용한다. 확장 시에는 (1) 검증 상태가 `confirmed`인 research field만 읽기, (2) field별 source URL/checked_at을 facts에 포함, (3) source 없는 AI draft는 본문 주장/그룹 기준에서 제외가 안전하다. 이 단계는 DB migration 또는 read model 구축을 수반하므로 A와 분리한다.

## 검증·배포 순서

1. 읽기 전용 fixture audit으로 현재 T01의 direct/nearby/field completeness 분포를 확인한다.
2. A 변경을 feature flag 또는 template override가 아닌 test-only prompt profile로 먼저 A/B 평가한다.
3. 사실 오류/repair 실패/생성 비용이 baseline보다 악화하지 않고 human score가 개선된 경우에만 T01 기본으로 승격한다.
4. Research DB 연결은 provenance와 freshness 정책이 합의된 뒤 별도 변경으로 진행한다.

## 핵심 파일

- 생성 오케스트레이션/프롬프트/facts: `apps/api-nest/src/worker.service.ts`
- pattern/variant: `apps/api-nest/src/archetypes.ts`
- 글유형/축/modifier 값: `apps/api-nest/src/constants.ts`, `apps/api-nest/src/axis-tags.ts`, `apps/api-nest/src/slot.service.ts`
- 사실 검수/중복: `apps/api-nest/src/quality-gate.ts`
- DB/정규화: `apps/api-nest/src/db.service.ts`, `apps/api-nest/src/drivingplus-api.service.ts`
- 별도 외부 조사 연결 후보: `apps/api-nest/src/academy-research*.ts`

## 난이도와 위험

최소 변경안은 **중간 난이도**다. 기존 single-prompt 구조와 SQLite schema를 유지하므로 DB migration이 필수는 아니다. 가장 큰 위험은 deterministic slot/title 계약 및 quality gate가 프롬프트 수정을 과도하게 reject하는 것, 그리고 거리만으로 접근성을 암시하는 것이다. 확장 변경안은 provenance/freshness/read model까지 포함하면 **중상 난이도**이며 research data의 AI draft를 공식 사실처럼 노출하지 않는 policy가 선행돼야 한다.
