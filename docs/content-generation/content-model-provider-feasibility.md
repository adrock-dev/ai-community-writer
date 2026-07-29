# 콘텐츠 생성 모델 provider 분리 가능성 검증

## 결론

**아키텍처 판정: `feasible_with_small_adapter`. 실행 준비도: `additional_validation_required`.**

Codex 작업 모델과 실제 블로그 본문 모델은 분리할 수 있다. 다만 현재 텍스트 생성은 Codex CLI와 Claude CLI만 지원하며 OpenAI 텍스트 API provider는 없다. 이 환경에는 `OPENAI_API_KEY`도 설정돼 있지 않아 `gpt-5.6-luna` 또는 `gpt-5.4-mini`의 실제 계정 접근성은 확인하지 못했다. 따라서 “현재 즉시 호출 가능”이라고 판단하지 않는다.

## 근거: 실제 호출 경로

### 관리자/worker 콘텐츠 생성

```text
관리자 UI 기본값 codex
→ AdminController.enqueueGenerate()
→ jobs.payload { provider, model, timeout_sec, generation_mode }
→ WorkerService.processGenerate()
→ runLlm(prompt, llmOpts)
→ codex exec 또는 claude CLI
```

| 구간 | 직접 근거 | 실제 동작 |
| --- | --- | --- |
| UI 기본값 | `apps/admin-next/lib/generation-defaults.ts:23-30` | provider `codex`, model 빈 문자열, 600초 |
| 관리자 provider 목록 | `apps/api-nest/src/admin.controller.ts:35-54` | `codex`, `claude`만 노출 |
| job 입력 | `apps/api-nest/src/admin.controller.ts:614-633` | provider/model을 payload에 기록, generation mode 기본은 legacy |
| 본문/repair 호출 | `apps/api-nest/src/worker.service.ts:151-193` | 최초 생성과 repair가 동일한 `llmOpts`를 사용 |
| CLI wrapper | `apps/api-nest/src/llm-runner.ts:10-24` | `codex`는 Codex CLI, 그 외 값은 Claude CLI로 처리 |

DB의 읽기 전용 집계도 이미 발행된 18개 post와 6개 generate job이 모두 `provider=codex`, model 빈 문자열임을 보였다. 따라서 Codex CLI는 A/B 전용이 아니라 현재 운영 본문 생성의 기본 경로다.

### 최근 live A/B

`apps/api-nest/src/scripts/run-live-t01-ab.ts:52-108`은 실제 후보 선택/facts/prompt를 만든 뒤 legacy와 v2 모두 `runLlm()`으로 호출한다. 기본 CLI 인자는 `--provider codex`, model 빈 문자열, 600초다. T01 v2는 prompt/facts/quality만 opt-in으로 달라지고 provider 경로는 legacy와 같다.

실행 결과는 [live-ab-execution.md](live-ab-execution.md)에 기록된 대로 Codex CLI `0.142.0`이 환경 기본 모델 `gpt-5.6-terra`를 지원하지 않아 본문 0건으로 끝났다. `parseCodex()`는 종료 코드 0의 error event를 본문으로 파싱하지 못해 결과에 `empty_output`만 남긴다(`apps/api-nest/src/llm-runner.ts:56-68`).

## 현재 OpenAI API 기반

### Evidence

- `openai` npm package는 `apps/api-nest` 최상위 의존성에 없다. `npm --prefix apps/api-nest ls openai --depth=0`도 empty다.
- `apps/api-nest/src/image-generation.service.ts:108-167`에는 OpenAI 이미지 API를 위한 raw `fetch`가 있다. `OPENAI_API_KEY`, 선택적 `OPENAI_API_BASE_URL`, `AbortController` timeout을 사용해 `/v1/images/generations`으로 요청한다.
- 텍스트용 `/v1/responses`, `/v1/chat/completions`, OpenAI client 생성, usage parser, model retry/rate-limit 처리는 저장소에 없다.
- 현재 shell 환경과 루트 `.env`에는 `OPENAI_API_KEY`, `OPENAI_API_BASE_URL`, `OPENAI_ORG_ID`, `OPENAI_PROJECT_ID`가 설정돼 있지 않다. `apps/api-nest/.env.example`에는 이미지 provider 설명을 위한 `OPENAI_API_KEY` 이름만 있다. 값은 읽거나 출력하지 않았다.
- `docker-compose.yml`은 루트 `.env`만 주입하며 Dockerfile은 콘텐츠 생성이 Codex/Claude CLI OAuth에 의존한다고 명시한다.

### Inference

Node의 내장 `fetch`와 기존 이미지 API의 보안/timeout 패턴을 재사용하면 SDK 설치 없이 OpenAI Responses provider를 구현할 수 있다. 반대로 현 상태에서 `provider: "openai"`를 보내면 `runLlm()`의 `else` 경로가 Claude CLI를 실행하므로 OpenAI API 호출이 되지 않는다. 명시적 provider 분기가 필수다.

OpenAI 공식 문서는 최신 모델이 Responses API와 Client SDK를 통해 제공된다고 설명하고, Responses에서는 생성 텍스트를 `response.output_text`로 읽는 예시를 제공한다. 또한 Responses는 기본 저장이므로 콘텐츠 요청에는 `store: false`를 명시해야 한다. [모델 카탈로그](https://developers.openai.com/api/docs/models), [Responses 마이그레이션 가이드](https://developers.openai.com/api/docs/guides/migrate-to-responses)

## 후보 모델 판정

| 후보 | API/endpoint 공식 지원 | 현재 계정 접근 | 현재 코드 호환 | 본문 기본 모델 판단 |
| --- | --- | --- | --- | --- |
| `gpt-5.6-luna` | Responses, Chat Completions, structured outputs, reasoning 지원 | **unknown** — key/계정 확인 불가 | adapter 필요 | 비용 민감 고량 생성 후보. 실제 한국어·facts 준수 품질은 A/B 전까지 unknown |
| `gpt-5.4-mini` | Responses, Chat Completions, structured outputs, reasoning 지원 | **unknown** | adapter 필요 | Luna보다 공식 단가가 25% 낮고 snapshot이 문서화되어 있어 첫 비교 후보로 적합. 품질 우위는 unknown |
| 기존 Codex | CLI만 | ChatGPT CLI 인증은 존재 | 현재 기본 | API 비용/usage 수집과 서버 안정성 관점의 본문 기본 provider로는 부적합 |
| 기존 Claude | CLI/OAuth | CLI 존재 여부는 별도 runtime 조건 | 현재 대체 경로 | API 저비용 모델로 설정된 근거 없음; `runLlm`도 usage token을 수집하지 않음 |
| OpenAI 이미지 모델 | `/v1/images/generations` | key 없음 | 이미지 전용 구현 | 텍스트 본문 모델이 아님 |

공식 모델 문서상 Luna는 비용 민감 고량 작업용이고 input/output $1/$6 per 1M tokens이며, GPT-5.4 mini는 $0.75/$4.50이다. 두 모델 모두 Responses와 structured outputs를 지원한다. [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini)

**Unknown:** API key가 연결된 OpenAI project에 Luna/mini 권한·결제·rate limit이 있는지는 repository나 현재 환경만으로 알 수 없다. ChatGPT/Codex 인증은 OpenAI API 권한의 증거가 아니다.

## 연동 전략 비교

| 전략 | 현재 구조 적합성 | 영향/위험 | 판단 |
| --- | --- | --- | --- |
| A. 기존 운영 provider 재사용 | 불가 | OpenAI 텍스트 provider가 없음 | refuted |
| B. A/B 전용 Responses provider | 빠른 평가 가능 | worker와 로직/usage/error 처리 중복, 운영 전환 시 재작업 | 단기 smoke 전용이면 가능, 기본 권장 아님 |
| C. 공통 provider adapter | `runLlm()`이 이미 공통 진입점이나 interface는 없음 | additive branch와 strict unknown-provider 오류가 필요, legacy/Codex/Claude 회귀 필요 | **권장** |
| D. Codex CLI 업그레이드 후 Luna | 기술적으로는 CLI가 모델 지원 시 가능 | API key/usage/cost/rate limit/서버 운영 제어가 여전히 약함, CLI 버전 종속 | `technically_possible_but_not_recommended` |

전략 C의 최소 형태는 별도 대규모 framework가 아니라 `LlmResult` 계약을 유지한 `OpenAIResponsesProvider` adapter다. legacy와 T01 v2는 같은 `provider/model/timeout/retry`를 넣으므로 pair 동등성도 유지할 수 있다.

## fallback과 A/B 격리

- 현재 worker는 최초 생성과 repair에 동일 `llmOpts`를 재사용한다(`worker.service.ts:157, 182-189`). 같은 모델 repair는 바로 가능하지만, repair만 다른 모델로 바꾸는 선택기와 attempt별 model 기록은 없다.
- posts 테이블은 최종 provider/model 및 집계 token/cost만 저장한다(`db.service.ts:736-739`). fallback 모델별 attempt 추적/비용 상한은 현 구조에 없다.
- 첫 패턴 A/B는 **legacy + 같은 모델** 대 **T01 v2 + 같은 모델**로 고정하고 fallback을 꺼야 한다. 그렇지 않으면 패턴 효과와 모델 효과가 섞인다.
- fallback은 향후 반복 hard failure에 한해 opt-in으로 설계할 수 있으나, attempt log와 예산 제어가 선행돼야 한다.

## 직접 질문 판정

| 질문 | 판정 |
| --- | --- |
| Codex 작업 모델과 본문 모델을 분리할 수 있는가? | **Yes, small adapter 후 가능** |
| Codex CLI 없이 글을 생성할 수 있는가? | **Yes, OpenAI Responses API adapter 후 가능** |
| 현재 프로젝트에서 Responses API를 사용할 수 있는가? | **기술적으로 가능; 현재 구현은 없음** |
| Luna/mini를 지금 호출할 수 있는가? | **Unknown; API key와 project model access가 미확인** |
| API key만 추가하면 되는가? | **No. key 외에도 provider adapter와 error/usage 처리 필요** |
| SDK upgrade가 필요한가? | **No, raw fetch 선택 시 불필요. SDK 선택 시 package 추가 필요** |
| DB migration이 필요한가? | **No, 기본 adapter/A-B에는 불필요** |
| 비T01 영향 없이 T01 A/B로 제한 가능한가? | **Yes. CLI evaluator에서 explicit provider를 쓰고 legacy default를 유지 가능** |
| Codex CLI upgrade가 필요한가? | **분리된 OpenAI API 경로에는 불필요** |
