# 단일 Legacy/V2 pair 실행 결과

기준일: 2026-07-20

## 실행 gate

| 조건 | 결과 |
| --- | --- |
| OpenAI provider mock 테스트 | 통과: 13개 |
| 전체 API Nest 테스트 | 통과: 14 파일, 150개 |
| typecheck / build | 통과 |
| `OPENAI_API_KEY` 존재 | 미충족 |
| Luna 또는 GPT-5.4 mini smoke 성공 | 미실행 |
| 기존 candidate snapshot | 존재하지만 사용하지 않음 |

## 판정

단일 pair는 **실행하지 않았다**. `OPENAI_API_KEY`가 없으므로 모델 smoke가 `not_tested_missing_credentials`로 종료됐고, pair 실행 전제인 최소 한 model의 `accessible` 판정을 얻지 못했다.

따라서 다음은 모두 미측정이다.

* target region·지역 유형
* candidate snapshot ID, 후보 ID/순서, slot seed
* requested/resolved model
* legacy 및 T01 v2 raw output
* pair integrity
* quality hard failure/warning
* usage, duration, 예상 비용

운영 DB, 글 테이블, slot, prompt, `generation_mode`, provider 기본값에는 쓰기 작업을 하지 않았다. key가 설정된 환경에서 다음 순서로 재실행해야 한다: `node apps/api-nest/dist/scripts/smoke-openai-responses.js` → 성공 모델 확인 → 기존 readonly A/B snapshot 중 supplement 포함 사례 한 건으로 repair/fallback 없이 legacy/v2 각 1회.
