# T01 Legacy Plus 전략

## 결론

`t01_legacy_plus_v1`은 Legacy의 `buildPrompt()` 서술 골격을 그대로 사용하고, 확인된 부족 기능만 T01 전용으로 보강한다. 기본 모드와 기존 Legacy, `t01_data_gated_v2`, `t01_hybrid_v1`은 바꾸지 않는다.

## Phase A 재검증

기존 사람 평가의 “Legacy가 더 자연스럽다”는 평가는 상세 점수 파일이 아니라 사용자 피드백과 기존 4개 표본 분석에 근거한다. 코드상 근거는 `apps/api-nest/src/worker.service.ts`의 기존 `buildPrompt()`이다. 이 프롬프트는 지역 도입, 후보 카드, 비교표, 체크리스트, 선택적 FAQ를 한 블로그 서술로 연결하며 typed candidate·retrieval source·coverage 같은 내부 용어를 본문 지시로 넣지 않는다.

| 항목 | 판정 | Legacy Plus 처리 |
|---|---|---|
| 지역 도입과 후보 카드형 흐름 | legacy_keep | 기존 `buildPrompt()` 재사용 |
| 학원별 전환과 결측값의 제한적 안내 | legacy_keep | 별도 구조 가이드 미주입 |
| 후보별 review theme 반복 | legacy_fix | 후보 학원별 적격 원문 1건만 제공하고 100자 이상은 말줄임 처리 |
| FAQ와 체크리스트의 동일 확인 행동 | legacy_fix | 생성 후 semantic dedupe |
| 인근 후보 소재지 | v2_safety_keep | 실제 소재지만 한 번 이상 고지하도록 T01 gate 적용 |
| 표의 사실 일치·허위 가격/셔틀/합격률 | v2_safety_keep | T01 사실 gate를 Legacy Plus 전용으로 적용 |
| Hybrid의 review selector와 dedupe | hybrid_feature_keep | selector와 개념만 재사용, Hybrid prompt는 재사용하지 않음 |
| typed 내부 용어·긴 provenance 설명 | remove | prompt와 본문에 노출하지 않음 |

## 사진 정책

T01은 이미 원천 `photos`와 `thumb_url`에서 사진 슬롯을 만들며, 학원 중심 글은 후보 학원당 1장·최대 5장으로 제한한다. Legacy Plus도 이 정책을 유지한다. 원천 사진이 여러 장이더라도 이번 모드에서는 학원별 첫 유효 사진 하나만 해당 학원 카드 안에 쓴다.

## 경계

후보 선택은 기존 `pickAcademiesForRegion()`과 동일한 최종 후보·순서를 사용한다. Legacy Plus는 후보를 다시 고르거나 DB 데이터를 변경하지 않는다. `t01_legacy_plus_v1`을 명시하지 않은 요청은 기존 Legacy를 사용한다.
