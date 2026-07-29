# T01 Legacy Plus smoke 결과

## 최종 근거

최종 clean smoke는 [고정 익산시 평가 결과](../../data/content-generation-evaluation/t01-legacy-plus-smoke-20260720-1756/metrics/summary.json)를 사용했다. 대상은 전북특별자치도 익산시(B_supplement), 후보 ID 순서는 `[120,149,140,122,112]`, slot seed는 `live-ab-01-전북특별자치도 익산시`이다.

- provider/model: `codex` / `gpt-5.6-luna`
- Codex CLI: `0.144.6`, ChatGPT 로그인 세션
- timeout: 600초, `content_generation`, read-only/ephemeral
- repair/fallback/운영 DB 저장: 모두 비활성
- pair integrity: candidate IDs·순서·target region·seed·provider·model·timeout 모두 일치

## 생성 결과

| mode | 성공 | 글자 수 | 시간 | input/output tokens | native hard failure |
|---|---:|---:|---:|---:|---|
| Legacy | 예 | 5,812 | 91.791초 | 24,436 / 4,868 | `too_long_5812` |
| Legacy Plus | 예 | 5,466 | 120.585초 | 24,658 / 4,147 | 없음 |

CLI 비용은 `not_measured_chatgpt_cli`다. API 가격으로 환산하지 않았다.

## Legacy Plus 검증

> 이 결과는 글 전체 대표 review 1건 정책으로 생성된 이전 smoke 기록이다. 2026-07-21부터 Legacy Plus는 후보 학원별 적격 review 최대 1건·100자 말줄임 정책으로 변경됐으므로, 이 문서는 새 정책의 생성 검증 근거로 사용하지 않는다.

- 대표 review: academy ID `120`, 가나안자동차운전학원, 정확히 1개
- source: `DrivingPlus 수강생 리뷰`
- 작성자·작성일·평점·닉네임·내부 ID: 미노출
- FAQ: checklist와 의미가 겹친 FAQ block이 생성 후 제거됨; 빈 heading 없음
- 인근 후보: 벽성자동차운전전문학원을 김제시 백산면 소재로 고지
- km·직선거리 수치: 미노출
- native Legacy Plus hard failure: 0
- neutral evaluator: Legacy Plus 0건, Legacy는 `unverified_shuttle_claim` 1 hard failure와 질문 과다 warning 1건

실제 결과는 [Legacy Plus 글](../../data/content-generation-evaluation/t01-legacy-plus-smoke-20260720-1756/final/legacy-plus/legacy-plus-smoke-01.md)과 [품질 로그](../../data/content-generation-evaluation/t01-legacy-plus-smoke-20260720-1756/quality/legacy-plus/legacy-plus-smoke-01.json)에서 확인할 수 있다.

## 제외한 재실행

`1740` 결과는 FAQ 답변만 제거해 빈 H3가 남는 dedupe 결함을 발견한 artifact이고, `1751` 결과는 이전 build가 로드되어 generic source label이 나온 artifact다. 둘 다 최종 평가 근거로 사용하지 않았다.
