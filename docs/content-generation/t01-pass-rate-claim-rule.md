# T01 v2 합격률 claim rule

대상 rule은 `t01_unverified_pass_rate_claim`이다. T01 v2 typed candidate 중 어느 후보에도 `passRate` fact가 없을 때만 평가한다.

| 문맥 | 판정 |
| --- | --- |
| “합격률이 높다”, “높은 합격률로 유명하다”, “합격률은 92%다”, “대부분 한 번에 합격한다” | hard failure |
| “공식 합격률은 자료에서 확인할 수 없다”, “합격률을 단정하기 어렵다”, “상담 때 관련 자료를 문의하세요” | pass |
| “합격 가능성은 개인별 연습 정도에 따라 다르다” | pass (일반 안내) |
| “합격 가능성이 높을 수 있다”, “좋은 합격 성과를 기대할 수 있다” | warning: `unverified_pass_rate_implication` |
| “합격률이 높은 학원이니 공식 자료도 확인하세요” | hard failure |

확인 권고는 이미 제시된 긍정 합격률 주장을 무효화하지 않는다. 실제 `passRate` fact가 있으면 이 rule은 hard failure를 내지 않는다.
