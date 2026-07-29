# OpenAI Responses provider 계약

기준일: 2026-07-20

## 입력

`runLlm(prompt, options)`는 기존 옵션에 다음 optional 필드를 additive하게 받는다.

```ts
{
  provider?: "codex" | "claude" | "openai_responses" | string;
  model?: string;
  timeoutSec: number;
  maxOutputTokens?: number;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh";
  signal?: AbortSignal;
}
```

`provider=openai_responses`일 때 model과 `OPENAI_API_KEY`가 필수다. 일반 worker 호출은 기존 `provider || "codex"`를 유지한다.

Responses body의 최소 형식은 다음과 같다.

```json
{
  "model": "<명시 model>",
  "input": "<기존 단일 prompt>",
  "store": false,
  "max_output_tokens": "<호출자가 전달한 경우만>"
}
```

기존 runner는 system/user 메시지를 분리하지 않고 단일 완성 prompt를 전달하므로, adapter도 의미를 바꾸지 않고 `input`에 전달한다. tools, streaming, web search, repair, fallback은 adapter가 추가하지 않는다.

## 결과

기존 `LlmResult` 필드는 유지하고 다음 optional metadata를 추가했다.

```ts
{
  text: "summary 필드에 보존",
  provider: "openai_responses",
  requested_model?: string,
  resolved_model?: string,
  duration_ms?: number,
  usage?: {
    inputTokens: number | null,
    outputTokens: number | null,
    totalTokens: number | null,
    cachedInputTokens?: number | null,
    reasoningTokens?: number | null
  },
  response_id?: string,
  response_status?: string,
  finish_reason?: string,
  warnings?: string[],
  retry_count?: number
}
```

편의 필드 `input_tokens`, `output_tokens`, `total_tokens`, `cached_input_tokens`, `reasoning_tokens`도 가능한 경우 채운다. API가 usage를 반환하지 않으면 0으로 위조하지 않고 `undefined`/`null`로 남긴다.

## 텍스트·오류 처리

* top-level `output_text`가 있으면 이를 우선 사용한다.
* 없으면 `output[]`의 `type=message` 안 `content[]`의 `type=output_text` fragment를 순서대로 결합한다.
* `reasoning` item과 tool call은 본문으로 사용하지 않는다.
* 성공 HTTP 응답인데 본문 텍스트가 없으면 `empty_output` 실패다.
* `AbortController`는 기존 `timeoutSec`을 사용한다. timeout, caller cancellation, network, invalid JSON을 서로 다른 `error_code`로 반환한다.
* HTTP 400/401/403/404/429/5xx는 각각 `invalid_request`, `authentication_error`, `permission_denied`, `model_not_found`, `rate_limit`, `server_error`로 매핑한다.
* remote error type/code, HTTP status, request ID는 가능한 범위에서 보존한다. Authorization header와 key는 결과에 포함하지 않는다.

OpenAI Responses API가 `output_text` helper와 raw output item을 제공한다는 계약은 [Responses migration guide](https://developers.openai.com/api/docs/guides/migrate-to-responses)를 기준으로 했다.
