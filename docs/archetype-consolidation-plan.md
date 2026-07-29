# 아키타입 통합 + writing_guide 재편 설계안 (2026-07-13)

> (b) 과제. 14 아키타입 → ~5종 통합 + writing_guide↔region 연성결합 해소.
> **고위험**(writing_guide=생성 품질 바닥). 이 문서는 착수 전 설계안이며, 사용자 확인 후 구현.

---

## 1. 전수 감사 — 현재 14 아키타입

`article_type`(패턴 선택용)과 `writing_guide`(프롬프트 주입) 기준 전수:

| kind (id) | 글유형 | primary | keyword_rule | academy_centric | article_type | writing_guide 요지 |
|---|---|---|---|---|---|---|
| `local_best` | T01 지역 학원 BEST | region | region_plus_pick(학원) | ✅ | local_best_comparison | 지역 BEST 비교, 생활권·동선·사진·비교표 |
| `general_guide` | T03 가이드 총정리 | keyword | plain | ❌ | general_best | 전체 흐름 총정리, 단계/확인/놓치기쉬운점 표 |
| `license_compare` | T04 종류 비교 | keyword | pick(1종\|2종…) | ❌ | cost_comparison | 종류 선택 비교, 추천대상/주의점 표 |
| `cost_strategy` | T05 비용 절약 | keyword | pick(비용\|가격…) | ❌ | cost_comparison | 총액/추가비/재시험/셔틀, 상담 질문 |
| `exam_best` | T06 시험단계 집중 | keyword | pick(필기\|기능\|도로주행…) | ❌ | exam_best | 시험 단계 하나 집중, 틀리는 포인트/체크리스트 |
| `regional_hub` | T07 지역 허브 | region | region_plus_pick | ❌ | local_access | 지역 허브, 시험장/접수/비용 넓게 연결·내부링크 |
| `written_registration` | T08 필기 접수 | keyword | pick(필기.*접수) | ❌ | exam_best | 필기 접수 절차형, 준비물/수수료/사진 |
| `written_tips` | T09 필기 팁 | keyword | pick(필기.*팁\|문제…) | ❌ | exam_best | 필기 공부순서/앱/당일 체크 경험형 |
| `written_app` | T10 필기 앱 | keyword | pick(필기.*앱) | ❌ | exam_best | 앱 꾸며내지 말고 선택 기준·기능 체크 |
| `test_center` | T11 지역 시험장 | region | region_plus_fixed(시험장) | ✅ | exam_best | 지역 시험장 위치/동선, "학원 글과 구분" |
| `license_complete` | T12 취득 총정리 | keyword | pick(취득\|총정리\|준비물) | ❌ | general_best | 교육→필기→기능→도로주행→발급 큰 그림 |
| `persona_target` | T13 타겟별 준비 | keyword | plain | ❌ | general_best | 페르소나 시간표/예산/이동수단 기준 |
| `academy_profile` | T14 전문학원 단독 | region | region_plus_pick | ✅ | local_access | 1곳 중심 사진/과정/위치/상담 질문 깊게 |
| `local_exam_mix` | T15 지역+시험단계 | region | region_plus_pick | ❌ | local_access | 지역 후보 + 필기/기능/도로주행 팁 연결 |

## 2. 감사에서 드러난 핵심 사실 (통합의 전제)

리팩터 범위를 정하는, 코드로 검증된 3가지:

1. **`article_type` 필드는 죽었다(dead).** 아키타입의 `article_type`을 읽는 곳은 **어디에도 없다**. 패턴 선택은 `worker.articleTypeForSlot(slot)`이 **template_id 정규식 + 슬롯 텍스트로 독립 재유도**한다(`archetype.article_type` 미참조). → 통합에서 이 필드는 제약이 아니며 **삭제 가능**.

2. **`keyword_rule`은 이제 폴백 전용(사실상 빌트인엔 dead).** `buildTopicUnits`은 `keyword_filter`가 있으면 free 모드로 그 키워드를 **권위**로 쓰고 `keyword_rule`을 **완전히 건너뛴다**(region join도 `${region} ${kw}` 직접). 빌트인 14종 전부 `keyword_filter`를 가지므로(305b33d), 현재 골든 406은 **전원 free 모드** = `keyword_rule` 무관. `keyword_rule`은 오직 *keyword_filter 없는 커스텀 글유형*의 폴백 슬롯 생성에만 관여. → **통합해도 골든 0-diff**(free 모드가 미참조).

3. **아키타입의 실제 값어치 = `writing_guide` + `academy_centric` + `primary`(기본값).** 나머지(`keyword_rule` 폴백 잔재, `article_type` dead)는 통합을 제약하지 않는다.

품질 게이트(worker `articleQualityIssues`/`postSurfaceQualityIssues`, `scripts/qa-posts.mjs`), 골든 러너, DB 스키마는 **`kind`/`archetype`/`article_type`을 참조하지 않는다** → 통합 파장은 archetypes.ts + constants.ts(kind 값) + 프롬프트 주입부에 국한.

## 3. writing_guide ↔ region 연성결합 해소 (핵심 설계)

**문제**: `local_best` writing_guide는 "지역 안 학원 비교"를 전제 → 지역 없는 글유형에 이 아키타입을 쓰면 지침이 헛돈다. 이 결합 때문에 `primary_override` 완전 자유가 막혀 있음.

**해법: writing_guide를 "지역 중립 core + region overlay"로 구조화.**

```ts
// as-is
writing_guide: string[];

// to-be
writing_guide: {
  core: string[];             // 작성 방식(지역 중립) — 항상 주입
  region_overlay?: string[];  // 이 조합이 region-primary 일 때만 추가 주입
};
```

`writingGuideForArchetype(archetype, isRegionPrimary)`가 `core + (isRegionPrimary ? region_overlay : [])`를 합성. 워커는 이미 슬롯이 지역형이면 `slot.region`이 채워지므로 `isRegionPrimary = Boolean(slot.region)`로 전달(추가 상태 불필요).

**효과**:
- `compare` 아키타입을 T04(키워드·지역 없음)에 쓰면 core만 → 헛도는 지역 지침 없음.
- 같은 아키타입을 T01(지역)에 쓰면 overlay가 "생활권·동선·후보 사진·비교표"를 추가.
- 재편 후 **`primary_override` 완전 자유 개방 가능**(roadmap 목표 달성) — 지역 on/off가 guide를 깨지 않음.

## 4. 통합안 — 14 → 5 (권장, Option A)

작성 방식 기준 5 클러스터. **글유형 id(T01…T15)와 default_direction은 그대로 유지**, `kind`만 5종으로 재지정.

### A1. `local` — 지역 시설 비교·소개 (region, academy-lead)
흡수: `local_best`(T01), `academy_profile`(T14), `test_center`(T11)
- **academy_centric: true**
- core: 후보 시설을 사진·요약표로 소개, 확인된 자료만 단정, 과장/없는 셔틀·합격률 금지.
- region_overlay: 지역 생활권·출퇴근/통학 동선, 후보별 `### 후보명` 카드, 비교표.
- 시설 구분(학원 vs 시험장 vs 단독 1곳)은 **spec.default_direction + academy_types**가 특화(T11=license_test_course, T14=단독 소개 방향성). 아키타입 guide는 시설 중립.

### A2. `local_hub` — 지역 종합·혼합 (region, academy-support)
흡수: `regional_hub`(T07), `local_exam_mix`(T15)
- **academy_centric: false** (학원 facts는 academy_types로 보조만)
- core: 넓게 연결하는 허브형, 관련 글 내부링크로 다음 글 유도.
- region_overlay: 지역 후보·시험장·생활권을 축으로 시험 준비/절차를 엮음.

### A3. `guide` — 종합 가이드·총정리 (keyword)
흡수: `general_guide`(T03), `license_complete`(T12), `persona_target`(T13)
- academy_centric: false
- core: 준비→비용→시험 단계→선택 기준을 총정리, "단계/확인할 것/놓치기 쉬운 점" 표, 페르소나 있으면 대상별 기준 조정.

### A4. `compare` — 선택지·비용 비교 (keyword)
흡수: `license_compare`(T04), `cost_strategy`(T05)
- academy_centric: false
- core: 선택지(종류/옵션/비용안)를 비교표로, 추천 대상·주의점, 확정 금액은 자료 있을 때만·없으면 상담 질문, 과장 합격 보장 금지.

### A5. `exam` — 시험 단계 공략 (keyword)
흡수: `exam_best`(T06), `written_registration`(T08), `written_tips`(T09), `written_app`(T10)
- academy_centric: false
- core: 하나의 시험 단계 집중, 자주 틀리는 포인트·연습 순서·체크리스트를 앞쪽에, 공식정보는 "최신 확인" 보수 처리, 앱/도구는 꾸며내지 말고 선택 기준 중심.
- 접수/팁/앱 등 세부는 spec.default_direction + keyword_filter가 특화(패턴 준중복이 keyword_filter로 이미 대체됨).

**새 primary/keyword_rule(폴백 전용, 골든 무관)**:
- local, local_hub → `primary: region`, keyword_rule `region_plus_pick(/운전면허학원|자동차학원/)`.
- guide, compare, exam → `primary: keyword`, keyword_rule `plain`.

## 5. 대안 — 4종 (Option B, 더 공격적)

`academy_centric`을 아키타입 상수 → **spec 데이터**로 이관(academy_types처럼)하면 A1+A2가 단일 `local`로 합쳐져 **4종**. "데이터화" 철학엔 더 부합하나, worker 이미지 전략·slot BEST 경고가 academy_centric을 읽으므로 **파장이 커짐**(spec 필드 추가+마이그레이션+UI). 권장은 A(5종): academy_centric을 아키타입에 남겨 blast radius 최소화.

## 6. 하위호환 — 커스텀 글유형 kind 별칭

DB `custom_templates.kind`에 **옛 kind(local_best 등)를 참조하는 기존 행**이 있을 수 있음. `getArchetype`이 미상 kind면 undefined→ writing_guide general 폴백·primary keyword·academy false로 **조용한 품질 회귀**. 방지책:

```ts
const KIND_ALIASES: Record<string, string> = {
  local_best: "local", academy_profile: "local", test_center: "local",
  regional_hub: "local_hub", local_exam_mix: "local_hub",
  general_guide: "guide", license_complete: "guide", persona_target: "guide",
  license_compare: "compare", cost_strategy: "compare",
  exam_best: "exam", written_registration: "exam", written_tips: "exam", written_app: "exam",
};
// getArchetype: ARCHETYPES[id] ?? ARCHETYPES[KIND_ALIASES[id]]
```
무마이그레이션·안전. 컨트롤러 `getArchetype(kind)` 검증도 별칭 통과.

## 7. 파장 지점 (touch-points)

- `archetypes.ts`: ARCHETYPES 5종 재작성, writing_guide 구조 변경, `writingGuideForArchetype(arch, isRegionPrimary)` 시그니처, `article_type` 필드 제거, KIND_ALIASES + getArchetype 별칭 resolve.
- `constants.ts`: TEMPLATE_SPECS 14종의 `kind`를 5종으로 재지정(id/direction/keyword_filter/academy_types/axis_values는 불변).
- `worker.service.ts`: buildPrompt/buildRepairPrompt의 `writingGuideForArchetype(archetype)` → `(archetype, Boolean(slot.region))`.
- `admin.controller.ts`: `buildAxisSuggestPrompt`가 `archetype.writing_guide`(배열)를 씀 → core(+overlay) 평탄화 어댑터 필요.
- `DomainClient.tsx`(⚠️ 사용자 병렬 작업): kindOptions가 5종으로 축소(의도된 UX). **파일 지정 커밋**, 사용자 먼저 커밋 후 진행.
- `docs/archetype-audit.md`(있으면) 갱신.
- **불변**: quality-gate, qa-posts.mjs, golden-runner, DB 스키마, article_type 유도 로직.

## 8. 검증 계획

- **골든 0-diff 필수**: 빌트인 전원 keyword_filter free 모드 → keyword_rule/kind 통합이 슬롯 산출에 무영향이어야 함(§2-2 근거). `npm run test:golden` 406 유지. diff 나면 통합 오류.
- `verify:company-clean && typecheck && qa:posts`.
- **생성 스모크**(품질 바닥이 바뀌므로 필수): 각 클러스터 대표 1글씩 실제 codex 생성 → writing_guide 변화가 글 품질을 해치지 않는지 육안 검수. 특히 region_overlay on/off(T01 vs T04) 대비.
- SlotService 종단검증: 별칭 resolve, region-primary overlay 주입 분기.
- UI :4300 수동(커스텀 글유형 kind 드롭다운 5종, 기존 커스텀행 primary 표시).

## 9. 리스크

- **높음**: writing_guide가 생성 품질을 좌우. core/overlay 분해 시 기존 지침의 뉘앙스 유실 가능 → 각 클러스터 core를 흡수 대상 3~4개 guide의 **합집합**으로 신중히 작성, 스모크 검수 필수.
- keyword_rule 통합이 골든에 안 나온다는 전제는 free 모드 한정 — keyword_filter 없는 커스텀 글유형은 폴백 품질이 바뀔 수 있음(문서로 안내).
- DomainClient 병렬 충돌 — 파일 지정 커밋 규칙 준수.
