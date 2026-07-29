# Codex CLI 콘텐츠 생성 검증

기준일: 2026-07-20

## 실제 실행 경로

```text
WorkerService / run-live-t01-ab.ts
→ runLlm(prompt, { provider: "codex", model, timeoutSec })
→ spawn("codex", ...)
→ /Users/leemj/.local/bin/codex
→ /Users/leemj/.nvm/versions/node/v24.16.0/lib/node_modules/@openai/codex/bin/codex.js
```

`llm-runner.ts`에는 별도 binary 경로나 `CODEX_HOME` 설정이 없다. Node child process는 PATH의 `/Users/leemj/.local/bin/codex`를 해석한다. `CODEX_HOME` 환경변수는 설정되어 있지 않았고 CLI는 기본 홈 설정을 사용했다. 인증 token, cookie, auth file 내용은 읽지 않았다.

## CLI update

| 시점 | Node가 해석한 shim | 실제 target | 버전 |
| --- | --- | --- | --- |
| 시작 | `/Users/leemj/.local/bin/codex` | Codex standalone `0.142.0` | `0.142.0` |
| `codex update` 후 | 같은 shim | npm global Codex | `0.144.6` |

`codex update`는 `npm install -g @openai/codex`를 실행해 npm 설치본을 `0.144.6`으로 갱신했지만 PATH shim은 자동으로 바뀌지 않았다. 업데이트된 binary에서 Luna smoke가 성공한 뒤, 기존 user-level shim을 npm 설치본으로 다시 연결했다. 그 결과 shell과 Node child process 모두 같은 `0.144.6`을 사용한다.

`codex login status`는 업데이트 전후 모두 `Logged in using ChatGPT`를 반환했다. 이는 ChatGPT account authentication 확인이며 API key 인증이나 API 비용의 증거로 해석하지 않는다.

## 범위

이 검증은 `provider=codex`만 사용했다. `openai_responses`, `OPENAI_API_KEY`, Claude, DB write, 운영 글 저장, 전체 8개 지역 A/B는 사용하지 않았다.
