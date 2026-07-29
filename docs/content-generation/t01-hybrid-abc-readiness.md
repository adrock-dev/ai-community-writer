# T01 Hybrid A/B/C 준비도

판정: `blocked_output_contract`.

완료:

- T01-only opt-in routing 및 rollback 경로
- typed candidate/provenance/variant 재사용
- article-level review 1개와 source policy
- FAQ/checklist deterministic dedupe와 hybrid gate
- `--include-hybrid` 평가 runner의 A/B/C 블라인드 출력 및 별도 `triple-mapping.json`
- legacy/v2/비T01 회귀 포함 178 tests, typecheck, build
- 과거 고정 익산시 B_supplement triple의 실제 Codex generation 및 read-only hybrid re-evaluation
- 최신 runner로 새 결과 경로의 익산시 clean triple 생성과 clean title 검증

전체 A/B/C 전 남은 조건:

1. Hybrid checklist 출력 marker(`✅`)와 native gate의 list parser 계약 불일치를 별도 변경 요청에서 해결하거나, 허용되는 출력 계약을 명확히 한다. 현재 gate는 `-`, `*`, 숫자 목록만 인정한다.
2. 수정 후 새 output root에서 익산시 clean triple을 다시 생성하고 Hybrid hard failure가 없는지 확인한다.
3. 그 gate가 통과할 때만 review가 있는/없는 4개 snapshot A/B/C와 blind triple을 생성한다.
4. 사람 평가 전까지 generation mode 기본값은 legacy로 유지한다.

DB migration과 비T01 변경은 필요 없다.
