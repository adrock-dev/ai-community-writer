# T01 Legacy / v2 A/B dry-run 결과

LLM 또는 운영 DB를 호출하지 않은 deterministic A/B다. 동일 fixture와 같은 slot seed를 사용했다.

| 항목 | A: legacy | B: T01 v2 | 결과 |
|---|---|---|---|
| 최종 candidate ID·순서 | 기존 picker + seed | 동일 picker + seed | parity test 통과 |
| facts | 평면 문자열 | 동일 flat facts + typed JSON | 후보 사실 원본 추가 없음 |
| structure | 6개 seed variant | data-gated compatible composition, 동률만 seed | v2 test 통과 |
| modifier | 문자열 한 줄 | 조건부 typed adapter | 비활성 modifier 제거 test 통과 |
| provenance | facts에서 손실 | source/region/relation/distance 유지 | test 통과 |
| quality | 기존 string issues | 기존 + v2 severity issue | false-claim/거리/표 mismatch test 통과 |

prompt 길이와 실제 LLM 출력 길이·문체·결정 지원 품질은 API 호출 없이 측정하지 않았다. 운영 적용 전에는 같은 실제 slot을 legacy/v2 mode로 별도 실행해 사람 평가와 content review를 해야 한다.
