# T01 Legacy Plus 블라인드 평가 준비도

## 판정

`blocked_review_contract`

## 완료된 조건

- 신규 경로에서 4개 지역·8개 콘텐츠를 실제 Codex CLI로 생성했다.
- 모든 pair의 후보·순서·seed·모델·timeout·CLI binary/version 무결성이 통과했다.
- blind 자료와 private mapping을 분리했다.
- 운영 DB에 생성 결과를 저장하지 않았고 기본 provider는 Codex, 기본 generation mode는 Legacy로 유지했다.
- Legacy Plus의 FAQ/checklist semantic dedupe는 네 표본에서 중복 0건·빈 heading 0건으로 기록됐다.

## Blocker

1. 현재 구현은 후보 학원별 review 최대 1건인데, 이번 요청의 검증 계약은 글 전체 0~1건이다. 둘은 호환되지 않는다.
2. 동해시 Legacy Plus는 review source/quote 형식을 지키지 않아 native hard issue 3건을 냈다.
3. 익산·고성의 `review_generalized` native issue는 안전한 비일반화 문장을 오탐한 것인지 판별·수정 전 재검증이 필요하다.

따라서 생성된 blind 파일은 현재 정책을 이해한 제한적 사람 검토 자료로 사용할 수 있지만, 요청에 정의된 `ready_for_human_legacy_plus_review` 조건에는 도달하지 않았다. 사람 평가 전에는 Legacy Plus의 우열이나 운영 기본값 변경을 결론 내리지 않는다.

## 비공개 mapping

`data/content-generation-evaluation/t01-legacy-plus-blind-20260721-0940/private/pair-mapping.json`은 평가 완료 전 평가자 문서와 공유하지 않는다.
