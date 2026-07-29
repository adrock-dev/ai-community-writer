# 콘텐츠 모델 provider 분리: 다음 구현 요청의 조건

## 최종 권고

**전략 C: 공통 `runLlm` 계약 아래 OpenAI Responses adapter를 additive로 추가**하는 것이 가장 안전하다. A/B 전용 provider를 별도로 만드는 전략 B는 단기적으로 가능하지만 worker와 평가기의 parser, usage, timeout, error 규칙이 갈라진다. Codex CLI 업그레이드 전략 D는 호환성 오류를 줄일 수 있어도 서버 본문 생성의 API 비용·usage·quota 통제를 해결하지 못한다.

이 권고는 구현 승인이나 현재 API 접근 가능성을 뜻하지 않는다. 현재 상태는 `OPENAI_API_KEY` 부재와 model access 미확인으로 **`additional_validation_required`**다.

## 권장 실행 순서

1. **credential/access gate** — staging OpenAI project에만 `OPENAI_API_KEY`를 주입하고, 모델당 1회 50-token `store:false` smoke test를 수행한다. 학원 데이터와 운영 prompt는 사용하지 않는다.
2. **provider adapter** — raw `fetch` 기반 `OpenAIResponsesProvider`를 추가하고 `LlmResult`로 output/usage/error를 정규화한다. SDK 추가는 선택이지 선행조건이 아니다.
3. **strict routing** — `codex`, `claude`, `openai`를 명시 분기하고 알 수 없는 provider를 오류로 처리한다. 현재처럼 OpenAI가 Claude fallback으로 떨어지는 동작을 제거한다.
4. **adapter tests** — Authorization 비노출, `store:false`, timeout abort, `output_text`, usage, 401/403/404/429/5xx, no retry/limited retry를 mock fetch로 검증한다.
5. **한 snapshot smoke** — `gpt-5.6-luna`로 legacy 1회/v2 1회를 같은 candidate snapshot·slot seed·timeout·max output·repair 0회로 생성한다.
6. **8개 지역 A/B** — 위 조건을 유지하고 blind mapping, auto facts/region 검사, usage/cost/quality logs를 저장한다.
7. **사람 블라인드 평가** — 모델/variant/quality 점수를 숨긴 채 평가한다. 이 전에는 v2 우월 결론을 내리지 않는다.
8. **별도 모델 실험** — T01 v2 + Luna 대 T01 v2 + GPT-5.4 mini를 별도 실험으로 수행한다. 패턴 비교와 모델 비교를 섞지 않는다.
9. **운영 전환 판단** — 기본 provider와 generation mode는 이 평가가 끝날 때까지 바꾸지 않는다.

## 구현 범위 예상

| 영역 | 예상 파일 | 변경 성격 |
| --- | --- | --- |
| Responses HTTP adapter | `apps/api-nest/src/openai-responses-provider.ts` (신규) | API request/response/usage/error/timeout |
| 공통 routing | `apps/api-nest/src/llm-runner.ts` | additive `openai` branch, unknown provider error |
| A/B 호출 | `apps/api-nest/src/scripts/run-live-t01-ab.ts` | explicit API provider/model과 usage log |
| unit/integration tests | `apps/api-nest/test/llm-runner*.test.ts` 등 신규 | mocked Responses contract·legacy/v2 parity |
| 관리자 선택 UI (운영 enable 시에만) | `admin.controller.ts`, `admin-next/lib/types.ts`, `SettingsClient.tsx`, `DomainClient.tsx` | provider option 추가, 기본값은 그대로 |
| fallback/attempt telemetry (후속) | `worker.service.ts` 및 job-result 설계 | 별도 범위; 첫 A/B에서 제외 |

DB migration은 기본 adapter나 T01 A/B에 필요 없다. 비T01에는 provider 기본값을 바꾸지 않으면 출력 변화가 없다. 다만 `llm-runner.ts`는 admin의 축 제안/검증도 공유하므로 Codex/Claude 기존 경로 회귀 테스트가 필요하다.

## 고정해야 할 A/B 계약

- `provider=openai`, 같은 **exact model ID**, 같은 reasoning effort, timeout, max output tokens, retry=0, repair=0
- 같은 candidate snapshot ID/academy ID/순서, 같은 slot seed, 같은 prompt version
- legacy는 legacy facts/variant/modifier, v2는 v2 facts/variant/modifier만 달라짐
- `store:false`, streaming off, 외부 학원 정보/웹 도구 off
- 원본 prompt, output, Responses usage, HTTP category, quality result, duration, local cost formula version을 저장
- 실패 pair는 model/provider/timeout/candidate mismatch 이유를 기록하고 비교 대상에서 제외

## 운영 위험의 최소 통제

- API key는 deployment secret에서만 읽고 로그/DB/prompt artifact에 넣지 않는다.
- API project를 staging/production으로 분리하고 project별 spend/rate limit을 둔다.
- API 오류(401, 403, model unavailable, 429, timeout)를 빈 본문으로 뭉개지 않고 provider error code로 보존한다.
- timeout 후 retry는 중복 과금 위험이 있으므로 request ID/idempotency 정책 없이 자동 재시도하지 않는다.
- Luna alias는 공식 문서에 dated snapshot이 보이지 않으므로 재현성 위험을 기록한다. GPT-5.4 mini는 현재 `gpt-5.4-mini-2026-03-17` snapshot이 문서화돼 있어, 모델 비교 실험에는 exact snapshot 확인을 우선한다. [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini)

## Codex 역할

Codex + GPT-5.6 Terra High는 코드 조사, provider adapter 구현, tests, fixture/평가 도구 개발에는 충분하다. 실제 블로그 본문 대량 생성의 provider로 Codex CLI를 유지할 필요는 없다. 콘텐츠 품질의 최종 판단은 Terra High의 코드 작성 능력이 아니라, 같은 API 모델로 생성한 blind human evaluation과 facts/quality gate 결과에 근거해야 한다.
