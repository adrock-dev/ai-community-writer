# 콘텐츠 모델 접근성 결과

기준일: 2026-07-20

| 모델 | smoke 실행 | 판정 | HTTP/usage | 비고 |
| --- | --- | --- | --- | --- |
| `gpt-5.6-luna` | 미실행 | `not_tested_missing_credentials` | 없음 | `OPENAI_API_KEY` 부재 |
| `gpt-5.4-mini` | 미실행 | `not_tested_missing_credentials` | 없음 | `OPENAI_API_KEY` 부재 |

`OPENAI_API_KEY` 값은 확인·출력하지 않았으며, key가 없는 상태에서 network request를 만들지 않았다. 따라서 이 표는 모델 품질이나 계정 권한에 대한 부정 판정이 아니다.

2026-07-20 재검증에서도 `OPENAI_API_KEY=false`, `OPENAI_API_BASE_URL=false`만 존재 여부로 확인됐다. 값은 읽거나 기록하지 않았다.

현재 adapter는 두 requested model을 일반 문자열로 전달한다. 공식 model 문서상 `gpt-5.6-luna`와 `gpt-5.4-mini`는 Responses API 지원 대상으로 문서화돼 있지만, 이 프로젝트 API 계정의 권한·alias 접근성은 credential-gated smoke 전에는 알 수 없다. [Luna model 문서](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [GPT-5.4 mini model 문서](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
