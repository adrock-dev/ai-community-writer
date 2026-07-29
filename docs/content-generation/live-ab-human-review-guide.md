# T01 live A/B 사람 블라인드 평가 가이드

## 현재 상태

블라인드 평가 형식과 분리 mapping은 생성됐다. 그러나 실 모델이 `gpt-5.6-terra` 호환성 오류로 0개 본문을 반환했으므로 현 시점의 자료는 평가용이 아니다. CLI를 갱신하고 같은 snapshot으로 재생성한 뒤에만 배포한다.

## 파일 위치

- 평가자용 Markdown: `data/content-generation-evaluation/live-ab-20260720-escalated/blind/review-pairs.md`
- 평가자용 CSV: `data/content-generation-evaluation/live-ab-20260720-escalated/blind/review-pairs.csv`
- pair별 글: `data/content-generation-evaluation/live-ab-20260720-escalated/blind/pair-*-A.md`, `pair-*-B.md`
- 비공개 mapping: `data/content-generation-evaluation/live-ab-20260720-escalated/private/pair-mapping.json`

Mapping은 평가자에게 제공하지 않는다. A/B 표시는 pair마다 mapping 파일에서 분리됐고, 평가 결과를 회수한 뒤에만 해제한다.

## 평가 항목 (각 1~5점)

- 검색 의도 충족
- 지역 맥락 정확성
- 학원 간 비교 가능성
- 제공 사실 활용
- 섹션 간 논리
- 가독성
- 주변 후보 설명의 자연스러움
- 결정 지원 수준
- 과장 억제
- 자연스러운 문체
- AI·템플릿 느낌 억제
- 전체 유용성

pair 단위 선택: `A가 더 좋음`, `B가 더 좋음`, `비슷함`, `둘 다 사용하기 어려움`.

오류 체크: 잘못된 학원정보, 잘못된 지역 표현, 허위 숫자, 허위 셔틀·합격률·후기, 부자연스러운 거리 설명, 반복적 문장, 비교 기준 불균형, 과도한 광고성.

## 평가자에게 제공할 최소 사실

각 글의 target region과 후보별 학원명·stored region·주소만 제공한다. generation mode, variant, modifier, quality 결과, repair 횟수, legacy/v2 mapping은 제공하지 않는다.

## 재개 조건

1. `gpt-5.6-terra` 지원 Codex CLI로 실제 두 글이 모두 생성될 것.
2. candidate ID/순서, slot seed, 모델 및 공통 요청 설정이 pair integrity를 통과할 것.
3. 비어 있지 않은 final output과 quality/metrics가 저장될 것.
4. 그 뒤 이 파일의 항목으로 블라인드 검토를 진행할 것.
