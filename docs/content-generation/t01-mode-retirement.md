# T01 v2·Hybrid generation mode retirement

2026-07-21부터 운영 생성 경로는 `legacy`와 명시적 opt-in `t01_legacy_plus_v1`만 허용한다.

- `t01_data_gated_v2`와 `t01_hybrid_v1` 요청은 관리자 API와 worker에서 `retired generation_mode` 오류로 거부한다. legacy로 조용히 대체하지 않는다.
- 운영 기본 `generation_mode`는 계속 `legacy`다.
- Legacy Plus는 후보 typed facts, 사실 검증, 리뷰 선택처럼 검증된 내부 로직을 계속 사용한다. 이는 v2·Hybrid 글 생성 모드를 되살리는 것이 아니다.
- 기존 실험 문서·출력·A/B/C artifact는 재현 기록으로 보존한다. 과거 실행 스크립트는 운영 큐 경로가 아니다.

## Rollback

퇴역 전용 코드를 되돌려야 할 경우 이 변경을 되돌리면 된다. DB migration이나 데이터 rollback은 필요 없다. 다만 재도입은 Legacy Plus와 독립된 새 실험 요청으로만 검토한다.
