# 콘텐츠 모델 최소 smoke test

기준일: 2026-07-20

## 실행기

`apps/api-nest/src/scripts/smoke-openai-responses.ts`는 아래 두 model에 대해 각 최대 한 번의 짧은 호출만 수행한다.

* `gpt-5.6-luna`
* `gpt-5.4-mini`

조건:

* `OPENAI_API_KEY`가 있을 때만 실행
* 짧은 비학원 한국어 문장
* `store: false`
* `max_output_tokens: 50`
* timeout 30초
* tools, streaming, repair, fallback 미사용
* 본문 원문, key, Authorization header 미출력

빌드 후 실행 명령:

```text
node apps/api-nest/dist/scripts/smoke-openai-responses.js
```

## 실제 실행 결과

현재 환경에서는 `OPENAI_API_KEY`가 설정되지 않아 아래 결과로 종료했다.

```json
{
  "executed": false,
  "status": "not_tested_missing_credentials",
  "requiredEnvironmentVariable": "OPENAI_API_KEY",
  "models": ["gpt-5.6-luna", "gpt-5.4-mini"]
}
```

따라서 두 model 모두 아직 API 계정 접근성, 실제 usage, 실제 비용, 실제 텍스트 추출을 확인하지 않았다. 실제 provider response parser는 fetch mock으로만 검증했다.

### 2026-07-20 재검증

이번 접근성 검증에서 사전 provider 테스트(13개), 전체 API Nest 테스트(150개), typecheck, build를 다시 통과한 뒤 같은 runner를 실행했다. 결과는 동일하게 `not_tested_missing_credentials`였고, API request·학원 데이터 전송·콘텐츠 생성은 발생하지 않았다.
