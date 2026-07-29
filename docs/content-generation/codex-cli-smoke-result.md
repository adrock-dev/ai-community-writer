# Codex CLI smoke 실행 기록

기준일: 2026-07-20

## 공통 조건

* binary: `/Users/leemj/.local/bin/codex` (최종 `0.144.6`)
* authentication: ChatGPT
* sandbox: `read-only`
* session: `--ephemeral`
* working root: 별도 임시 디렉터리
* prompts: 학원/사용자/운영 데이터를 포함하지 않은 한국어 한 문장
* API key, Responses API, tools, web search, repair, fallback: 미사용

## 결과

초기 Luna probe는 old CLI `0.142.0`에서 CLI version incompatibility error로 끝났다. CLI 자체 update와 Node PATH shim 재연결 후 Luna와 mini 모두 `turn.completed` final message 및 usage event를 반환했다.

`llm-runner.ts`는 이 검증 중 Codex JSONL의 `turn.completed.usage`를 additive하게 보존하도록 보완됐다. `input_tokens`, `cached_input_tokens`, `output_tokens`, `reasoning_output_tokens`를 result metadata로 보존하며, 비용은 계산하지 않는다. 종료 코드가 0인데 error event만 있는 경우도 `parseCodex()`가 원인 메시지를 result error로 보존한다.

mock 테스트는 final message, usage, unsupported-model error parsing을 포함해 통과했다. 실제 initial Luna failure의 exit code는 별도 shell record에 보존되지 않아 문서화하지 않는다; 원인 event와 HTTP 400 메시지는 확인됐다.
