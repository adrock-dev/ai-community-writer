# Phase 2b-2 정밀 설계: 커스텀 새 글유형

> 목적: 상수에 없는, 사용자가 정의한 새 글유형을 DB만으로 만들고 생성까지 가능하게 한다.
> 전제: Phase 0~2b-1 완료(커밋 f99c521, 0773f55, 26a8371). 이 문서는 요약 메모가 아니라 실행 스펙이다.
> 검증 규율: 각 서브스텝마다 **골든 0-diff**(빌트인 동작 불변) + 커스텀 긍정 테스트.

## 0. 데이터 모델 재확인 (틀리면 안 됨)

- **아키타입** = 코드 registry(`archetypes.ts`, kind 키). "고르는 대상". DB화 안 함. 커스텀도 **기존 아키타입을 참조(select)** 하지, 새 아키타입을 만들지 않는다(품질 보장).
- **글유형** = 아키타입 참조(kind) + 파라미터. 빌트인=상수(`TEMPLATE_SPECS`) 기본 + DB 오버라이드(`template_overrides`). 커스텀=full DB row(`custom_templates`).
- **복구**: 빌트인은 상수라 DB 초기화에도 안전. 커스텀만 DB 의존(export/백업 별도 필요, 이번 스코프 밖).

## 1. custom_templates 테이블

```sql
CREATE TABLE IF NOT EXISTS custom_templates (
  domain TEXT NOT NULL,
  template_id TEXT NOT NULL,          -- 커스텀 id, 빌트인(T01~15)과 충돌 금지
  name TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- 아키타입 참조(ARCHETYPES 키). getArchetype(kind) 로 검증
  use_persona INTEGER NOT NULL DEFAULT 0,
  with_intent INTEGER NOT NULL DEFAULT 0,
  modifier_count INTEGER NOT NULL DEFAULT 0,
  weight REAL NOT NULL DEFAULT 1.0,
  min_sv INTEGER NOT NULL DEFAULT 0,
  axis_tags TEXT,                     -- JSON: {persona?,intent?,modifier?: string[]}
  default_direction TEXT,
  default_design TEXT NOT NULL DEFAULT 'local-guide',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (domain, template_id),
  FOREIGN KEY (domain) REFERENCES domains(domain) ON DELETE CASCADE
);
```

- **template_id 생성/충돌**: `createCustomTemplate` 이 id를 발급. 규칙: `C` + 시퀀스 또는 randomUUID 앞 6자. **반드시 `!TEMPLATE_SPECS[id] && !기존 custom row`** 검증. slot_id 해시는 `domain+template_id`(slot.service:slotId) 이므로 id가 유니크하면 슬롯 충돌 없음.
- **kind 검증**: 저장 시 `getArchetype(kind)` 존재 확인(없는 kind 거부).

## 2. getTemplateSpec(domain, tid) 리졸버 (DbService)

빌트인/커스텀을 **동일 형태**로 반환 — 하위 리졸버들이 균일하게 소비하게.

```ts
type TemplateSpecShape = {
  name: string; kind: string;
  use_persona: boolean; with_intent: boolean; modifier_count: number;
  weight: number; min_sv: number;
  axis_tags?: { persona?: string[]; intent?: string[]; modifier?: string[] };
  default_direction?: string; default_design?: string;
};
getTemplateSpec(domain, tid): TemplateSpecShape | undefined
// 빌트인: TEMPLATE_SPECS[tid] 를 이 shape 로 정규화(primary/kind 포함, primary 는 아키타입에서 파생 가능하니 spec 에 안 넣어도 됨)
// 커스텀: custom_templates row → shape (axis_tags safeJson, INTEGER→boolean)
// 둘 다 없으면 undefined
```

- **primary 는 spec 에 안 넣어도 됨** — `getArchetype(spec.kind).primary` 로 얻는다(빌트인/커스텀 동일 경로).

## 3. 리졸버 디커플링 (load-bearing 핵심)

지금 `axis-tags.ts` 의 세 함수는 `TEMPLATE_SPECS[tid]` 를 직접 읽어 기본값을 얻는다. 커스텀은 상수에 없으므로 **spec 을 주입**받게 시그니처를 바꾼다.

| 현재 | 변경 후 |
|---|---|
| `resolveAcceptedTags(tid, axis, overrides)` | `resolveAcceptedTags(specAxisTags, tid, axis, overrides)` — 기본값을 `specAxisTags`(spec.axis_tags)에서 |
| `resolveRecipeFlags(tid, overrides)` | `resolveRecipeFlags(spec, overrides[tid])` — 기본값을 spec 에서 |
| `resolveTemplateDirection(tid, overridesValue)` | `resolveTemplateDirection(spec, overrides[tid])` — 기본값을 spec.default_direction 에서 |

- 이유: 커스텀 글유형의 기본값(axis_tags/direction/use_persona…)은 상수가 아니라 **그 커스텀 row** 에 있다.
- 호출측(slot.service, worker)이 먼저 `spec = getTemplateSpec(domain, tid)` 로 로드해서 주입.
- 오버라이드 병합 우선순위는 그대로: `override ?? spec 기본값`.

## 4. slot.service 변경

- `const spec = this.db.getTemplateSpec(domain, tid); if (!spec) continue;` (기존 `TEMPLATE_SPECS[tid]` 대체)
- `const archetype = getArchetype(String(spec.kind || ""));` (기존 `getArchetypeForTemplate(tid)` 대체 — 커스텀 지원)
- `primaryAxis = (archetype?.primary ?? "keyword")`
- 리졸버 호출을 새 시그니처로: `resolveAcceptedTags(spec.axis_tags?.[axis]…)`, `resolveRecipeFlags(spec, overrides[tid])`
- `spec.weight`, `spec.min_sv` 사용
- **templates_enabled 에 커스텀 id 포함 가능** — generateSlotsForDomain 의 templateIds 는 이미 domain.templates_enabled 를 쓰므로, 커스텀 id 가 거기 있으면 자동 순회. (별도 처리 불필요)

## 5. worker 변경 (buildPrompt archetype 스레딩)

- **buildPrompt / buildRepairPrompt 는 자유함수라 `this.db` 없음.** 따라서 archetype 을 **클래스 메서드(processGenerate)에서 해석해 파라미터로 넘긴다.**
- processGenerate: `const spec = this.db.getTemplateSpec(domain, slot.template_id); const archetype = getArchetype(spec?.kind ?? "");`
  - `academyImageType = archetype?.academy_centric ?? false` (기존 getArchetypeForTemplate 대체)
  - buildPrompt/buildRepairPrompt 에 `archetype` 인자 추가 → 내부에서 `originalTemplateGuide` 대신 `writingGuideForArchetype(archetype)` 사용
  - `resolveTemplateDirection(spec, overrides[tid])` (spec 주입)
- `writingGuideText(tid)` → `archetypes.ts` 에 `writingGuideForArchetype(archetype)` 추가(archetype.writing_guide 를 `- ` 포맷). 커스텀은 참조 아키타입의 writing_guide 를 그대로 씀.

## 6. admin.controller CRUD 엔드포인트

- `POST /domains/:domain/templates` (커스텀 생성, kind 검증), `GET /domains/:domain/templates`(빌트인+커스텀 목록), `DELETE /domains/:domain/templates/:tid`.
- **JSON 컬럼 직렬화 함정 주의**: `axis_tags` 는 객체로 들어오면 **반드시 `JSON.stringify`** 해서 저장(과거 template_overrides 에서 이걸 빠뜨려 유실 버그 발생). CRUD/PATCH 모두 확인.
- `/options` 는 빌트인 TEMPLATE_SPECS 만 노출 중 — 커스텀은 도메인 상세(getDomainDetail)에 포함하는 게 자연스러움.

## 7. 기지의 함정 체크리스트 (반드시 확인)

1. **JSON 컬럼 write 직렬화** — axis_tags 저장 시 stringify. (template_overrides 에서 겪은 버그)
2. **커스텀 id 충돌** — 빌트인/기존 커스텀과 유니크. slot_id 는 domain+tid 해시라 유니크하면 안전.
3. **키워드 축 정렬 의존** — buildKeyword 는 keywordAxis 가 listAxes 정렬(weight DESC)이라 가정. slot.service 는 이미 listAxes 사용.
4. **article_type 미통합** — articleTypeForSlot 는 텍스트 의존이라 이번에도 안 건드림. 커스텀도 articleTypeForSlot 이 slot.primary_keyword 텍스트로 분류.
5. **동작 불변** — 오버라이드/커스텀 없으면 빌트인 출력이 골든과 100% 동일해야 함.

## 8. 서브스텝 + 검증

- **2b-2a**: 테이블 + CRUD + getTemplateSpec (additive, 배선 없음). 검증: CRUD 왕복(생성→조회→삭제).
- **2b-2b**: 리졸버 디커플링 + slot.service + worker 배선. 검증:
  - 골든 0-diff(오버라이드/커스텀 없는 도메인, 전 빌트인). 픽스처: `apps/api-nest/scripts/tests/golden-slots.json`.
  - 긍정 테스트: 커스텀 글유형(예: name="심야 학원 특집", kind="local_best") 생성 → templates_enabled 에 추가 → slots/generate → **주키워드가 local_best 규칙(지역+운전면허학원) 대로 나오는지**, academy_centric/writing_guide 가 참조 아키타입대로 프롬프트에 반영되는지.
- 검증 API 기동: `ADMIN_PORT=8790 ADMIN_HOST=127.0.0.1 SEO_DB_PATH=<scratch> API_WORKER=0 PUBLIC_API_ORIGINS=* npx tsx src/main.ts`.

## 9. 커밋 전 필수 (이번에 놓쳐서 사고났던 부분)

**verify:company-clean + typecheck + qa:posts 3종 모두** 실행 후 커밋. (2a/2b-1 때 company-clean 을 빠뜨려 금지어가 커밋에 유입 → b5dd85a 로 정정한 전례 있음.)
