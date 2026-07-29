# T01 Legacy Plus 준비도

## 판정

`ready_for_more_legacy_plus_smoke`

## 충족 근거

- 기존 Legacy scaffold를 재사용하고 Legacy/v2/Hybrid와 비T01을 mode로 격리했다.
- 고정 snapshot에서 후보 ID·순서·seed·model·timeout 무결성이 통과했다.
- 이전 글 전체 1건 review smoke는 완료됐으나, 현재 후보 학원별 최대 1건·100자 말줄임 정책은 단위 테스트만 완료됐다.
- FAQ/checklist semantic dedupe와 빈 section 제거를 구현·검증했다.
- 최종 smoke의 Legacy Plus native hard failure와 neutral 사실 오류가 모두 0건이다.
- 운영 기본 generation mode와 provider는 바꾸지 않았고 DB migration이 없다.

## 남은 검증 공백

- smoke는 익산시 한 표본·한 seed다. 사람 평가 또는 다표본 blind review 없이는 자연스러움·게시 선호 우위를 결론 내릴 수 없다.
- review가 없는 표본, source 없는 표본, far 후보, facts sparse 표본에서의 실생성 검증이 필요하다.
- review가 여러 후보 학원에 있는 표본에서 학원별 연결·출처·100자 절단을 실제 생성물로 검증해야 한다.
- 2026-07-21 소재지 중심 구도 완화는 unit·typecheck·build·전체 API 테스트까지만 검증했다. 새 prompt로 실제 Codex 생성물을 만들기 전에는 독자 체감과 게시 통과율을 확정할 수 없다.
- Legacy의 length gate는 이번 비교에서 실패했지만, 기존 Legacy를 변경하지 않는 범위이므로 별도 결정이 필요하다.

다음 권장 실험은 같은 snapshot/model/seed에서 Legacy와 Legacy Plus를 4개 표본으로 블라인드 비교하는 것이다. 운영 기본값은 그 평가 전후에도 Legacy로 유지한다.
