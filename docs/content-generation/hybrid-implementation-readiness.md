# Hybrid 구현 준비도

## 최종 판정

`additional_validation_required`에서 **hybrid 구현 설계는 ready**, 실제 운영 적용은 **A/B/C 사람 평가 전 보류**다. 권장 결론은 `build_hybrid_mode`이며 운영 기본값은 legacy를 유지한다.

## 확정된 사실

- legacy와 v2는 같은 base `buildPrompt()`를 공유하고, v2만 T01 contract를 뒤에 붙인다([worker.service.ts](../../apps/api-nest/src/worker.service.ts:152)).
- v2 candidate에는 academy ID, stored region, retrieval source, region relation, missing fields, selected review가 있다([t01-data-gated.ts](../../apps/api-nest/src/t01-data-gated.ts:12)).
- v2 variant는 후보 수/common fields/source에 의해 gate되고 seed는 compatible option 내에서만 쓴다([t01-data-gated.ts](../../apps/api-nest/src/t01-data-gated.ts:352)).
- current review storage에는 content/source label을 만들 수 있는 원천 데이터가 있으나 public per-review URL은 없다.
- current implementation은 review 1건/academy이지 1건/article이 아니다.
- FAQ/checklist semantic dedupe는 아직 없다.

## 최소 다음 구현 요청 범위

1. T01-only `t01_hybrid_v1` routing; legacy/v2/default는 유지.
2. article-level review selector와 source eligibility; 최대 1개, public metadata 제거.
3. hybrid narrative prompt blocks와 v2 typed candidate/variant 재사용.
4. checklist topic budget → FAQ semantic dedupe → no-valid-FAQ 시 생략.
5. review/source/count/metadata와 FAQ/checklist overlap T01 hybrid gate/tests.
6. 4 snapshot A/B/C, neutral + blind human review tooling.

예상 파일: `worker.service.ts`, `t01-data-gated.ts`, 신규 `t01-review-selection.ts`, 신규 `t01-decision-support.ts`, T01 unit tests, A/B script/docs. DB migration 없음. 비T01 영향은 mode routing을 T01/template+explicit mode로 한정하면 없음. 롤백은 hybrid mode 미지정/legacy 지정이다.

## 미확정·위험

- human score/comment artifact가 없어 legacy 선호의 원인별 정량 근거는 없다.
- source label만으로 독자 출처 표기가 충분한지 제품·법무 정책 확인이 필요하다.
- 현재 review sync는 긍정/안전 filter를 이미 적용하므로 “전체 수강생 의견”을 대표한다고 주장하면 안 된다.
- 기존 4 pair는 historical km/review-theme prompt로 생성돼, hybrid C 효과는 새 A/B/C로만 검증할 수 있다.

GPT-5.6 Terra High는 이 코드·산출물 분석과 설계 문서에는 충분했다. 다만 실제 콘텐츠 우열은 모델 등급 문제가 아니라 블라인드 사람 평가와 review source 정책 검토가 필요하다.
