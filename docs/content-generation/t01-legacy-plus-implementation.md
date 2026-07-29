# T01 Legacy Plus 구현

## 추가된 경로

- 모드 상수·adapter·후처리·gate: `apps/api-nest/src/t01-legacy-plus.ts`
- T01 worker routing 및 기존 Legacy scaffold 재사용: `apps/api-nest/src/worker.service.ts`
- 관리자 요청의 명시 모드 검증: `apps/api-nest/src/admin.controller.ts`
- 고정 snapshot 읽기 전용 smoke: `apps/api-nest/src/scripts/run-legacy-plus-smoke.ts`

Routing은 다음과 같다.

`legacy` 또는 생략 → 기존 Legacy  
`t01_legacy_plus_v1` → Legacy Plus

`t01_data_gated_v2`와 `t01_hybrid_v1`은 현재 retired mode로 명시적으로 거부한다. 알 수 없는 모드도 Legacy로 fallback하지 않는다.

Legacy Plus는 T01에만 허용되며, 비T01 요청은 명시적으로 거부한다. 알 수 없는 모드는 Legacy로 fallback하지 않는다.

## 조립 방식

1. 기존 worker가 후보와 Legacy facts를 만든다.
2. 같은 고정 후보 배열에서 T01 typed context와 학원별 적격 review를 만든다.
3. `legacyPlusFactsForPrompt()`이 후보별 review/theme 재료만 제거한다.
4. 기존 `buildPrompt()`에 review·FAQ의 짧은 override만 전달한다.
5. T01 전용 짧은 계약을 덧붙인다.
6. 생성 뒤 FAQ/checklist dedupe와 빈 FAQ 제거를 적용한다.
7. Legacy Plus 전용 사실·review·decision-support gate를 적용한다.

학원별 review는 최대 1건이며, 독자용 인용은 100자 이상일 때 99자와 말줄임표(`…`)로 제한한다. 이 정책은 Legacy Plus에만 적용되고 Hybrid의 글 전체 1건 정책은 변경하지 않는다.

Legacy의 structure guide, modifier 선택, narrative scaffold를 대체하지 않는다.

## DB와 호환성

DB migration은 없다. 원천 `academies.review_json`은 읽기만 한다. 기본 provider와 기본 generation mode는 변경하지 않았다.

## 2026-07-21: 비교축 재정렬

후보를 고르는 지역 기반 조회와 실제 소재지 검증은 그대로 유지한다. 다만 Legacy Plus 본문은 주소·인근 여부를 비교의 주제로 삼지 않는다.

- DrivingPlus 원천 `seo_description`에 **실제로 명시된** 면허 과정만 `1종 보통`, `2종 보통`, `1종 대형` 등 정규화된 내부 사실로 사용한다. 학원명·주소·SEO 키워드에서는 과정을 추론하지 않는다.
- 모든 후보에 과정 정보가 있으면 `면허 과정`을 표 또는 실제 차이가 있는 학원 설명에 활용한다. 도입과 모든 학원별 첫 설명을 과정 문장으로 고정하지 않는다.
- 과정이 불완전하지만 학원 유형 차이가 있으면 `운영 형태`를 보조 비교 재료로 쓴다.
- 둘 다 희소하면 위치 비교로 전환하거나 후보 설명을 억지로 늘리지 않고, 짧은 객관 정보와 공통 확인 순서만 쓴다.
- Legacy의 서술 흐름을 유지한다. 도입은 독자의 지역·면허 준비 고민으로 열고, 학원별로 한두 문장의 자연스러운 소개 뒤에 주소·전화·과정·유형 같은 확인된 기본 정보를 불릿으로 정리한다.
- 주소와 전화는 학원별 기본 정보 불릿에 남기며, 실제 소재지가 다른 학원은 해당 학원 소개·표에서 실제 지역만 짧게 밝힌다. 거리·이동시간·접근성 판단은 만들지 않는다.
- `BEST` 제목은 기존 SEO title rule을 그대로 유지한다. 이 제목으로 객관적 순위 근거를 새로 만들지는 않는다.

Legacy Plus 전용 academy principle과 template direction이 공통 T01의 주소 우선·인근 후보군 지시를 대체한다. 기존 Legacy와 비T01에는 적용되지 않는다.
