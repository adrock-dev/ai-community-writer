# T01 Hybrid Quality Gate

Hybrid gate는 `t01QualityIssues()`의 후보·지역·거리·비교표 사실 검사를 재사용하고 다음을 추가한다.

- 대표 review source/count/text/academy/metadata/generalization 검사
- FAQ/checklist empty·exact duplicate·semantic overlap 검사
- v2의 `faq_variant_not_rendered`는 hybrid의 선택적 FAQ 계약과 충돌하므로 제외
- 수강료가 없는 표에서 `1종` 같은 과정 숫자를 가격으로 오인하는 v2 table regex false positive는 hybrid에서만 제외

legacy 및 `t01_data_gated_v2` native gate 동작은 바꾸지 않았다. 셔틀·합격률 claim context detector도 v2 공통 동작을 그대로 사용한다.

