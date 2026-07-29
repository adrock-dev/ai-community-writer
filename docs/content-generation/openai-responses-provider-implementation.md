# OpenAI Responses provider 구현 결과

기준일: 2026-07-20

## 구현 범위

공통 `runLlm()`에 명시적 `openai_responses` provider를 추가했다. 기본 provider, 관리자 기본값, T01 `generation_mode`, 후보 선택, 프롬프트, quality gate, DB는 변경하지 않았다.

변경 파일:

* `apps/api-nest/src/llm-runner.ts`
* `apps/api-nest/src/openai-responses-provider.ts`
* `apps/api-nest/src/scripts/smoke-openai-responses.ts`
* `apps/api-nest/test/openai-responses-provider.test.ts`

## Routing과 하위 호환

| 요청 provider | 실제 경로 | 기본값 영향 |
| --- | --- | --- |
| 생략 또는 빈 값 | 기존 `codex` | 변경 없음 |
| `codex` | 기존 `codex exec --json ...` | 명령행 인자 유지 |
| `claude` | 기존 `claude --print ... stream-json` | 명령행 인자와 OAuth용 환경 제거 유지 |
| `openai_responses` | native `fetch` 기반 `/v1/responses` | 명시적 opt-in |
| 그 외 | `unknown_provider` 오류 | Claude로 묵시적 fallback하지 않음 |

기존 runner는 `codex`가 아닌 provider를 모두 Claude로 보내고 있었다. 이 구현은 알려지지 않은 provider만 명시적으로 실패시키며, 생략된 provider는 기존처럼 Codex다.

## Responses adapter

* SDK를 설치하지 않고 Node native `fetch`를 사용한다.
* endpoint는 `OPENAI_API_BASE_URL` 또는 `https://api.openai.com`에서 안전하게 `/v1/responses`로 정규화한다.
* 요청에 `Authorization: Bearer …`, `Content-Type: application/json`, `store: false`를 포함한다.
* model은 명시적으로 필요하다. 누락하면 임의 모델을 선택하지 않고 `missing_model`을 반환한다.
* 기존 콘텐츠 경로에는 출력 토큰 상한 설정이 없으므로 해당 요청에는 `max_output_tokens`를 추가하지 않는다. smoke runner는 명시적으로 50을 전달한다.
* reasoning effort는 호출자가 명시한 경우에만 body에 넣는다. 모델별 옵션을 추측해 자동으로 넣지 않는다.
* provider 내부 retry는 없다. 상위 호출자의 기존 retry/repair 정책과 중복 과금되지 않도록 `retry_count: 0`을 결과에 남긴다.

## 검증 결과

2026-07-20에 다음을 실행했다.

```text
npm --prefix apps/api-nest test -- openai-responses-provider.test.ts
# 13 passed
npm --prefix apps/api-nest run typecheck
# passed
npm --prefix apps/api-nest run build
# passed
npm --prefix apps/api-nest test
# 14 files, 150 tests passed
```

실제 API 호출 smoke는 credential gate에서 중단됐다. `OPENAI_API_KEY`가 현재 환경에 없어서 네트워크 호출, 비용, 콘텐츠 생성은 모두 0회다. 이 상태는 adapter 테스트 실패가 아니라 `not_tested_missing_credentials`다.
