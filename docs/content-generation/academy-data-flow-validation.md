# 학원 데이터 흐름 검증

검증일: 2026-07-20  
범위: T01(`local` archetype)의 실제 생성 경로와 이 경로가 공유하는 학원 데이터 계층. 소스·DB·운영 프롬프트는 변경하지 않았다.

## 결론

T01은 생성 시 외부 API를 호출하지 않는다. 이미 `academies` 테이블에 적재된 DrivingPlus 원본/관리자 입력 데이터를 읽고, 후보를 평면 facts 문자열로 직렬화해 LLM에 넘긴다. 다만 첫 후보 검색은 **주소 문자열 검색이 아니라 저장된 `academies.region`의 `LIKE` 검색**이다. 저장 시에는 도로명 주소에서 `region`을 파생하므로 간접적인 주소 기반 성격은 있지만, 생성 시점의 주소 정합성을 재판정하지 않는다.

## 원본에서 저장까지

| 단계 | 실제 구현·입력 | 출력·다음 전달 | 분기/실패 및 손실 정보 |
|---|---|---|---|
| 학원 원본 | `DrivingplusApiService.fetchAcademies()`가 DrivingPlus API 응답을 `normalizeAcademy()`로 변환한다. 수동 입력은 `AdminController.upsertAcademies()` 경로도 있다. [drivingplus-api.service.ts:49-77,127-148] [admin.controller.ts:515-534] | `DrivingplusAcademy`: `id`, `title`, `roadAddress`, `roadLatitude/Longitude`, 타입, 사진, 후기 등 | 이 검증에서는 API 호출·동기화를 하지 않았다. API 오류는 fetch에서 throw한다. |
| 자체 DB 적재 | `DbService.upsertDrivingplusAcademies()`가 `roadAddress`를 `address`로, 도로 좌표를 `latitude/longitude`로 저장한다. `region`은 `bestRegionForAddress()`의 최장 포함 지역명, 없으면 주소 첫 1~2 토큰으로 만든다. [db.service.ts:785-819,1204-1219] | `academies` 행과 `seo_regions` 좌표 | 지번 주소·행정코드·별도 활성 상태 필드는 없다. `source_name`, `source_url`, `synced_at`은 DB에는 남지만 생성 facts에는 안 간다. |
| 관리자/슬롯 입력 | `WorkerService.processGenerate()`가 slot과 글유형 spec을 읽는다. T01은 `kind: local`, `academy_types: [exam_academy, academy]`다. [worker.service.ts:61-116] [constants.ts:111] | `slot.region`, `template_id`, persona, modifier, keyword | slot 없음/도메인 불일치/제외어면 skip. |
| 후보 풀 | `buildFacts()` → `pickAcademiesForRegion(domain, region, academyPool, academyTypes, academyMin)`. T01은 pool 7, 최소 2, 본문 사용 최대 5다. [worker.service.ts:242-252] [archetypes.ts:40-42] [constants.ts:84-91] | `Row[]` 후보 풀 → slot 시드 표본 | 후보 출처 enum은 만들지 않는다. |
| 후보 facts | 후보당 주소·가격·셔틀·운영시간·합격률·전화·SEO·거리·후기·유형·좌표·사진을 한 줄 문자열로 만든다. [worker.service.ts:256-281] | `GenerationFacts = { text, images, academyCount, firstAcademyName }` [worker.service.ts:15] | ID, 원본 `region`, source, sync 시각, null/missing 구분, 조회 경로가 손실된다. |
| 패턴/variant | `getArchetype(kind)`와 `structureGuideForArchetype(archetype, structureSeed(slot))`가 T01의 6개 구조 중 하나를 slot ID 해시로 고른다. [worker.service.ts:800-828] [archetypes.ts:61-114,341-358] | 프롬프트의 구조 지시 | 후보 수·거리 후보·공통 비교 필드는 구조 선택 입력이 아니다. |
| modifier | 슬롯의 `modifier_1`, `modifier_2` 문자열을 프롬프트의 `수식어:` 줄에 쉼표로 넣는다. [worker.service.ts:824-833] | 일반 텍스트 | 별도 규칙, 데이터 요구, 적용 결과는 없다. |
| LLM/검수/저장 | `buildPrompt()` → `runLlm()` → Markdown normalize → `articleQualityIssues()` → 최대 2회(요청값 0~3으로 조정) repair → surface gate → `insertPost()`. [worker.service.ts:145-185,215-228] | posts 행, Markdown artifact | 후보 provenance는 저장되지 않는다. Gate 실패는 slot failed. |

## 후보 선택의 실제 세 단계

1. **직접 후보:** `DbService.listAcademies({ region })`의 SQL은 `region LIKE '%요청지역%'`, 타입 `IN (...)`, `ORDER BY name`, 최대 `max(limit*3, 20)`이다. [db.service.ts:821-842] [worker.service.ts:315-320]
2. **보충 후보:** 직접 유효 후보가 `limit`(T01은 7)보다 적을 때, 같은 타입의 최대 5,000개를 읽어 주소 포함·행정 토큰 일치·20km 이내 거리를 점수화한다. [worker.service.ts:321-346]
3. **최소 보장:** 보충 뒤에도 `minRequired`(T01 2)보다 적으면 50km 이내의 거리가 있는 후보를 가까운 순으로 필요한 수만큼 추가한다. [worker.service.ts:347-358]

`isUsableAcademy()`는 더미명 제외와 주소/가격/셔틀/시간/합격률/전화/후기/SEO/사진 중 길이 8 이상인 필드 하나를 요구한다. [worker.service.ts:427-433] 이는 활성/비활성 필터가 아니다. `academies` 스키마에는 enable/active 컬럼 자체가 없다. [db.service.ts:126-158]

## 세 개념의 표현 상태

| 개념 | 후보 조회 중 표현 | facts/prompt까지 보존 | 판정 |
|---|---|---|---|
| Candidate retrieval source | 로컬 변수 `direct`, `supplements`, `far`로만 구분된다. | `distance_km`만 일부 보존될 뿐 `direct/nearby/guaranteed`는 없다. | 손실 |
| Region relation | `row.region === region`, `address.includes(region)`, `sameAdministrativePrefix()`, 거리 조건으로 임시 score를 계산한다. [worker.service.ts:332-340,547-555] | 주소 텍스트와 선택적으로 거리만 남는다. 명시 relation은 없다. | 부분 보존/추론 의존 |
| Accessibility evidence | 좌표가 있으면 Haversine 직선거리만 계산한다. 셔틀은 데이터가 있을 때 별도 facts 필드다. | `지역 중심 기준 거리: 약 Nkm`, `셔틀` 문자열이 있으면 각각 남는다. | 접근 가능성 판단 근거가 구조화되어 있지 않음 |

중요하게도 거리만으로 “접근성이 좋다”는 코드 판정은 없다. 프롬프트는 거리 태그가 있고 주소가 주제 지역과 다르면 “인근 후보”라고 쓰라고 지시한다. [worker.service.ts:753] 그러나 facts에 원본 `region`이나 retrieval source가 없으므로 이 조건의 판별은 LLM의 주소 문자열 해석에 의존한다.

## facts의 실제 계약

facts는 후보별 객체가 아니라 아래와 같은 **평면 문자열**이다.

```text
작성 주제 지역: 수원
소개 가능한 후보 수: 3곳
작성 범위: 아래 항목에 없는 학원명·가격·합격률·셔틀·후기는 만들지 않는다

[1] A학원 / 주소: ... / 수강료: ... / 지역 중심 기준 거리: 약 12.3km / ...
```

`GenerationFacts`의 객체 부분은 `images`, `academyCount`, `firstAcademyName`뿐이다. 따라서 후보 ID·출처·동기화일·missing/null/unverified/stale 상태는 prompt와 quality gate에 전달되지 않는다. DB에는 `external_id`, `source_name`, `source_url`, `synced_at`이 있지만 직렬화 목록에는 없다. [db.service.ts:126-153] [worker.service.ts:260-281]

## T01과 다른 글 유형의 공유 경로

모든 생성은 `processGenerate()`·`buildPrompt()`·`articleQualityIssues()`·repair·저장을 공유한다. 학원 facts를 실제 주 재료로 쓰는 것은 `academy_centric` archetype인 `local`(T01), `local_single`(T11/T14)이다. `local_hub`(T07/T15)는 같은 `buildFacts()` 호출 경로를 타지만 `academy_centric`이 false라 이미지 구성 방식만 다르고, 템플릿의 `academy_types`가 있으면 후보 facts는 여전히 구성된다. [worker.service.ts:109-116] [archetypes.ts:30-37,47-120,187-]

## 실행/fixture 검증

- 실행: `npm --prefix apps/api-nest test -- --run test/structure-variant.test.ts test/quality-gate.test.ts test/slot-title.test.ts test/article-pattern-filter.test.ts` → **4 files, 79 tests passed**.
- `scripts/tests/golden-slots.json`은 슬롯 조합(T01 포함)만 고정하며 학원 후보·주소·거리 facts를 제공하지 않는다. `golden-runner.ts`는 OS tmpdir DB를 만들도록 되어 있다. [scripts/tests/golden-runner.ts:1-44]
- 골든 실행은 이 sandbox에서 `tsx` IPC pipe의 `listen EPERM`으로 실행하지 못했다. 소스/fixture는 읽었지만 결과를 근거로 삼지 않았다.
- 사례 A(직접만), B(보충), C(50km 뒤 부족), D(비교필드 부족)를 실제로 재현할 학원 fixture/snapshot 또는 읽기 전용 dry-run 입력은 저장소에서 찾지 못했다. 따라서 개별 지역의 실제 후보 수·주소·거리·선택 variant는 **not_verifiable**이다.
