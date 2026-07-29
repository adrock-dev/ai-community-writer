# OpenAI Responses provider gap 분석

## 현재 계약과 gap

현재 공통 계약은 `apps/api-nest/src/llm-runner.ts:8`의 다음 결과 타입뿐이다.

```ts
{ ok, summary, provider, model, duration_sec, cost_usd?, input_tokens?, output_tokens?, session_id?, error? }
```

이는 Responses API 결과를 수용하기에 충분한 최소 출력 계약이다. 그러나 provider interface/class/registry는 없고, `runLlm()`의 `if (codex) ... else (claude)` 두 분기뿐이다. 새 provider를 안전하게 추가하려면 unknown provider를 Claude로 보내는 현재 fallback을 제거하거나 explicit provider registry로 바꿔야 한다.

| 기능 | 현재 | Responses adapter에 필요한 동작 | 호환성 |
| --- | --- | --- | --- |
| API 인증 | Codex/Claude CLI OAuth | `OPENAI_API_KEY` Bearer | 신규 |
| base URL | 이미지에만 `OPENAI_API_BASE_URL` | 텍스트에도 동일 base URL 재사용 가능 | additive |
| text 요청 | CLI stdin | `POST {baseUrl}/responses` | 신규 |
| Markdown 본문 | CLI parser summary | `response.output_text` | additive |
| structured output | 없음 | 필요 시 `text.format` | 선택적; 본문 A/B에는 불필요 |
| token usage | Codex 미수집, Claude 일부 비용만 | Responses `usage`를 `input_tokens`/`output_tokens`로 매핑 | additive |
| cost | Claude만 `total_cost_usd` | usage × versioned price table 또는 `null` | 신규 정책 |
| timeout | subprocess SIGTERM | `AbortController` | 이미지 구현 재사용 가능 |
| retry/rate limit | 없음 | 429/5xx만 bounded retry 또는 최초 A/B는 0회 | 신규 정책 |
| storage/privacy | CLI 인증에 위임 | `store: false` 명시 | 신규 |

Responses 가이드에서 JS `client.responses.create()`는 `response.output_text`를 본문으로 사용하며, structured output은 Responses의 `text.format`으로 지정한다. Responses의 기본 저장 동작도 명시돼 있다. [공식 가이드](https://developers.openai.com/api/docs/guides/migrate-to-responses)

## 최소 smoke test 제안 — 실행하지 않음

현 환경에는 API key가 없으므로 아래 명령은 **이번 작업에서 실행하지 않았다**. key가 안전한 staging project에 주입된 뒤 한 모델당 1회, 일반 문장만 쓰는 접근 gate로만 사용한다.

```bash
: "${OPENAI_API_KEY:?OPENAI_API_KEY is required}"
curl --silent --show-error --max-time 30 https://api.openai.com/v1/responses \
  -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"gpt-5.6-luna",
    "store":false,
    "input":"OK 한 단어만 출력하세요.",
    "max_output_tokens":50,
    "reasoning":{"effort":"none"}
  }'
```

안전 조건:

- 학원 DB, 후보 facts, 실제 prompt, 개인정보를 넣지 않는다.
- streaming을 쓰지 않고 model당 1회, 최대 50 output tokens로 제한한다.
- stdout에는 응답 ID/usage만 남기고 Authorization header/API key는 로그에 남기지 않는다.
- HTTP status와 JSON `error.type`/`error.code`를 기록해 401 인증, 403 결제·권한, 404 model access/not found, 429 rate limit, 400 request validation을 구분한다. 실제 status/code 형식은 API 응답을 원문 그대로 비밀값 없이 보존한다.
- model list 조회만으로는 실 생성 권한·quota를 완전히 보장하지 않으므로, 위 짧은 non-streaming request가 최종 접근 gate다.

## 권장 최소 구현 경계 (향후 요청용)

### T01 A/B만 우선하는 범위

1. `apps/api-nest/src/llm-runner.ts`: `openai`를 Claude fallback으로 보내지 않도록 명시 분기/오류 처리.
2. `apps/api-nest/src/openai-responses-provider.ts` (신규): raw `fetch`, `OPENAI_API_KEY`, 선택 `OPENAI_API_BASE_URL`, `AbortController`, `store:false`, `output_text`, usage/error parser.
3. `apps/api-nest/src/scripts/run-live-t01-ab.ts`: explicit `--provider openai --model <exact-id>`를 허용하고 동일 snapshot으로 양 mode 호출.
4. `apps/api-nest/test/llm-runner*.test.ts` 및 evaluator test: request body, timeout, usage/error mapping, legacy/v2 same-model parity.

이 범위에는 `worker.service.ts`, DB schema, admin UI 변경이 필요 없다. A/B runner가 explicit provider를 전달하고 `runLlm()`이 공통 adapter를 쓰면 legacy/v2는 같은 모델을 공유한다.

### 운영 writer에서도 선택 가능하게 하는 추가 범위

- `apps/admin-next/lib/types.ts`: `Provider` union에 `openai` 추가.
- `apps/api-nest/src/admin.controller.ts`: provider catalog/validation을 explicit registry로 전환.
- `apps/admin-next/components/SettingsClient.tsx`, `DomainClient.tsx`: 선택 UI/기본값/표시를 additive로 처리.
- 필요 시 `worker.service.ts`: fallback policy, request cost ceiling, repair attempt별 provider/model 기록.

기본값은 계속 `codex`/legacy로 두며, OpenAI는 명시 opt-in이어야 한다. DB migration은 기본 adapter에 필요 없다. fallback attempt를 영속적으로 추적하려면 post 단일 model 필드만으로는 부족하므로 새 job-result metadata 또는 별도 attempt 저장 방식을 설계해야 한다.

## 환경변수와 보안

필수: `OPENAI_API_KEY`.

선택: 기존 이미지 코드와 공유 가능한 `OPENAI_API_BASE_URL`. organization/project header를 필요로 하는 계정에서만 `OPENAI_ORG_ID`, `OPENAI_PROJECT_ID` 같은 별도 이름을 추가 검토한다. 현재 저장소에는 후자 두 설정과 text-model default/cost ceiling 설정이 없다.

- key는 `.env` 예시나 코드에 넣지 않고 deployment secret 또는 staging project secret으로 주입한다.
- prompt에는 학원 주소·전화·후기 요약이 포함될 수 있으므로 전송 범위를 data-processing 정책과 함께 검토한다.
- Responses는 기본 저장이므로 `store:false`를 넣는다.
- timeout 뒤에는 요청이 서버에서 완료될 수 있으므로, retry 전에 request ID와 idempotency/중복 post 방지 정책을 설계한다.
- 일일 비용 상한과 rate limit은 현재 구현에 없다. API dashboard project별 spend/rate limits와 application-level preflight/queue cap을 함께 사용해야 한다. OpenAI도 staging project 분리와 project별 spend/rate limits를 권장한다. [production best practices](https://developers.openai.com/api/docs/guides/production-best-practices)
