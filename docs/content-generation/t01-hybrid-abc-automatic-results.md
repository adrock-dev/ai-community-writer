# T01 Hybrid A/B/C Automatic Results

자동 결과는 사람 평가 이전에 콘텐츠 우승자를 정하지 않는다.

## 실행 범위

- 완료: 익산시 `B_supplement` clean triple 1개
- 미실행: 동해시, 고성군, 원주시
- 결과 경로: `data/content-generation-evaluation/t01-hybrid-abc-clean-20260720-1710/`

## 익산시 결과

| Mode | 생성 | native hard | native warning | neutral hard | review | FAQ/checklist |
| --- | --- | ---: | ---: | ---: | --- | --- |
| Legacy | 성공 | 1 (`too_long_7137`) | 0 | 1* | 해당 없음 | 기록만 |
| v2 | 성공 | 1 (`too_long_6244`) | 1 | 0 | 해당 없음 | 기록만 |
| Hybrid | 성공 | 1 (`hybrid_empty_checklist`) | 0 | 1* | 1건, source 정상 | 의미 중복 없음, parser false positive |

`*` neutral evaluator의 셔틀 hard는 “운행 여부/탑승 장소를 확인”이라는 확인 목록을 긍정 셔틀 주장으로 해석한 결과다. neutral rule의 한계로 기록하며 실제 사실 오류로 확정하지 않는다.

모든 mode의 제목은 정상이고 object serialization 흔적, 빈 section, 내부 typed field 노출은 발견되지 않았다. Hybrid review contract는 준수됐지만 native Hybrid hard failure가 남아 clean gate는 실패다.
