# T01 v2 claim context detector

기준일: 2026-07-20. 이 판별기는 `apps/api-nest/src/t01-data-gated.ts`의 `t01QualityIssues()`에서만 사용한다. legacy `articleQualityIssues()`와 neutral evaluator는 변경하지 않았다.

## 목적과 범위

기존 `t01_unverified_shuttle_claim`과 `t01_unverified_pass_rate_claim`은 글 전체에 키워드가 있으면 hard failure를 낼 수 있었다. 이제 topic별 문장을 추출해 `T01ClaimContext`로 분류한다.

| 필드 | 값 |
| --- | --- |
| `topic` | `shuttle` 또는 `pass_rate` |
| `polarity` | `positive`, `negative`, `uncertain`, `neutral` |
| `epistemicStatus` | `asserted`, `unverified`, `verification_required`, `speculative`, `denied` |
| `claimType` | `factual_assertion`, `verification_advice`, `absence_of_information`, `general_guidance`, `speculative_statement` |
| `isFactualAssertion` | typed supporting fact가 없을 때 hard failure를 낼 수 있는지 |

처리 순서는 문장 추출 → 직접 부정/단정 불가 → 자료 부재 → 명확한 긍정 주장 → 가능성 암시 → 확인·문의 권고 → 일반 안내다. 따라서 단순히 “확인”이라는 단어가 있다는 이유로 긍정 주장을 통과시키지 않는다. 예를 들어 “이 학원은 셔틀을 운영하므로 자세한 시간은 확인하세요”는 `asserted`로 남아 hard failure다.

가능성 암시(예: “셔틀 이용이 가능할 수 있습니다”, “합격 가능성이 높을 수 있습니다”)는 hard failure가 아닌 T01 v2 warning(`unverified_*_implication`)으로 남긴다. 이것은 안전한 미확인 고지와 같지 않으므로 후속 품질 검토 대상이다.

## 회귀 근거

`apps/api-nest/test/t01-claim-context.test.ts`는 익산·동해·고성·원주의 실제 native false positive 문장 8개를 원문으로 고정했다. 각 fixture에는 topic, candidate ID, supporting fact 없음, 기존 hard-failure 판정, 기대 pass, 판정 이유가 있다. 이 테스트는 긍정 사실 주장, 부정/미확인, 확인 권고, 가능성 암시, 긍정 주장 뒤 확인 권고를 함께 검증한다.

이 규칙은 자연어 의미를 완전하게 해석하지 않는다. 복합 문장과 새로운 완곡 표현은 warning 또는 추가 fixture 후보로 남긴다.
