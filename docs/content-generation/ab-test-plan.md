# 지역 비교 콘텐츠 A/B 평가 설계

## 목적과 고정 조건

동일한 slot, 동일 academy facts snapshot, 동일 모델/temperature-equivalent CLI 설정, 동일 이미지 on/off, 동일 repair 횟수로 비교한다.

- **A (control):** 현재 `buildPrompt` + 현재 T01 `local` structure 선택.
- **B (treatment):** 권장안의 typed fact matrix + data-gated composition profile + typed modifier prompt를 적용한 실험용 prompt.
- 외부 웹 조회는 두 군 모두 끈다. 현재 생성 worker에서 `use_web_research`가 소비되지 않기 때문이다.
- 평가 중에는 운영 prompt/DB를 바꾸지 않고, 독립 script 또는 test fixture에서 prompt/출력을 캡처한다.

## 자동 평가와 사람 평가

| 영역 | 자동 평가 | 사람 평가 |
|---|---|---|
| 검색 의도 충족 | title/H1/section이 slot keyword·persona·intent에 대응하는지 규칙 검사 | 검색자가 질문에 답을 얻는지 1~5점 |
| 지역 관련성 | region, direct/nearby label, 거리 노출, 지역 외 후보의 label 검사 | 생활권/확장 이유가 납득되는지 |
| 비교 가능성 | 후보별 공통 필드 matrix coverage, 표의 후보명/행 수 | 실제 등록 선택에 도움이 되는지 |
| 사실 정확성 | output claim을 input facts field와 compare; 없는 가격/후기/합격률/셔틀/면허 claim 차단 | 사실과 해석이 섞이지 않는지, 과장 여부 |
| 데이터 활용률 | 제공 non-null fields 중 본문/표에서 이용한 비율; irrelevant SEO field 제외 | 중요한 값이 자연스럽게 쓰였는지 |
| 섹션 논리 | profile별 required section order/heading checks | 도입→후보→결정 지원 흐름 |
| 가독성 | 기존 `articleQualityIssues`, H2, 문단/문장 길이, 표/리스트 | 스캔성, 장황함, 문체 |
| 결정 지원 | 최종 비교표/체크리스트/persona recommendation 존재와 facts-backed 여부 | 독자가 다음 행동을 정할 수 있는지 |
| 과장 표현 | 기존 risky/cliché gate + 최고/압도적/완벽/합격률 우수/무조건 추천 lexicon | 미묘한 암시·순위 과장이 없는지 |
| 반복성 | section fingerprint, title n-gram, cosine/Jaccard 및 기존 published corpus와 비교 | 3개 글을 나란히 보고 템플릿 티 평가 |
| 기존 글 유사성 | 현재 `dedup` Jaccard 0.75 + 제목/heading sequence similarity | 표면 변경만 한 반복인지 판단 |

## 채점 방식

- 자동 hard fail: 사실 위반, 허위 후보명, direct/nearby label 누락, 위험 합격/기간, quality gate 실패.
- 자동 score (0~100): 의도 10, 지역 12, 비교 16, 사실 25, 데이터 활용 10, 논리 8, 가독성 7, 결정 지원 8, 반복/유사성 4.
- 사람 score (각 1~5): 의도·지역 적합성·비교 용이성·신뢰성·읽기성·결정 도움·반복감. 두 명 이상 blind review, disagreement 2점 이상은 adjudication.
- 성공 기준: B가 hard fail 증가 없이 평균 사람 점수 +0.7 이상, 자동 사실/비교 점수 +10 이상, output token/repair 횟수 +20% 이내. 실패 사례는 prompt 수정 대신 facts 부족/route policy/검수 결함으로 분류한다.

## 3개 입력 fixture 제안

기존 테스트 구조(`apps/api-nest/test/structure-variant.test.ts`, `quality-gate.test.ts`, `scripts/tests/golden-slots.json`)를 확장해 아래 fixture를 만든다. 값은 실운영 DB를 복사하지 않고 해당 테스트에서 제공하는 고정 facts snapshot을 사용한다.

| Fixture | slot / 데이터 shape | 검증할 가설 |
|---|---|---|
| `dense-direct-three` | T01, 지역 R, direct 학원 3곳, address/type/price/shuttle/hours/review 일부 보유, 좌표 있음 | B가 순차 비교와 최종 field-consistent 표를 만들고, 각 후보의 지역 의미/적합도를 구분한다. |
| `sparse-one-nearby-two` | T01, direct 1곳 + 20km nearby 1곳 + 42km guaranteed 1곳, price/shuttle 결측 다수 | B가 확장 이유와 direct/nearby/closest 구분을 하고, 42km를 “인접”/셔틀 가능으로 단정하지 않는다. |
| `modifier-data-mismatch` | T01, `셔틀편리` + `주말반`, 3곳 중 shuttle/weekend fact는 1곳만 확인 | B가 사실 있는 후보에만 강조하고 나머지는 확인 질문으로 처리한다. A의 modifier 한 줄 효과와 차이를 측정한다. |

## 실행 산출물

각 fixture마다 `facts.json`, A/B prompt, raw output, normalized Markdown, quality result, claim ledger, evaluator JSON을 보관한다. 모델 nondeterminism을 줄이기 위해 각 군 3회 실행하고 mean/median과 최저 사례를 같이 보고한다. 운영 posts를 noindex로 바꾸는 기존 dedup job은 평가에 사용하지 않고 read-only similarity 함수만 호출한다.
