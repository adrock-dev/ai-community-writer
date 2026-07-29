# Prompt와 Quality Gate의 책임 분리

| 규칙 | prompt | quality gate | 이유 |
| --- | --- | --- | --- |
| 제공 candidate만 소개 | 짧은 필수 원칙 | 후보명/수/중복 hard failure | 생성 방향과 확정 검증 모두 필요 |
| 실제 소재지·인근 후보 고지 | 도입 1회 + 해당 카드/표 사실 표시 | provenance/relation hard failure | 모델이 이해해야 하나 매문장 면책은 불필요 |
| km/도로시간/접근성 단정 금지 | “거리 수치와 시간은 쓰지 않는다” | numeric/km 및 오표현 hard failure | 현재 payload가 거리 제거; gate가 방어 |
| price/shuttle/pass rate | “없으면 추측하지 않는다” | typed facts 대조/claim-context hard failure | 상세 regex/문맥은 gate 소유 |
| 실제 review 1개·출처 | 명시적 필수 | source/text/academy/count/metadata hard failure | 생성해야 하므로 prompt 필요 |
| review 광고성/길이/중복 | 한 문장만 | warning | 스타일 판단은 gate에 적합 |
| FAQ/checklist 역할 | 명시적 | semantic duplicate warning + repair | 생성 순서와 최종 텍스트 모두 필요 |
| heading density/반복 전환/질문 수 | 제거 | warning/score penalty | 내부 검수 수치를 prompt에 노출하면 기계적 |
| compatible variant | 구조 directive만 | selection은 code, rendered requirement 검사 | `compatibleVariants`/rank 등은 본문 지시에서 제거 |

prompt에서 제거할 후보: `stored_region_like`, `supplement/far_guarantee`, `straightLineDistanceKm`, raw missing field list, retrieval rank, gate rule ID/severity, 반복 횟수 수치. 이들은 payload/validator 내부에 두고, 독자 표현은 “실제 소재지”, “주변 후보”, “확인 가능한 정보”로 번역한다.
