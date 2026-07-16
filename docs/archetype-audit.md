# 아키타입 감사 (Phase 0) — 글유형별 하드코딩 로직 전수조사

> 목적: 글 생성 파이프라인에서 "글유형(template)/kind/design"에 따라 분기하는 하드코딩 로직을 전부 찾아, 데이터화(아키타입 통합)의 기반으로 삼는다. 작성 시점: 2026-07-09.

## 핵심 발견: "이 글이 무슨 유형인가"를 코드가 4가지 방식으로 답한다

같은 질문에 겹치지만 **일치하지 않는** 분류체계가 공존한다 — 이것이 레시피/데이터 충돌의 뿌리다.

| 분류체계 | 값 수 | 위치 | 비고 |
| --- | --- | --- | --- |
| `template_id` (T01~T15) | 15 | 여러 곳에서 ID 직접 분기 | 새 ID는 하드코딩 로직을 못 받음 |
| `kind` (local_best, written_tips…) | 14 | `TEMPLATE_SPECS`, `buildPrimaryKeyword` | ID와 별개 축 |
| `article_type` (exam_best/cost_comparison/local_best_comparison/local_access/general_best) | 5 | `articleTypeForSlot`(regex 파생) | **kind와 불일치**. 예: T09 kind=written_tips인데 article_type=exam_best |
| `design_template_id` | 6 | 디자인 가이드 함수들 | 별도 dimension(프리셋으로 반쯤 데이터화됨) |
| `primary` (region/keyword) | 2 | `slot.service` | slot.region 세팅 여부를 결정 |

**Phase 1 최우선 과제: 하나의 정본(canonical) 유형 정체성으로 통일한다.**

## 전체 인벤토리 — 생성에 영향 주는 유형별 로직

| # | 위치 | 분기 키 | 제어 대상 | 데이터화 |
| --- | --- | --- | --- | --- |
| 1 | `slot.service.ts:41` | `primary` | 주축(region/keyword) → **slot.region 세팅 여부** | enum |
| 2 | `slot.service.ts:55`, `100-107` (`chooseKeywordForTemplate`) | template_id (T01/07/14/15) | 지역+키워드 특수 포맷 | 가능 |
| 3 | `slot.service.ts:87-96` (`buildPrimaryKeyword`) | `kind` | 주키워드 정규식/포맷 | 가능: `{regex, fallback, format}` |
| 4 | `slot.service.ts`(axis 필터) | template_id | 축 부분집합(persona/intent/modifier) | 이미 데이터(PR1 `axis_tags`) |
| 5 | `worker.service.ts:106-107` | template_id (T01/14/11) | **학원 facts + 이미지 수집 여부** | flag `academy_centric` |
| 6 | `worker.service.ts:1027-1080` (`originalTemplateGuide`) | template_id (T01~15) | **⭐ 유형별 작성 지침(프롬프트 주입)** | 가능: `string[]` |
| 7 | `worker.service.ts:960-968` (`articleTypeForSlot`) | template_id + text regex | `article_type` 분류 | 가능(명시 필드로) |
| 8 | `worker.service.ts` (`originalArticlePatternGuide`) | `article_type` | 외부 패턴(`data/content_research/summaries/summary_all_article_patterns.json`) 주입, 위험 제목/헤딩은 `isRiskyArticlePattern`으로 필터 | 데이터 의존 |
| 9 | `worker.service.ts:846-864` (`designWritingGuide`) | design_id | 디자인별 작성 톤 | 가능(맵/프리셋) |
| 10 | `worker.service.ts:982-1024` (`designStructureGuide`) | design_id | 디자인별 구조 지침 | 가능(맵/프리셋) |
| 11 | `worker.service.ts:98` (`resolveGenerationDesign`) | template_id → design | 디자인 결정 | 반쯤 데이터 |
| 12 | `constants.ts` `TEMPLATE_SPECS` | 선언 | primary/kind/params/tags/direction/design | 이미 데이터 |

## 유형 분기가 아닌 곳 (건드릴 필요 없음)

- `quality-gate.ts` — `candidateCount`(학원 후보 수, **데이터**)로만 분기. 유형/디자인 하드코딩 없음. 예: `candidateCount >= 2 ? 비교표 : 요약표`.
- facts 지역 매칭 — 지역 데이터 기반(`pickAcademiesForRegion`).

## 품질에 가장 중요한 자산 (데이터화 시 반드시 보존)

1. **`originalTemplateGuide` (#6)** — 유형별 작성 지침. 프롬프트에 직접 주입되어 글 품질을 좌우. 현재 하드코딩 맵.
2. **주키워드 규칙 (#3)** — kind별 정규식. slug·제목·SEO 직결.
3. **primary → facts 연쇄 (#1 → #5)** — region-primary 유형만 `slot.region`이 생기고, 그래야 실제 학원 facts가 붙는다. 즉 primary가 "이 글이 실제 학원을 언급할 수 있는가"를 결정하는 근본 품질 요인.

## Phase 1 아키타입 스키마가 담아야 할 것

위 #1,2,3,5,6,7을 하나의 레코드로 통합한다:

```ts
type Archetype = {
  id: string;                         // 정본 유형 정체성 (kind/article_type/ID 통일)
  name: string;
  primary: "region" | "keyword";      // #1
  keyword_rule: {                     // #2, #3 통합
    select_pattern: string;           // 정규식 소스
    fallback: string;
    format: "plain" | "region_prefix" | "region_plus_fixed";
    fixed_keyword?: string;
  };
  academy_centric: boolean;           // #5
  writing_guide: string[];            // #6 ⭐
  article_type: string;               // #7 (파생 regex → 명시 필드로 taxonomy 통일)
  defaults: {                         // #4, #12
    use_persona: boolean;
    with_intent: boolean;
    modifier_count: number;
    axis_tags: { persona?: string[]; intent?: string[]; modifier?: string[] };
    direction: string;
    design: string;
    academy_types?: string[];
  };
};
```

- `article_type`를 아키타입의 **명시 필드**로 두면 #3(kind)·#7(article_type)·ID 분기의 3중 taxonomy가 하나로 수렴한다.
- 디자인 가이드(#9, #10)는 design dimension이라 별도 유지(프리셋으로 데이터화 경로 존재).

## 리팩터 안전 원칙 (Phase 1)

- **동작 불변**: 현재 TEMPLATE_SPECS/가이드/키워드 규칙에서 아키타입을 추출해 시드 → 출력이 리팩터 전후 100% 동일해야 한다.
- **골든 테스트**: T01~T15 슬롯 생성 결과(slot_id·primary_keyword·persona·intent·modifier)를 리팩터 전에 스냅샷하고, 후에 diff가 0임을 확인한다.
