# 콘텐츠 provider 롤백

기준일: 2026-07-20

## 즉시 롤백 경계

신규 adapter는 `provider=openai_responses`일 때만 실행된다. 기존 호출은 `provider` 생략 시 현재와 동일하게 Codex를 사용한다.

따라서 다음만으로 기존 흐름이 유지된다.

* provider를 생략하거나 `codex`로 지정
* `OPENAI_API_KEY`, `OPENAI_API_BASE_URL`을 설정하지 않음 또는 제거
* 관리자 기본값, worker payload 기본값, T01 `generation_mode` 기본값을 그대로 유지

DB migration, 데이터 rollback, prompt rollback은 필요 없다. OpenAI 관련 환경 변수가 없어도 Codex/Claude 경로에는 영향을 주지 않는다.

코드 자체를 되돌려야 하면 이 변경의 파일 단위 rollback 대상은 `llm-runner.ts`, `openai-responses-provider.ts`, smoke script, provider test다. 이전부터 존재하던 T01 v2·candidate trace 변경은 이 provider rollback 범위에 포함하지 않는다.
