# Codex CLI live A/B 준비도

기준일: 2026-07-20

판정: `ready_for_human_review`

충족:

* ChatGPT-authenticated Codex CLI `0.144.6`을 Node child process가 실제 사용
* Luna·GPT-5.4 mini smoke 모두 accessible
* Codex final-message parser와 error/usage parser 검증
* legacy/v2 각각 한 번 생성 성공
* canonical pair integrity 통과
* readonly DB 및 content-generation isolation 사용
* 운영 provider 기본값 `codex`, generation mode 기본값 `legacy` 유지

추가 B/C/E pair 3개와 기존 익산 pair의 4-pair 검증을 완료했다. 추가 3 pair에서는 candidate·순서·slot seed·model·timeout 무결성이 모두 통과했고 `turn.completed.usage` parser도 정상 보존됐다.

v2 native `unverified_shuttle_claim`과 `unverified_pass_rate_claim`의 8개 false positive는 claim-context detector로 수정한 뒤 저장된 4개 출력에 읽기 전용 재평가했다. v2 native hard는 `21 → 13`, legacy native는 `13`으로 유지됐고, 새 hard failure는 없었다. Neutral hard는 계속 `0/0`이다. 세 v2 글에는 근거 없는 셔틀 가능성 암시 warning이 남아 사람 평가에서 검토해야 한다.

전체 8개 지역 A/B는 아직 실행하지 않는다. 다음 단계는 이미 생성된 4-pair 블라인드 자료의 사람 평가다. 사람 평가 전에는 `ready_for_cli_live_ab` 또는 운영 기본값 변경을 판정하지 않는다. provider 기본값 Codex와 generation mode 기본값 legacy는 유지됐다.
