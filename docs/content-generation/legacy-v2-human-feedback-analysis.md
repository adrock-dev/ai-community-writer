# Legacy/V2 사람 평가 및 산출물 분석

분석일: 2026-07-20. 이 문서는 코드를 바꾸지 않은 읽기 전용 분석이다.

## 증거 범위와 한계

| 구분 | 확인한 근거 | 판정에 쓰는 방식 |
| --- | --- | --- |
| 사람 의견 | 사용자가 전달한 “legacy가 전반적으로 더 자연스럽고 읽기 좋다” | 정성 피드백으로만 사용 |
| 사람 점수/서술 | 저장소 검색에서 회수되지 않음. 블라인드 양식과 mapping만 존재 | 수치적 승패로 사용하지 않음 |
| 실제 글 | 익산·동해·고성·원주의 legacy/v2 raw output | 문장·구조 관찰의 주 근거 |
| 사실 안전성 | 4 pair neutral evaluator hard failure `0/0`; v2 native claim false positive 수정 후에도 구조 gate는 별도 | 자연스러움과 사실 오류를 분리 |

평가 표본과 매핑은 [review-pairs.md](../../data/content-generation-evaluation/codex-cli-four-pair-20260720/blind/review-pairs.md), [pair-mapping.json](../../data/content-generation-evaluation/codex-cli-four-pair-20260720/private/pair-mapping.json)에 있다. 원본은 익산 [legacy](../../data/content-generation-evaluation/codex-cli-single-pair-20260720/raw/legacy/pair-01.md) / [v2](../../data/content-generation-evaluation/codex-cli-single-pair-20260720/raw/v2/pair-01.md), 추가 3개 pair의 [legacy](../../data/content-generation-evaluation/codex-cli-additional-pairs-20260720/raw/legacy) / [v2](../../data/content-generation-evaluation/codex-cli-additional-pairs-20260720/raw/v2)에 있다.

## 표본 관찰

| 지역 | 구성 | legacy 관찰 | v2 관찰 |
| --- | --- | --- | --- |
| 익산시 | 지역 내 4 + 김제 supplement 1 | 생활권에서 자연스럽게 후보로 이어지나, 김제 후보의 `13.2km`를 여러 번 사용 | 김제 후보의 실제 소재지는 명확하나 직선거리 정의·한계를 도입/카드/표에 반복 |
| 동해시 | 동해 2 + 삼척 supplement 1 | FAQ와 체크리스트가 비용·셔틀·일정 확인을 반복 | 삼척시 후보를 정확히 구분하지만 9.4km와 안전 문구가 반복 |
| 고성군 | 고성 1 + 속초 far 1 | 지역 밖 후보를 구분하지만 FAQ와 체크리스트가 동일 상담 질문을 재진술 | 속초시라는 실제 소재지는 가장 명확하나 29.8km·직선거리 면책 문장이 글의 흐름을 끊음 |
| 원주시 | 지역 내 3, 공통 변동 facts 부족 | 후보 소개·결론이 비교적 매끄러우나 후기 “흐름”이 반복 | 주소/결측은 보수적이나 각 후보의 “확인” 문장이 카드 리듬을 균질화 |

historical output의 수치는 legacy/v2 각각 익산 `5,957/5,667`, 동해 `5,741/5,718`, 고성 `6,014/4,702`, 원주 `5,558/5,257`자다. 이 표본은 현재 코드보다 이전 prompt 계약으로 생성됐다. 현재 v2는 거리·좌표를 prompt payload에서 제외한다([t01-data-gated.ts](../../apps/api-nest/src/t01-data-gated.ts:122)); 따라서 과거의 km 반복은 hybrid 위험 근거이지만 현재 출력의 확정 예측은 아니다.

## 가설 판정

| 가설 | 판정 | 코드·산출물 근거 |
| --- | --- | --- |
| A. legacy가 덜 제약돼 자연스럽다 | partially_confirmed | legacy에는 지역 상황·카드형 리듬 지시가 있고([worker.service.ts](../../apps/api-nest/src/worker.service.ts:770)), 익산/원주 본문 전환이 덜 계약 언어적이다. 다만 상세 사람 점수는 없음. |
| B. v2의 안전 지시가 기계적으로 보인다 | confirmed | 당시 v2 prompt는 provenance, `straightLineDistanceKm`, variant, modifier, JSON을 추가했고, 고성 v2는 직선거리의 한계를 세 문단과 표에서 반복한다. |
| C. typed facts/variant 자체보다 표현 방식이 문제다 | confirmed | 현재 typed context는 내부 검증 데이터이고([t01-data-gated.ts](../../apps/api-nest/src/t01-data-gated.ts:94)), 같은 데이터가 legacy narrative에 부가될 수 있다. 문제는 당시 prompt가 internal 용어·거리 설명을 본문 규칙으로 강하게 노출한 점이다. |
| D. 일부 안전 규칙은 gate가 더 적합하다 | confirmed | 비교표 불일치, km 노출, 지역 오표현, 셔틀·합격률 claim은 `t01QualityIssues()`가 검사한다([t01-data-gated.ts](../../apps/api-nest/src/t01-data-gated.ts:161)). 생성 prompt에는 짧은 금지로 충분한 항목이 있다. |
| E. 리뷰는 전체 최대 1개가 적절하다 | partially_confirmed | 역사적 글은 후보별 후기 흐름을 반복해 광고성·길이 위험을 보였다. 다만 “1개가 최적”이라는 사람 평가 데이터는 없어 제품 정책으로 검증해야 한다. |
| F. FAQ/체크리스트가 중복된다 | confirmed | 익산 legacy FAQ의 비용·셔틀·수강기간 질문이 바로 뒤 checklist의 비용·셔틀·시간 항목과 의미상 같다. 고성 legacy도 동일하다. |
| G. hybrid가 적합하다 | partially_confirmed | v2 provenance/typed facts/gate와 legacy narrative은 결합 가능하지만, 현재 리뷰는 후보별 1건이라 글 전체 1건 정책 adapter와 FAQ dedupe가 선행돼야 한다. |

## 결론

legacy의 선호는 “사실 안전성의 부정”이 아니다. neutral hard failure가 모두 0인 4 pair에서는 v2의 더 많은 native 문제 수가 과거 claim-context false positive와 구조 규칙 차이였으며, 품질 우열 수치가 아니다. 따라서 `legacy narrative + v2 facts/provenance/variant/gate`를 별도 opt-in hybrid mode로 검증하는 것이 타당하다.
