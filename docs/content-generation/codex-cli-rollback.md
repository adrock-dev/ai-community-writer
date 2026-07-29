# Codex CLI 콘텐츠 생성 롤백

기준일: 2026-07-20

## 애플리케이션 롤백

`executionProfile`은 opt-in이다. 이를 전달하지 않으면 기존 Codex command, project cwd, provider routing을 그대로 사용한다. `provider=codex` 또는 provider 생략은 계속 Codex 경로이며, Responses provider와 무관하다. DB migration/rollback은 없다.

content-generation profile을 되돌리려면 evaluator에서 `--execution-profile content_generation`을 생략하면 된다. 운영 기본 provider, model, generation mode, T01 prompt, variant, modifier, quality gate, 비T01은 변경하지 않았다.

## CLI update 롤백

현재 shim `/Users/leemj/.local/bin/codex`는 npm Codex `0.144.6`을 가리킨다. 이전 target은 `/Users/leemj/.codex/packages/standalone/current/bin/codex`(standalone `0.142.0`)였다. CLI 자체를 되돌릴 필요가 있을 때만 이 user-level symlink를 이전 target으로 재연결할 수 있다.

이전 standalone은 Luna를 지원하지 않았으므로, 콘텐츠 pair 실행에는 rollback을 권장하지 않는다. ChatGPT login state는 변경하지 않았다.
