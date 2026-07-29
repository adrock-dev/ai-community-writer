# Codex CLI 4-Pair 사람 블라인드 평가

평가 파일은 `data/content-generation-evaluation/codex-cli-four-pair-20260720/blind/review-pairs.md` 및 `review-pairs.jsonl`이다. 각 sample에는 후보 실제 region, 주소, retrieval source, region relation, 직선거리, 결측 상태와 글 A/B를 제공한다. mode, variant, modifier, native/neutral 결과, usage는 표시하지 않는다.

각 글을 1~5점으로 평가한다: 검색 의도 충족, 지역 관계 정확성, 후보 비교 가능성, 사실 활용, 구조적 자연스러움, 주변 후보 설명, 가독성, 결정 지원, 과장 억제, 전체 유용성. Pair 선택은 A가 더 좋음 / B가 더 좋음 / 비슷함 / 둘 다 사용하기 어려움이다. 학원정보·지역·숫자·셔틀/합격률/후기·거리·반복·광고성 오류를 별도로 표시한다.

mapping은 평가자 파일과 분리된 `data/content-generation-evaluation/codex-cli-four-pair-20260720/private/pair-mapping.json`에만 저장했다.

