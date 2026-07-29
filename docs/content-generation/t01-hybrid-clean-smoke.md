# T01 Hybrid Clean Smoke

실행일: 2026-07-20

결과 경로: `data/content-generation-evaluation/t01-hybrid-abc-clean-20260720-1710/`

## 실행 조건

- 표본: 전북특별자치도 익산시 (`B_supplement`)
- 후보 ID 및 순서: `120, 149, 140, 122, 112`
- slot seed: `live-ab-01-전북특별자치도 익산시`
- provider/model: Codex CLI / `gpt-5.6-luna`
- timeout: 600초, `content_generation`, read-only, ephemeral
- repair/fallback/운영 DB 저장: 모두 비활성

## 생성 결과

| Mode | 생성 | 제목 | CLI usage (입력/출력/총) | 시간 |
| --- | --- | --- | --- | --- |
| Legacy | 성공 | `전북특별자치도 익산시 운전면허학원 BEST 5` | 24,436 / 5,150 / 29,586 | 103.177초 |
| T01 v2 | 성공 | 동일 | 26,266 / 5,219 / 31,485 | 99.055초 |
| Hybrid | 성공 | 동일 | 24,445 / 3,359 / 27,804 | 65.898초 |

세 결과 모두 최신 runner가 생성한 원본과 final markdown을 사용했다. 과거 artifact를 후처리해 사용하지 않았다.

## Clean title 및 triple 무결성

- `[object Object]`, JSON 객체 문자열화, 내부 title-rule/변수명, 빈 H1, H1 중복: 세 결과 모두 없음.
- target region, 후보 ID/순서, slot seed, requested/resolved model, timeout, Codex binary/version, repair/fallback: `tripleIntegrity` 모두 `true`.
- H2/H3 빈 section 및 인접 heading: 세 결과 모두 없음.
- Codex usage는 JSONL `turn.completed` 이벤트에서 보존됐다. 비용은 ChatGPT CLI 사용량이므로 `not_measured_chatgpt_cli`다.

## Hybrid review 계약 확인

Hybrid는 가나안자동차운전학원(ID `120`)에 연결된 리뷰 한 건을 사용했다.

- 인용 수: 1
- 출처: `DrivingPlus 수강생 리뷰`
- 리뷰 원천 연결 및 출처 인접성: 확인됨
- 작성자, 작성일, 평점, 닉네임, 내부 review ID: 미노출
- 리뷰를 합격률이나 전체 수강생 평가로 일반화한 표현: 없음

## Gate 판정

판정: `failed`

Hybrid native gate가 `t01_hybrid_empty_checklist` hard failure 1건을 반환했다. final markdown에는 실제로 `✅`로 시작하는 체크리스트 6개가 있으나, 현 gate의 `parseDecisionSupport()`는 `-`, `*`, 숫자 목록만 checklist item으로 인식한다. 따라서 제목 artifact나 review 계약 위반이 아니라 checklist marker 형식과 gate parser의 불일치다.

이번 요청은 prompt, hybrid gate, FAQ/checklist dedupe를 변경하지 않도록 제한하므로 이 실행에서 이를 수정하거나 결과를 후처리하지 않았다. Clean triple gate의 “Hybrid hard failure 없음” 조건을 충족하지 못했으므로 다음 3개 지역 생성은 수행하지 않았다.

## Native / neutral 참고

native hard issue는 mode 간 품질 비교 지표가 아니다.

- Legacy native: `too_long_7137`
- v2 native: `too_long_6244`; warning `unverified_shuttle_implication`, score penalty `repeated_consultation_phrase`
- Hybrid native: `t01_hybrid_empty_checklist`

기존 neutral evaluator를 같은 typed snapshot으로 read-only 재적용하면 Legacy 1 hard / 1 warning, v2 0, Hybrid 1 hard가 나왔다. Legacy 및 Hybrid의 셔틀 hard는 “셔틀 운행 지역/탑승 장소를 확인”이라는 확인 목록을 긍정 셔틀 주장으로 오인한 것이므로, 이번 smoke의 사람 평가용 사실 오류 결론으로 사용하지 않는다.
