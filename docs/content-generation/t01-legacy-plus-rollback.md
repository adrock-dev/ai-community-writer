# T01 Legacy Plus 롤백

Legacy Plus는 `generation_mode=t01_legacy_plus_v1`일 때만 실행된다.

- mode 생략 또는 `legacy`: 기존 Legacy 경로
- `t01_data_gated_v2`, `t01_hybrid_v1`: 퇴역된 generation mode이며 명시적으로 거부된다.
- `t01_legacy_plus_v1`: Legacy Plus 경로

따라서 롤백은 Legacy Plus mode를 요청하지 않거나 명시적으로 `legacy`를 사용하는 것으로 끝난다. DB migration·데이터 rollback·provider 변경·Codex CLI 변경은 필요 없다. 신규 환경변수도 추가하지 않았다.
