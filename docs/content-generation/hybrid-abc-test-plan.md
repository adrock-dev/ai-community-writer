# Legacy/V2/Hybrid A/B/C 실험 계획

## Arms와 동일 조건

| arm | 구성 |
| --- | --- |
| A | current legacy |
| B | current `t01_data_gated_v2` |
| C | proposed `t01_hybrid_v1` |

익산·동해·고성·원주의 기존 snapshot, candidate ID/순서, target region, slot seed, `provider=codex`, `model=gpt-5.6-luna`, timeout, repair off, fallback off, 운영 저장 off를 모두 고정한다. review candidate pool도 같은 source snapshot으로 고정한다. C만 article-level review selection과 semantic FAQ/checklist contract를 적용한다.

## 실행 순서

1. 같은 snapshot으로 A/B/C prompt와 selected review/FAQ topic plan을 저장한다.
2. pair integrity: 후보 ID/순서/seed/model/timeout/review pool 동일성을 검사한다.
3. 각 arm 최초 생성만 저장한다. repair/fallback을 끄고 구조 효과와 model repair 효과를 섞지 않는다.
4. neutral fact evaluator를 세 arm에 같은 typed facts로 적용하고, native gate는 arm별로 별도 보고한다.
5. 블라인드 A/B/C 순서를 지역마다 무작위화해 사람 평가한다.

## 지표

자동: 후보/지역/review/source 정확성, review count, metadata 노출, km 노출, table facts 일치, FAQ-checklist semantic overlap, facts coverage, H2/문단/표, hard/warning, 토큰·시간. 사람: 자연스러움, 지역 관계 명료성, 비교 가능성, review 자연스러움·신뢰, FAQ 추가 정보 가치, checklist 행동 가능성, AI template 느낌, 게시 가능성.

판정 원칙: native gate 수를 arm 간 승패로 합산하지 않는다. neutral fact failure는 안전성, blind 사람 평가는 자연스러움/유용성의 주 근거다. 4개 표본은 탐색적이며 운영 기본값은 legacy로 유지한다.
