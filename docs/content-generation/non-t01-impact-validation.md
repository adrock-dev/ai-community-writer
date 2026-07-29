# 비T01 영향 검증

## 공유 경로

`WorkerService.processGenerate()`는 모든 template에 공통이며 `buildFacts()`도 모든 template에서 호출한다. `local`(T01), `local_single`(T11/T14), `local_hub`(T07/T15)은 지역/학원 facts와 더 가깝고, guide/compare/exam도 prompt·modifier·quality gate를 공유한다.

이번 Phase A extraction은 `WorkerService.pickAcademiesForRegion()`이 새 `selectAcademiesForRegion()`을 호출하도록 옮긴 것뿐이다. constants, SQL 조건, 정렬, dedupe, sampling 결과를 바꾸지 않았다. 타입 검증과 기존 T01/quality/title/pattern tests가 통과했다.

## 보호 규칙

Phase B는 다음을 지킨다.

- T01이면서 `generation_mode=t01_data_gated_v2`일 때만 typed payload, data-gated variant, T01 quality checks를 사용한다.
- mode가 없거나 `legacy`면 기존 `buildFacts()`/`buildPrompt()`/quality gate 경로를 유지한다.
- T11/T14/T07/T15 및 guide/compare/exam에는 T01 candidate/source/relation/rule을 전달하지 않는다.
- 공통 `articleQualityIssues(): string[]` 계약과 slot string modifier는 유지한다.

## Phase A 실행 근거

- `structure-variant.test.ts`: local/local_single/local_hub seed variant 20 tests passed.
- `quality-gate.test.ts`: legacy issue contract 38 tests passed.
- `slot-title.test.ts`: title/slot behavior 8 tests passed.
- `article-pattern-filter.test.ts`: legacy pattern filter 13 tests passed.
- 신규 candidate fixture/readonly trace 12 tests passed.

## Phase B 재검증

`t01-mode-isolation.test.ts`가 T14 + v2 payload도 T01 v2 경로가 아니며 기존 modifier 문자열 prompt를 유지한다고 확인했다. 구현 결과는 `non-t01-regression-result.md`에 기록했다.
