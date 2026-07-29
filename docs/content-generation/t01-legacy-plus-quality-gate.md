# T01 Legacy Plus quality gate

Legacy Plus는 기존 `t01QualityIssues()`에 다음 전용 검사를 합친다.

## Hard failure

- 후보명·후보 수·실제 소재지 오류
- 실제 소재지가 다른 학원을 대상 지역 소재로 표현
- 직선거리의 이동시간·도로거리·접근성 단정
- 입력 없는 가격·셔틀·합격률·후기
- 비교표 facts 불일치
- 한 학원에 review 2개 이상, 선택되지 않은 review 노출, review source 누락·변조, 다른 학원 연결
- review metadata 노출 또는 review의 전체 평가·합격률 일반화
- 빈 heading, 빈 FAQ/checklist, 내부 field 언어

## Warning / score penalty

- FAQ/checklist 의미 중복
- 후보별 비교 기준 불균형
- review와 본문 반복
- 실제 소재지 고지 부족
- 상담 확인 문구·문장 전환 반복

## 2026-07-21: 소재지 중심 구도 검사

Legacy Plus에만 다음 검사를 추가했다.

- `legacy_plus_location_first_grouping` (hard failure): `인근 후보`, `지역 내 후보`, `○○시 안에서 상담할 후보`처럼 실제 지역 안팎을 H2의 주된 비교 구도로 쓰는 경우
생활권·동선·통학은 페르소나가 출발지·통학·출퇴근 같은 이동 제약을 명시했을 때 독자가 확인할 조건으로 사용할 수 있으므로, 단순 사용 횟수로는 경고하지 않는다. 다만 주소만으로 특정 학원의 통학 편의·접근성·가까움을 단정하는 사실 오류는 기존 사실 안전 규칙으로 계속 검증한다.

이 검사는 실제 소재지 고지나 페르소나 기반 이동 조건 자체를 금지하지 않는다. 대상 지역 밖 후보를 대상 지역 소재로 오인시키지 않으면서도, 소재지 분류가 글의 중심이 되는 것을 막기 위한 Legacy Plus 전용 검사다.

기존 Legacy native gate, v2 native gate, Hybrid gate, 비T01 gate는 변경하지 않는다. `faq_variant_not_rendered`는 FAQ가 선택 사항인 Legacy Plus에 적용하지 않는다.
