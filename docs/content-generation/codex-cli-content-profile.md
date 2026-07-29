# Codex content-generation 실행 프로필

기준일: 2026-07-20

기본 Codex 경로는 변경하지 않았다. `runLlm()`에 `executionProfile: "content_generation"`을 명시한 호출만 다음을 추가한다.

* OS temporary directory를 생성하고 child process cwd와 Codex `-C` root로 사용
* `--ephemeral`
* `--ignore-rules`
* 기존 `--sandbox read-only`, `--skip-git-repo-check`, `approval_policy="never"` 유지
* 호출 완료 후 해당 temporary directory 제거

`apps/api-nest/src/scripts/run-live-t01-ab.ts`는 `--execution-profile content_generation`을 명시할 때만 이 profile을 전달한다. provider 생략, 일반 worker, Codex 개발 작업, Claude, OpenAI Responses, 비T01 흐름에는 영향을 주지 않는다.

이 프로필은 Codex를 프로젝트 root가 아닌 빈 임시 root에서 실행하고 세션 파일을 남기지 않도록 한다. evaluator 자체가 저장하는 prompt·raw output·quality artifact는 명시한 `data/content-generation-evaluation/` 경로에만 남는다.
