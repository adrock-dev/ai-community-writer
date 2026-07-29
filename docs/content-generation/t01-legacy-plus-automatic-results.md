# T01 Legacy Plus 자동 평가 결과

## Pair integrity

4개 pair 모두 target region, 고정 candidate ID·순서, slot seed, provider/model, timeout, CLI binary/version, repair/fallback 비활성 조건이 일치했다. 자세한 값은 `private/pair-integrity.jsonl`에 있다.

## Neutral evaluator

Native gate는 서로 다른 계약이므로 비교에 사용하지 않았다. 공통 neutral evaluator의 raw 결과는 다음과 같다.

| mode | neutral hard | neutral warning |
| --- | ---: | ---: |
| Legacy | 2 | 2 |
| Legacy Plus | 0 | 1 |

Legacy의 두 hard는 익산 비교표의 `셔틀 운행 지역` 열과 동해 본문의 “공개 자료에 포함되어 있지 않다” 문장을 `unverified_shuttle_claim`으로 판정한 것이다. 두 문장 모두 셔틀 운행을 사실로 단정하지 않는 문맥이므로, 이 raw count는 실제 사실 오류 수와 동일시할 수 없다. neutral evaluator 수정은 이번 범위 밖이다.

Legacy Plus의 유일한 neutral warning은 고성군의 질문형 문장 수다. Legacy Plus raw neutral hard는 0이다.

## 지역·표·출력 계약 보조 audit

- 모든 Legacy Plus 표본에서 non-primary 후보의 실제 소재지 누락은 0건이었다.
- Legacy Plus의 km·이동시간 표기는 0건, 내부 retrieval 용어 노출은 0건이었다.
- Legacy는 익산 3회, 동해 4회, 고성 3회의 km 표기를 포함했다. 고성에는 이동시간 관련 표현도 2회 기록됐다.
- `[object Object]`, 빈 제목, 중복 title, 빈 H2/H3, 내부 typed field 언어는 8개 생성물에서 발견되지 않았다.
- `[IMAGE:academy_n]`은 제공된 원천 사진을 renderer가 치환하는 기존 슬롯이며, 평가 출력에서 오류 placeholder로 처리하지 않았다.

자동 지표는 human blind review의 승자 결정에 사용하지 않는다.
