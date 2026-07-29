# T01 v2 quality-gate false-positive 수정 결과

수정 범위는 `apps/api-nest/src/t01-data-gated.ts`의 shuttle/pass-rate claim 문맥 판별과 `apps/api-nest/test/t01-claim-context.test.ts` 회귀 fixture다. 프롬프트, variant, modifier, 후보 선정, typed candidate, neutral evaluator, provider, 기본 generation mode 및 DB는 변경하지 않았다.

## 검증

| 검증 | 결과 |
| --- | --- |
| 실제 false-positive fixture | 8개 문장 모두 pass |
| 명확한 셔틀 긍정 주장 | supporting fact 없으면 hard failure 유지 |
| 명확한 합격률/수치 주장 | supporting fact 없으면 hard failure 유지 |
| 긍정 주장 뒤 확인 권고 | hard failure 유지 |
| 가능성 암시 | warning으로 분리 |
| T01 data-gated / claim-context targeted test | 14 tests passed |
| 전체 API test | 16 files, 157 tests passed |
| typecheck / build / `git diff --check` | passed |

비T01 및 legacy 영향은 없다. `t01QualityIssues()`는 worker에서 T01 `t01_data_gated_v2` context가 있을 때만 호출되고, 전체 회귀에는 legacy 및 neutral evaluator isolation tests가 포함된다.

수정은 native hard count의 공정성을 회복한 것이며, 콘텐츠 품질을 자동으로 개선하거나 legacy/v2의 우열을 판정한 것은 아니다.
