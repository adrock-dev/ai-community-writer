# 관리자 JSON API

- 검토일: 2026-07-30 (엔드포인트를 컨트롤러와 **전수 대조** — 이전 기재 2026-06-23)
- 근거 코드: `apps/api-nest/src/admin.controller.ts`, **`academy-research.controller.ts`**, **`post-insight.controller.ts`**, `public.controller.ts`, `db.service.ts`, `apps/admin-next/lib/types.ts`, `apps/admin-next/lib/api.ts`
- 이 문서의 상태: 실제 엔드포인트는 **95개**인데 상세 계약이 적힌 것은 52개다. 2026-07-30 대조에서 **문서에만 있는 유령 엔드포인트는 0건**이었고, 빠져 있던 43개는 아래 「엔드포인트 전수 색인」에 채웠다. 색인만 있고 상세가 없는 항목은 요청/응답을 컨트롤러에서 확인한다.
- 누락 원인: 「근거 코드」에 `academy-research.controller.ts`(13개)와 `post-insight.controller.ts`(1개)가 빠져 있어 그 컨트롤러 전체가 문서화 범위 밖이었다. **관리자 엔드포인트는 한 파일에 없다** — `@Controller` 프리픽스가 `api/admin`, `api/admin/academy-research`, `api/admin/post-insight` 셋으로 갈린다.

Nest API는 관리자 화면용 JSON API를 `/api/admin/*` 아래에 제공한다. 관리자 Next.js 앱은 자체 라우트 핸들러 `apps/admin-next/app/api/admin/[...path]/route.ts`를 통해 이 API로 프록시한다.

## 인증

`ADMIN_PASSWORD`가 설정되어 있으면 모든 관리자 JSON 엔드포인트는 아래 셋 중 하나를 받아야 한다.

- cookie: `admin_token=<ADMIN_PASSWORD>`
- header: `x-admin-token: <ADMIN_PASSWORD>`
- header: `Authorization: Bearer <ADMIN_PASSWORD>`

관리자 Next.js 프록시는 브라우저 쿠키, 브라우저 토큰, 서버 환경 변수 `ADMIN_API_TOKEN`을 Nest API로 전달한다.

## 엔드포인트 전수 색인

2026-07-30 컨트롤러 대조 기준 전부다(관리자 88 + 공개 7). ✔ = 이 문서에 상세 계약이 있음.

| 계열 | 엔드포인트 |
| --- | --- |
| 옵션·런타임 | ✔`GET /options` · `GET /runtime/apis` |
| 도메인 | ✔`GET /domains` · ✔`POST /domains` · ✔`GET /domains/{domain}` · ✔`PATCH /domains/{domain}` · ✔`DELETE /domains/{domain}` |
| 축·슬롯 | ✔`PUT /domains/{domain}/axes/{axis}` · ✔`POST /domains/{domain}/axes/preset` · ✔`GET /domains/{domain}/slots` · ✔`POST /domains/{domain}/slots/generate` · ✔`DELETE /domains/{domain}/slots/{slot_id}` · ✔`POST /domains/{domain}/slots/{slot_id}/reset` · ✔`PATCH /domains/{domain}/slots/{slot_id}` |
| 글유형 | ✔`GET`·✔`POST /domains/{domain}/templates` · ✔`PATCH`·✔`DELETE /templates/{template_id}` · ✔`POST /templates/clone` · ✔`POST /templates/suggest-axes` · ✔`POST /templates/validate-direction` · ✔`GET /templates/coherence` · ✔`GET /templates/{template_id}/academy-coverage` · ✔`GET /templates/export` · ✔`POST /templates/import` |
| 글 | ✔`GET /domains/{domain}/posts` · ✔`GET`·✔`DELETE /posts/{post_id}` · ✔`POST /posts/export` · `GET /post-insight/{post_id}` |
| 격리 검수 | `GET /domains/{domain}/drafts` · `GET`·`DELETE /drafts/{draft_id}` · `POST /drafts/{draft_id}/promote`·`/revalidate`·`/dismiss` |
| 학원 자료(도메인) | ✔`GET`·✔`POST /domains/{domain}/academies` · ✔`DELETE /academies/{academy_id}` · `DELETE /domains/{domain}/academies` · `POST /academies/link` · `GET /academy-exclusions` · `DELETE /academy-exclusions/{external_id}` · `GET /research-summary` · `GET /source-freshness` |
| 원천 동기화 | ✔`POST /domains/{domain}/sync/drivingplus` · ✔`/sync/drivingplus/academies` · ✔`/sync/drivingplus/regions` · ✔`GET /sync/runs` · ✔`GET /sync/runs/{run_id}` · ✔`POST /sync/runs/{run_id}/cancel` |
| 학원 심층조사 | `GET /academy-research/list`·`/status-defs`·`/runs`·`/runs/{run_id}`·`/review-queue`·`/{external_id}` · `POST /academy-research/sync`·`/sync/blog-reviews`·`/research/region`·`/field-meta/bulk`·`/manual`·`/{external_id}/sync`·`/{external_id}/research`·`/{external_id}/research-sync`·`/runs/{run_id}/cancel` · `PATCH /{external_id}/field`·`/{external_id}/field-meta` · `DELETE /manual/{external_id}` |
| 작업 큐 | ✔`POST /domains/{domain}/jobs/generate`·`/dedup`·`/prune`·`/indexing` · ✔`GET /jobs` · `POST /jobs/{id}/cancel`·`/pause`·`/resume`·`/prioritize` |
| 설정 | ✔`GET`·✔`PUT /settings/indexing` · ✔`GET`·✔`PUT /settings/blog-review-sync` · `PUT /settings/builtin-visibility` · `GET /settings/region-directory` · `POST /settings/region-directory/sync` · `GET`·`POST /settings/verticals` · `DELETE /settings/verticals/{key}` |
| 공개 API | ✔`GET /api/v1/{domain}/posts` · ✔`/posts/{slug}` · ✔`/academies` · ✔`POST /academies` · ✔`/generated-images/{file}` · ✔`/sitemap.xml` · `GET /site` |

관리자 경로는 모두 `/api/admin` 아래이며 위 표에서는 그 접두어를 생략했다(학원 심층조사는 `/api/admin/academy-research`, 글 인사이트는 `/api/admin/post-insight`).

## 공통 데이터 타입

### DomainConfig

`GET /api/admin/domains`, `GET /api/admin/domains/{domain}`, `PATCH /api/admin/domains/{domain}`에서 쓰인다.

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `domain` | string | 도메인 키 |
| `display_name` | string | 화면 표시 이름 |
| `vertical` | string | 현재 운영 업종 키 |
| `theme` | `clean` \| `modern` \| `pro` | 관리자/디자인 테마 |
| `brand_color` | string \| null | 브랜드 색상 |
| `logo_url` | string \| null | 로고 URL |
| `templates_enabled` | string[] | 사용 가능한 생성 템플릿 코드 |
| `design_template_id` | string | 공개 글 디자인 템플릿 |
| `custom_design_templates` | string \| null | 사용자 정의 디자인 JSON 문자열 |
| `content_brief` | string \| null | 생성 지침 |
| `excluded_keywords` | string \| null | 제외 키워드 텍스트 |
| `daily_limit` | number | 일일 생성 제한 |
| `created_at` | string | 생성 시각 |
| `slot_count` | number | 도메인 목록 응답에서 제공되는 전체 슬롯 수 |
| `planned_count` | number | 도메인 목록 응답에서 제공되는 대기 슬롯 수 |
| `published_count` | number | 도메인 목록 응답에서 제공되는 발행 글 수 |

### AxisValue

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `domain` | string | 도메인 키 |
| `axis` | `region` \| `keyword` \| `intent` \| `persona` \| `modifier` | 축 이름 |
| `value` | string | 축 값 |
| `weight` | number | 가중치 |
| `monthly_search_volume` | number \| null | 월 검색량 |
| `competition_kd` | number \| null | 경쟁도 |

### Slot

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `slot_id` | string | 슬롯 ID |
| `domain` | string | 도메인 키 |
| `template_id` | string | 템플릿 코드 |
| `primary_keyword` | string | 대표 키워드 |
| `region` | string \| null | 지역 |
| `persona` | string \| null | 대상 독자 |
| `intent` | string \| null | 검색 의도 |
| `modifier_1` | string \| null | 수식어 1 |
| `modifier_2` | string \| null | 수식어 2 |
| `entity_id` | string \| null | 연결 엔티티 ID |
| `priority_score` | number \| null | 우선순위 점수 |
| `status` | `planned` \| `in_progress` \| `published` \| `failed` \| `skipped` | 슬롯 상태. `skipped`는 생성 시 후보 부족·제외 규칙으로 건너뛴 슬롯 |
| `last_error` | string \| null | 마지막 오류 |
| `title` | string \| null | 수동 제목 오버라이드(원문). 설정 시 제목 규칙보다 우선하며 `{지역}`/`{개수}`/`{키워드}`/`{학원명}`을 생성 시점에 치환. null이면 규칙/LLM이 제목 결정 |
| `created_at` | string | 생성 시각 |

### TitleRule

제목 규칙. 생성 시점의 **실제 후보 수**(직접+인근+보장으로 모아 글유형 상한만큼 선정한 학원 수)로 제목을 확정한다. 빌트인 글유형은 코드 상수(`TITLE_RULES`), 커스텀은 `custom_templates.title_rule`에 저장된다.

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `min_generate` | number? | 후보 수가 이 값 미만이면 생성하지 않고 건너뛴다(슬롯 `skipped`) |
| `tiers` | `{ min_count, template }[]` | `min_count` 내림차순 첫 매칭 제목을 쓴다 |
| `fallback` | string? | 어떤 tier도 안 맞을 때 쓸 제목 |

`template`/`fallback`의 `{지역}`/`{개수}`/`{키워드}`/`{학원명}`은 생성 시점에 치환된다.

### CustomTemplate

커스텀 글유형(`custom_templates` row). 빌트인 `TemplateSpec`과 유사하되 `template_id`/`created_at`을 갖는다.

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `template_id` | string | 커스텀 글유형 ID(발급값) |
| `name` | string | 표시 이름 |
| `kind` | string | 참조 아키타입(`getArchetype`로 검증되는 기존 kind만 허용) |
| `use_persona` / `with_intent` | boolean | 축 사용 여부 |
| `modifier_count` | number | 수식어 조합 개수(0~2) |
| `weight` / `min_sv` | number | 우선순위 가중치 / 최소 검색량 |
| `axis_values` | `{persona?,intent?,modifier?: string[]}` | 글유형 축 값 프리셋(단일 소스) |
| `academy_types` | string[] | 사용할 학원 타입. 비면 학원정보 미사용 |
| `keyword_filter` | string[] | 값 있으면 아키타입 패턴 무시하고 이 키워드 직접 사용 |
| `primary_override` | `region`\|`keyword`? | 주축 재정의 |
| `default_direction` | string \| null | 기본 방향성 |
| `default_design` | string | 기본 디자인 |
| `title_rule` | TitleRule \| null | 제목 규칙(위 참조) |

### PostSummary / PostDetail

`PostSummary`는 목록 응답에서 쓰이고, `PostDetail`은 상세 응답에서 본문과 이미지 자료가 추가된다.

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `id` | string | 글 ID |
| `domain` | string | 도메인 키 |
| `slot_id` | string \| null | 원본 슬롯 ID |
| `slug` | string | 공개 URL slug |
| `title` | string | 제목 |
| `meta_description` | string \| null | 메타 설명 |
| `design_template_id` | string \| null | 디자인 템플릿 |
| `status` | `published` \| `noindex` \| `deleted` | 글 상태 |
| `provider` | string \| null | 생성 공급자 |
| `model` | string \| null | 생성 모델 |
| `cost_usd` | number | 비용 추정값 |
| `duration_sec` | number \| null | 생성 소요 시간 |
| `generated_at` | string | 생성 시각 |
| `body_chars` | number | 본문 길이 |
| `body_markdown` | string | 상세 응답 전용 본문 Markdown |
| `images` | string \| object \| null | 상세 응답 전용 이미지 자료 |
| `session_id` | string \| null | 생성 세션 ID |
| `input_tokens` | number | 입력 토큰 |
| `output_tokens` | number | 출력 토큰 |

### Academy

학원 데이터는 직접 입력과 외부 동기화 모두 같은 저장소에 upsert된다.

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `id` | string | 학원 ID |
| `domain` | string | 도메인 키 |
| `external_id` | string \| null | 외부 원본 ID |
| `region` | string \| null | 지역 |
| `name` | string | 학원명 |
| `address` | string \| null | 주소 |
| `price` | string \| null | 가격 정보 |
| `shuttle` | string \| null | 셔틀 정보 |
| `hours` | string \| null | 운영 시간 |
| `pass_rate` | string \| null | 합격률 정보 |
| `phone` | string \| null | 전화번호 |
| `vphone` | string \| null | 가상 전화번호 |
| `review` | string \| null | 요약 리뷰 |
| `review_json` | string \| null | 리뷰 JSON 문자열 |
| `blog_reviews` | string \| null | 블로그 리뷰 JSON 문자열 |
| `seo_title` | string \| null | 외부 SEO 제목 |
| `seo_keywords` | string \| null | 외부 SEO 키워드 |
| `seo_description` | string \| null | 외부 SEO 설명 |
| `latitude` | number \| null | 위도 |
| `longitude` | number \| null | 경도 |
| `thumb_url` | string \| null | 대표 이미지 |
| `photos` | string \| null | 이미지 목록 JSON 문자열 |
| `academy_type` | string \| null | 학원 유형 |
| `extra` | string \| null | 추가 자료 JSON 문자열 |
| `source_name` | string \| null | 원본 이름 |
| `source_url` | string \| null | 원본 URL |
| `synced_at` | string \| null | 동기화 시각 |
| `created_at` | string | 생성 시각 |

#### 리뷰 데이터 구조

학원 응답에는 리뷰 자료가 세 단계로 들어온다.

| 필드 | 의미 | 생성 워커 사용 방식 |
| --- | --- | --- |
| `review` | 짧게 합쳐 둔 요약 리뷰 텍스트 | `review_json`이 없을 때 보조 근거로 사용 |
| `review_json` | 수강생 리뷰 배열을 JSON 문자열로 저장한 값. 보통 `point`, `content` 중심 | 평점/문구에서 긍정 근거를 요약해 글 생성 facts에 포함 |
| `blog_reviews` | 블로그 리뷰 배열을 JSON 문자열로 저장한 값. 보통 `title`, `content`, `link` 중심 | **사용하지 않는다.** 원천이 학원명을 느슨하게 매칭해 다른 학원 글이 섞여, 생성 프롬프트에서 뺐고 수집도 기본 꺼짐이다. 이미 저장된 값은 학원 상세 화면 참고용으로 남는다 |

직접 upsert할 때는 `review_json` 또는 `reviews` 입력이 `review_json`에 저장되고, `blog_reviews` 입력은 JSON 문자열로 저장된다. 외부 학원 동기화는 일반 리뷰만 정규화해 넣는다 — 블로그 리뷰 수집은 `DRIVINGPLUS_BLOG_REVIEW_SYNC` 스위치로 통제하며 기본이 꺼짐이다. 꺼져 있어도 이미 저장된 `blog_reviews` 는 지워지지 않는다.

### Job

작업 목록은 원본 JSON 문자열과 파싱된 객체를 함께 준다.

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `id` | string | 작업 ID |
| `domain` | string | 도메인 키 |
| `kind` | `generate` \| `dedup` \| `indexing` \| `prune` | 작업 종류 |
| `payload` | string | 원본 payload JSON 문자열 |
| `payload_obj` | object | 파싱된 payload |
| `status` | `queued` \| `running` \| `done` \| `failed` | 작업 상태 |
| `scheduled_at` | string | 예약 시각 |
| `started_at` | string \| null | 시작 시각 |
| `finished_at` | string \| null | 종료 시각 |
| `error` | string \| null | 오류 |
| `result` | string \| null | 원본 결과 JSON 문자열 |
| `result_obj` | object | 파싱된 결과 |

## 옵션

### `GET /api/admin/options`

응답:

```json
{
  "verticals": ["driving"],
  "themes": ["clean", "modern", "pro"],
  "templates": ["T01", "T03"],
  "template_specs": {},
  "design_templates": [],
  "providers": ["codex", "claude"],
  "preset_options": ["driving"],
  "indexing": {
    "has_key": false,
    "url_template": "https://{domain}/community/{slug}"
  }
}
```

`templates`, `template_specs`, `design_templates`는 코드 상수 기준으로 더 많은 값을 포함한다.

## 도메인

### `GET /api/admin/domains`

응답:

```json
{
  "count": 1,
  "items": [
    {
      "domain": "example.com",
      "display_name": "예시 도메인",
      "templates_enabled": ["T01", "T03"],
      "slot_count": 100,
      "planned_count": 80,
      "published_count": 20
    }
  ]
}
```

### `POST /api/admin/domains`

요청:

```json
{
  "domain": "example.com",
  "display_name": "예시 도메인",
  "vertical": "driving",
  "theme": "clean",
  "brand_color": "#2563eb",
  "daily_limit": 30,
  "content_brief": "검증된 자료 중심으로 작성",
  "apply_preset": true
}
```

응답:

```json
{ "ok": true, "domain": {} }
```

### `GET /api/admin/domains/{domain}`

쿼리:

| 이름 | 설명 | 기본/제한 |
| --- | --- | --- |
| `include` | `slots,posts,academies,jobs` 중 필요한 자료를 쉼표로 지정 | 없으면 기본 도메인 자료만 |
| `limit` | include 자료별 limit | 기본 100, 최대 500 |
| `slot_status` | include slots 전용 상태 필터 | 선택 |
| `slot_template` | include slots 전용 템플릿 필터 | 선택 |
| `slot_q` | include slots 전용 검색어 | 선택 |

응답:

```json
{
  "domain": {},
  "axes": {
    "region": [],
    "keyword": [],
    "intent": [],
    "persona": [],
    "modifier": []
  },
  "slot_counts": {
    "planned": 0,
    "in_progress": 0,
    "published": 0,
    "failed": 0,
    "skipped": 0
  },
  "settings": {
    "indexing_has_key": false,
    "indexing_url_template": "https://{domain}/community/{slug}"
  },
  "slots": [],
  "posts": [],
  "academies": [],
  "jobs": []
}
```

`slots`, `posts`, `academies`, `jobs`는 `include`에 들어간 경우에만 포함된다.

### `PATCH /api/admin/domains/{domain}`

수정 가능 필드:

- `display_name`
- `vertical`
- `theme`
- `brand_color`
- `daily_limit`
- `templates_enabled`
- `logo_url`
- `design_template_id`
- `custom_design_templates`
- `content_brief`
- `excluded_keywords`

응답:

```json
{ "ok": true, "domain": {} }
```

### `DELETE /api/admin/domains/{domain}`

응답:

```json
{ "ok": true }
```

## 축과 슬롯

### `PUT /api/admin/domains/{domain}/axes/{axis}`

`axis`는 `region`, `keyword`, `intent`, `persona`, `modifier` 중 하나다. 단 현재 도메인 축 편집은 `region`/`keyword`만 UI에 노출되며(「원천 데이터」 탭), `intent`/`persona`/`modifier`는 도메인 레벨에서 dormant이고 글유형별 `axis_values`로 관리한다(엔드포인트는 기술적으로 값을 받는다).

요청:

```json
{
  "values": [
    {
      "value": "서울",
      "weight": 5,
      "monthly_search_volume": 1200,
      "competition_kd": 30
    }
  ]
}
```

응답:

```json
{ "ok": true, "axis": "region", "count": 1, "axes": {} }
```

### `POST /api/admin/domains/{domain}/axes/preset`

요청:

```json
{ "preset_key": "driving" }
```

응답:

```json
{ "ok": true, "preset_key": "driving", "axes": {} }
```

### `GET /api/admin/domains/{domain}/slots`

쿼리:

| 이름 | 설명 | 기본/제한 |
| --- | --- | --- |
| `status` | 슬롯 상태 필터 | 선택 |
| `template` | 템플릿 코드 필터 | 선택 |
| `q` | 키워드/지역/의도/ID 검색 | 선택 |
| `limit` | 페이지 크기 | 기본 300, 최대 2000 |
| `offset` | 시작 위치 | 기본 0 |

응답:

```json
{
  "count": 50,
  "total": 120,
  "slot_counts": {
    "planned": 100,
    "in_progress": 0,
    "published": 20,
    "failed": 0,
    "skipped": 0
  },
  "items": []
}
```

### `POST /api/admin/domains/{domain}/slots/generate`

요청:

```json
{ "max_per_template": 200 }
```

응답:

```json
{ "ok": true, "summary": {}, "slot_counts": {} }
```

### `DELETE /api/admin/domains/{domain}/slots/{slot_id}`

응답:

```json
{ "ok": true, "deleted": 1 }
```

### `POST /api/admin/domains/{domain}/slots/{slot_id}/reset`

응답:

```json
{ "ok": true, "slot": {} }
```

### `PATCH /api/admin/domains/{domain}/slots/{slot_id}`

슬롯 수동 제목 오버라이드를 저장한다. 본문 `title`을 넣으면 그 슬롯 생성 시 제목 규칙보다 우선하며, 빈 문자열/`null`이면 규칙·LLM 폴백으로 되돌린다. `{지역}`/`{개수}`/`{키워드}`/`{학원명}`은 생성 시점에 치환된다(저장은 원문).

```json
{ "title": "{지역} 운전학원 완벽정리 {개수}곳" }
```

응답:

```json
{ "ok": true, "slot": {} }
```

## 글유형(템플릿)

빌트인 글유형(`TEMPLATE_SPECS` 코드 상수)과 도메인 커스텀 글유형(`custom_templates`)을 관리한다. 커스텀 글유형은 검증된 아키타입(`kind`)을 참조하고 축·키워드·디자인·방향성·제목 규칙 등 세부만 조정한다.

### `GET /api/admin/domains/{domain}/templates`

빌트인 + 커스텀 글유형 목록. 빌트인에는 `title_rule`(있으면)이 병합되어 온다.

```json
{
  "builtin": [{ "template_id": "T01", "name": "...", "kind": "local", "title_rule": {}, "custom": false }],
  "custom": [{ "template_id": "C1a2b3", "name": "...", "kind": "local", "title_rule": null, "custom": true }]
}
```

### `POST /api/admin/domains/{domain}/templates`

커스텀 글유형 생성. `name`·`kind` 필수(`kind`는 등록된 아키타입만). 본문은 [CustomTemplate](#customtemplate) 필드(`title_rule` 포함)를 받는다. 응답 `{ ok, template }`.

### `PATCH /api/admin/domains/{domain}/templates/{template_id}`

커스텀 글유형 편집(빌트인은 불가 — 복제해서 편집). 전달한 필드만 수정한다(부분 업데이트). `title_rule`을 `{ "tiers": [] }`로 주면 규칙이 제거된다. 응답 `{ ok, template }`.

### `DELETE /api/admin/domains/{domain}/templates/{template_id}`

커스텀 글유형 삭제(빌트인 불가). 응답 `{ ok, deleted }`.

### `POST /api/admin/domains/{domain}/templates/clone`

기존 글유형(빌트인/커스텀)을 새 커스텀 row로 복제한다. 소스의 유효 설정(오버라이드 병합 + **`title_rule` 상속**)을 굳혀 독립 복제본을 만든다.

```json
{ "source_template_id": "T01", "name": "강남 특집", "overrides": { "title_rule": {} } }
```

응답 `{ ok, template, source_template_id }`. `overrides`로 복제 직후 일부 필드를 덮을 수 있다(폼이 source of truth).

### `POST /api/admin/domains/{domain}/templates/suggest-axes`

켜 놓은 축(`persona`/`intent`/`modifier`) 값을 LLM이 이 글유형에 맞게 제안한다(저장하지 않음). 본문 `{ kind, name, direction, keywords, axes, provider?, model? }`. 응답 `{ ok, suggestions, provider, model }`. codex/claude CLI 인증 필요(실패 시 502).

### `POST /api/admin/domains/{domain}/templates/validate-direction`

입력한 방향성이 절대 원칙·공통원칙·아키타입 지침과 중복/충돌하는지 LLM으로 대조하고 개선안을 제안한다(저장하지 않음). 본문 `{ kind, name, direction, current_direction?, has_academy?, provider?, model? }`. 응답 `{ ok, validation, provider, model }`.

### `GET /api/admin/domains/{domain}/templates/coherence`

레시피↔데이터 정합성(읽기/계산 전용). 전 빌트인+커스텀 글유형의 주축·키워드 규칙 매칭·축 풀·학원 커버리지·예상 슬롯 상한·경고를 반환한다.

### `GET /api/admin/domains/{domain}/templates/{template_id}/academy-coverage`

특정 글유형의 지역별 학원 커버리지(지역별 학원 수·충분 여부 + 학원별 빠진 데이터).

### `GET /api/admin/domains/{domain}/templates/export`

커스텀 글유형 편집 상태 봉투. `{ schema: "adrock-templates-export", version, domain, exported_at, custom_templates, template_overrides, templates_enabled }`. `custom_templates`에는 `title_rule`이 포함된다.

### `POST /api/admin/domains/{domain}/templates/import`

봉투를 받아 커스텀 글유형·오버라이드·활성 목록을 복원한다. 쿼리 `mode=merge`(기본, id별 upsert) 또는 `replace`(교체). 빌트인 id shadow 차단·`kind` 검증. 응답 `{ ok, mode, imported, skipped, overrides_merged, templates_enabled, warnings }`.

## 글

### `GET /api/admin/domains/{domain}/posts`

쿼리:

| 이름 | 설명 | 기본/제한 |
| --- | --- | --- |
| `status` | `published`, `noindex`, `deleted` | 선택 |
| `limit` | 목록 개수 | 기본 100, 최대 500 |

응답:

```json
{ "count": 10, "items": [] }
```

### `GET /api/admin/domains/{domain}/posts/{post_id}`

쿼리:

| 이름 | 설명 |
| --- | --- |
| `include_rendered` | `true` 또는 `1`이면 `body_html` 포함 |

응답:

```json
{
  "post": {
    "id": "...",
    "body_markdown": "# 제목",
    "images": "{}"
  },
  "body_html": "<article>...</article>"
}
```

`body_html`은 요청한 경우에만 포함된다.

### `POST /api/admin/domains/{domain}/posts/export`

요청:

```json
{
  "post_ids": ["post-id-1", "post-id-2"],
  "format": "markdown"
}
```

`format`은 `markdown` 또는 `html`이다. 응답은 `application/zip` 파일이다.

### `DELETE /api/admin/domains/{domain}/posts/{post_id}`

응답:

```json
{ "ok": true }
```

## 격리 검수(초안)

품질 게이트를 통과하지 못한 글은 버려지지 않고 `draft_posts`에 격리된다. 공개 경로(`posts`)와 분리돼 있어 이 API로만 보인다.

### `GET /api/admin/domains/{domain}/drafts`

쿼리: `status`(review_status 필터), `limit`(기본 100, 1~500).

응답: `{ "count": 3, "pending": 2, "items": [] }` — `pending`은 도메인 전체의 미검수 건수다.

### `GET /api/admin/domains/{domain}/drafts/{draft_id}`

쿼리 `include_rendered`로 렌더 HTML을 함께 받는다. 도메인이 다르면 404.

### `POST /api/admin/domains/{domain}/drafts/{draft_id}/promote`

격리 글을 발행한다. **UI 우회 방지를 위해 저장된 이슈로 서버가 차단 등급을 다시 계산한다** — 안전·사실(B) 이슈가 남아 있으면 409(`안전·사실(B) 이슈가 남아 있어 발행할 수 없습니다`). 이미 발행된 초안도 409.

### `POST /api/admin/domains/{domain}/drafts/{draft_id}/revalidate`

본문을 고친 뒤 다시 검사한다. 응답 `{ ok, quality_issues, blocking_class, promotable }` — `promotable`은 `blocking_class !== "B"`다.

### `POST /api/admin/domains/{domain}/drafts/{draft_id}/dismiss`

반려(`review_status='dismissed'`). 행은 남는다.

### `DELETE /api/admin/domains/{domain}/drafts/{draft_id}`

격리 글을 지운다.

## 학원 데이터

### `GET /api/admin/domains/{domain}/academies`

쿼리:

| 이름 | 설명 | 기본/제한 |
| --- | --- | --- |
| `region` | 지역 부분 검색 | 선택 |
| `academy_type` | 학원 유형 정확 매칭 | 선택 |
| `q` | 이름/주소/지역/외부 ID/전화/SEO 필드 검색 | 선택 |
| `has_photos` | `1` 또는 `true`면 이미지가 있는 항목만 | 선택 |
| `limit` | 목록 개수 | 기본 500, 최대 1000 |

응답:

```json
{
  "count": 10,
  "items": [],
  "academy_types": [
    { "value": "전문", "count": 5 }
  ]
}
```

`items`의 각 학원은 `review`, `review_json`, `blog_reviews`를 포함할 수 있다. 관리자 화면은 리뷰 수와 블로그 리뷰 수를 파싱해 학원 목록에 표시한다.

### `POST /api/admin/domains/{domain}/academies`

요청은 단일 객체, 객체 배열, 또는 `{ "items": [...] }`를 받을 수 있다.

리뷰 관련 입력 예:

```json
{
  "name": "예시 학원",
  "region": "서울",
  "review": "친절하다는 후기가 많음",
  "review_json": [
    { "point": 5, "content": "설명이 친절했어요" }
  ],
  "blog_reviews": [
    { "title": "방문 후기", "content": "시설이 깔끔했어요", "link": "https://example.com/review" }
  ]
}
```

응답:

```json
{ "ok": true, "upserted": 3 }
```

### `GET /api/admin/settings/blog-review-sync`

블로그리뷰 **수집** 스위치. `used_in_generation` 은 항상 `false` 다 — 켜도 생성 프롬프트
(`389ce0d`)와 T01 품질 게이트(`bfe5881`)에는 닿지 않는다. 화면이 이 사실을 서버 응답으로 확인해
안내 문구를 쓰도록 필드로 내려준다.

```json
{ "enabled": false, "configured": true, "used_in_generation": false }
```

- `configured` — 관리자 설정에 저장된 값이 있는지. `false` 면 환경변수 기본값을 따르는 중이다.

### `PUT /api/admin/settings/blog-review-sync`

`{ "enabled": true }` 를 보낸다. 저장 즉시 반영되며 API 재시작이 필요 없다 — 기동 중인 프로세스는
시작 시점의 `.env` 를 들고 있어서, 환경변수만으로는 재시작해야 하고 그러면 진행 중인 글 생성이 죽는다.

켜면 학원 동기화가 1~2분에서 14분으로 늘어난다(원천이 동시 요청을 못 견뎌 한 곳씩 받는다).
끄더라도 이미 저장된 `blog_reviews` 는 지워지지 않는다.

### `POST /api/admin/domains/{domain}/sync/drivingplus/academies`

동기화를 **백그라운드로 시작하고 `run_id` 를 즉시 반환한다.** 결과를 기다리지 않는다.

**`include_blog_reviews` 는 수집 스위치가 꺼져 있으면 무시된다.** 스위치는 관리자 설정
(`PUT /api/admin/settings/blog-review-sync`) → 환경변수 `DRIVINGPLUS_BLOG_REVIEW_SYNC` → 꺼짐
순으로 판단하며 기본이 꺼짐이라, 꺼진 상태에서는 요청이 `true` 를 보내도 켜지지 않는다.
원천이 네이버 블로그 검색으로 학원명을 느슨하게 매칭해 다른 학원 글이 섞이기 때문이다
(2026-07-27 실측 539건 중 55건은 학원 고유명이 글 어디에도 없고, 같은 글 18건이 이름이 비슷한
학원 2~3곳에 중복 배정). 글 생성에도 쓰지 않는다. 이미 저장된 블로그리뷰는 지워지지 않는다.

스위치를 켜면 학원 380곳 기준 12분 넘게 걸린다. 원천의 `/v1/blog-review/list` 가 동시 요청을 못
견뎌 한 곳씩 받아야 하기 때문이다(동시 1이면 전건 성공, 동시 4면 24곳 중 5곳만 성공). 그런데
Node fetch 는 헤더를 300초 안에 못 받으면 끊으므로(`UND_ERR_HEADERS_TIMEOUT`, 실측 301초),
응답을 기다리는 구조로는 관리자 UI 에서 완주할 수 없다 — 그래서 이 엔드포인트는 백그라운드다.

이미 진행 중인 동기화가 있으면 `409` 를 반환한다(도메인이 달라도 같은 원천을 두드리므로 하나만 허용).

요청:

```json
{
  "include_reviews": true,
  "review_limit": 5,
  "review_sort": "point",
  "include_blog_reviews": false,
  "blog_review_limit": 3
}
```

응답:

```json
{
  "ok": true,
  "run_id": "1b0c…"
}
```

### `GET /api/admin/domains/{domain}/sync/runs`

동기화 실행 이력. `?limit=` (기본 20, 최대 200).

```json
{ "items": [ { "id": "1b0c…", "status": "running", "step": "블로그리뷰 조회 중", "count_done": 42, "count_total": 380 } ] }
```

### `GET /api/admin/domains/{domain}/sync/runs/{runId}`

진행 상황 폴링용. `status` 는 `running` / `done` / `cancelled` / `error`.
완료 시 `result_obj` 에 저장 요약이 담긴다.

```json
{
  "id": "1b0c…",
  "status": "done",
  "step": "완료",
  "count_done": 380,
  "count_total": 380,
  "result_obj": {
    "fetched": 380,
    "upserted": 380,
    "skipped": 0,
    "review_count": 1223,
    "blog_review_count": 588,
    "blog_review_preserved": 3,
    "warnings": []
  },
  "error": null
}
```

`blog_review_preserved` 는 **블로그리뷰를 조회했는데 못 가져와 기존 값을 유지한 학원 수**다.
수집 스위치가 꺼져 있으면(기본) 애초에 조회하지 않으므로 항상 0 이다. 원천은 처리
한계를 넘으면 예외가 아니라 `code:200` + 빈 배열로 응답하므로, 이를 0건으로 받아들이면 전량교체
정책상 멀쩡한 후기가 삭제된다. 이 값이 크면 원천 상태를 의심해야 한다.

### `POST /api/admin/domains/{domain}/sync/runs/{runId}/cancel`

진행 중인 동기화에 취소를 요청한다. 취소되면 **저장 단계로 넘어가지 않으므로 기존 자료는 그대로**다
(절반만 조회한 목록으로 저장하면 아직 조회하지 않은 학원의 후기가 0건으로 지워진다).

```json
{ "ok": true }
```

### `POST /api/admin/domains/{domain}/sync/drivingplus/regions`

요청:

```json
{
  "level": "2",
  "replace_axis": true,
  "max": 10000
}
```

`level`은 `all`, `2`, `3` 중 하나다.

응답:

```json
{
  "ok": true,
  "level": "2",
  "axis_replaced": true,
  "fetched": 100,
  "upserted": 100,
  "skipped": 0
}
```

### `POST /api/admin/domains/{domain}/sync/drivingplus`

지역과 학원 데이터를 한 번에 동기화한다.

요청:

```json
{
  "level": "2",
  "replace_axis": true,
  "include_blog_reviews": false,
  "blog_review_limit": 3
}
```

지역은 원천 왕복 1회라 응답 안에서 끝내고, 학원은 위와 같은 백그라운드 run 으로 넘긴다.

응답:

```json
{
  "ok": true,
  "regions": {},
  "run_id": "1b0c…",
  "axis_replaced": true,
  "level": "2"
}
```

### `DELETE /api/admin/domains/{domain}/academies/{academy_id}`

응답:

```json
{ "ok": true, "deleted": 1 }
```

### `DELETE /api/admin/domains/{domain}/academies`

쿼리 `region`을 주면 그 지역만, 없으면 도메인 전체의 연결된 학원을 지운다. 응답 `{ ok, deleted }`.

### `POST /api/admin/domains/{domain}/academies/link`

업종 단위 조사 DB(`data/academy_research.db`)의 학원을 이 도메인 `academies`로 가져온다. **원천 API를 다시 부르지 않는다.** 도메인 제외 목록(`academy_exclusions`)에 있는 학원은 건너뛴다 — 그러지 않으면 운영자가 뺀 학원이 연결할 때마다 되살아난다. 응답에 `linked`·`skipped`·`removed`·`excluded`·`reviews`·`blog_reviews`가 담긴다.

이 시점에 **파생값이 계산돼 박힌다** — 주소로 지역을 배정하고(`bestRegionForAddress`) 셔틀 운행 지역을 문장으로 만든다(`formatShuttleFact`). 조사값만 갱신하고 다시 연결하지 않으면 글에 반영되지 않는다.

### `GET /api/admin/domains/{domain}/academy-exclusions`

이 도메인에서 뺀 학원 목록. 응답 `{ count, items }`.

### `DELETE /api/admin/domains/{domain}/academy-exclusions/{external_id}`

제외를 해제하고 즉시 재연결을 시도한다. 응답 `{ ok, removed, relinked, reason }`.

### `GET /api/admin/domains/{domain}/research-summary`

이 도메인이 쓰는 조사값의 현황 요약(항목별 건수·최신 시점).

### `GET /api/admin/domains/{domain}/source-freshness`

원천 동기화가 얼마나 최신인지(마지막 동기화 시점 등).

## 작업 큐

### `POST /api/admin/domains/{domain}/jobs/generate`

요청:

```json
{
  "slot_ids": ["slot-id-1"],
  "q": "서울",
  "template": "T01",
  "max": 10,
  "balanced": true,
  "provider": "codex",
  "model": "",
  "design_template_id": "local-guide",
  "use_web_research": true,
  "cooldown_sec": 60,
  "timeout_sec": 600,
  "enable_image_generation": false,
  "image_generation_required": false,
  "image_count": 1,
  "image_size": "1024x1024",
  "image_model": "",
  "image_provider": "private-codex"
}
```

동작:

- `slot_ids`가 있으면 해당 슬롯을 대상으로 큐에 넣는다.
- `slot_ids`가 없으면 `q`, `template`, `max`, `balanced` 기준으로 `planned` 슬롯을 자동 선택한다.
- 도메인의 제외 키워드에 걸리는 슬롯은 제외된다.

응답:

```json
{ "ok": true, "job_id": "...", "slot_count": 10 }
```

### `POST /api/admin/domains/{domain}/jobs/dedup`

요청:

```json
{ "threshold": 0.75, "dry_run": false }
```

응답:

```json
{ "ok": true, "job_id": "..." }
```

### `POST /api/admin/domains/{domain}/jobs/prune`

요청:

```json
{ "min_body_chars": 700, "stale_noindex_days": 90, "dry_run": false }
```

응답:

```json
{ "ok": true, "job_id": "..." }
```

### `POST /api/admin/domains/{domain}/jobs/indexing`

요청:

```json
{ "max": 200 }
```

응답:

```json
{ "ok": true, "job_id": "..." }
```

현재 워커는 색인 대상 URL을 수집하며, 실제 제출은 별도 연동이 추가되어야 한다.

### `GET /api/admin/jobs`

쿼리:

| 이름 | 설명 | 기본/제한 |
| --- | --- | --- |
| `domain` | 도메인 필터 | 선택 |
| `status` | 작업 상태 필터 | 선택 |
| `limit` | 목록 개수 | 기본 200, 최대 1000 |

응답:

```json
{ "count": 8, "items": [] }
```

### 잡 제어

| 엔드포인트 | 동작 |
| --- | --- |
| `POST /api/admin/jobs/{id}/cancel` | 취소. 응답은 `db.cancelJob`의 결과(`{ ok, state? }`) |
| `POST /api/admin/jobs/{id}/pause` | 일시중지. **대기(`queued`) 중인 잡만** 멈춘다 — 상태가 아니라 `jobs.paused` 컬럼이다 |
| `POST /api/admin/jobs/{id}/resume` | 재개(`paused=0`) |
| `POST /api/admin/jobs/{id}/prioritize` | 대기열 맨 앞으로(가장 이른 `scheduled_at`보다 1초 앞으로 당긴다) |

`pause`/`resume`/`prioritize`는 `{ "ok": true|false }`를 준다 — `false`는 조건에 맞는 잡이 없었다는 뜻이다(이미 실행 중이거나 없는 id).

## 학원 심층조사

`@Controller("api/admin/academy-research")` — **업종 단위**이며 도메인을 모른다. 저장소도 `data/academy_research.db`로 `admin.db`와 분리돼 있다.

아래 표의 경로는 모두 **`/api/admin/academy-research` 기준 상대 경로**다(예: `GET /list` → `GET /api/admin/academy-research/list`).

| 엔드포인트 | 동작 |
| --- | --- |
| `GET /list` | 학원 기본정보 목록. 쿼리 `region`·`q`. 응답 `{ count, region, items, hidden }` — `hidden`은 최신 동기화 목록에 없어 보관만 된 학원 수 |
| `GET /status-defs` | 검증 상태 정의 목록 |
| `GET /runs` · `GET /runs/{run_id}` | 조사·동기화 실행 이력(진행률 폴링용). 없으면 404 |
| `POST /runs/{run_id}/cancel` | 취소 요청. **즉시 끊지 않고 플래그만 세운다** — 처리 중이던 학원 1곳은 온전히 끝난다. 이미 종료면 409 |
| `POST /sync` | 원천 전체 동기화(기본정보+후기 원문). 백그라운드로 돌고 `run_id`를 즉시 반환. 바디 `review_limit`(기본 5) |
| `POST /sync/blog-reviews` | 블로그리뷰만 별도 실행(학원당 10초라 분리). 바디 `blog_review_limit`(기본 5). **수집 스위치가 꺼져 있으면 수집하지 않는다** |
| `POST /research/region` | 전체 AI 조사 시작(백그라운드, `run_id` 반환). 바디 `provider`(`auto`\|`codex`\|`claude`, 기본 `auto`)·`refresh_all`·`retry_only`·`limit`(최대 5000)·`offset`·`external_ids`(최대 2,000건) |
| `GET /review-queue` | 검토 대기 목록(학원을 가로질러 필드 단위). 쿼리 `status`(기본 `needs_review,ai_draft`)·`field`·`all_fields`·`q`·`limit`(기본 500). 기본은 **글에 나갈 수 있는 항목만** 본다 |
| `POST /field-meta/bulk` | 여러 항목 일괄 승인/되돌리기. 바디 `status`(필수)·`items`(필수, 최대 2000)·`note`. 응답 `{ ok, changed }` |
| `POST /manual` | 수동 등록(원천 목록에 없는 학원). 바디는 단건·배열·`{items}` 모두 받는다. 응답 `{ ok, created, external_ids, errors }` |
| `DELETE /manual/{external_id}` | **수동 등록분만** 삭제 가능(원천 미러는 다음 동기화에 되살아나므로 400) |
| `GET /{external_id}` | 학원 1곳의 조사 집계. 응답에 `source_facts`(원천이 이미 답을 가진 항목)를 함께 준다 — 없으면 화면이 "조사 실패"로 읽힌다 |
| `POST /{external_id}/sync` | 그 학원만 원천에서 다시 받기 |
| `POST /{external_id}/research` | 단건 AI 조사. **백그라운드로 시작하고 `run_id`만 준다** — 조사 1곳이 평균 85초, 최대 388초인데 관리자 프록시 fetch가 300초에 끊겨 "서버는 저장했는데 화면은 실패"가 됐던 자리다 |
| `POST /{external_id}/research-sync` | 요청 안에서 끝까지 기다리는 옛 경로(API 직접 호출 호환용, 화면은 쓰지 않는다). 소스 못 찾음은 실패가 아니라 `no_sources`로 반환 |
| `PATCH /{external_id}/field` | 조사값 수동 편집. 바디 `field`(필수)·`value`. 허용 목록 밖 필드는 400 |
| `PATCH /{external_id}/field-meta` | 필드별 검증 상태·출처 설정. 바디 `field_key`(필수)·`status`·`source_url`·`source_name`·`confidence`·`verified_by`·`note` |

라우트 선언 순서에 함정이 있다 — `review-queue`·`list` 같은 고정 경로는 `:externalId`보다 **먼저** 선언돼야 한다. 뒤에 두면 학원 id로 해석돼 경로가 먹지 않는다.

## 색인 설정

### `GET /api/admin/settings/indexing`

응답:

```json
{
  "has_key": false,
  "url_template": "https://{domain}/community/{slug}"
}
```

### `PUT /api/admin/settings/indexing`

요청:

```json
{
  "sa_json": "{...}",
  "url_template": "https://{domain}/community/{slug}"
}
```

`sa_json`은 `client_email`, `private_key`가 있는 서비스 계정 JSON 문자열이어야 한다.

응답:

```json
{
  "ok": true,
  "has_key": true,
  "url_template": "https://{domain}/community/{slug}"
}
```

## 작업환경 설정

| 엔드포인트 | 동작 |
| --- | --- |
| `PUT /api/admin/settings/builtin-visibility` | 카탈로그에 노출할 빌트인 글유형 id 목록. **폐기된 유형(`DEPRECATED_BUILTIN_TEMPLATE_IDS` = `T01`)은 넣어도 서버가 걸러낸다** — 판정을 서버에 둔 이유는 화면만 막으면 「전체 노출」·설정 삭제·API 직접 호출 세 경로로 되살아나기 때문이다 |
| `GET /api/admin/settings/region-directory` | 읍·면·동 전역 지역 사전 상태. 쿼리 `domain`을 주면 그 도메인의 셔틀 지역 커버리지를 함께 준다 |
| `POST /api/admin/settings/region-directory/sync` | 지역 사전 동기화 |
| `GET /api/admin/settings/verticals` | 업종 레지스트리 목록. 응답 `{ items }` |
| `POST /api/admin/settings/verticals` | 업종 추가. 응답 `{ ok, items }`. **도메인 생성은 여기 등록된 업종만 허용한다**(미등록은 「등록되지 않은 업종입니다」) |
| `DELETE /api/admin/settings/verticals/{key}` | 업종 삭제 |
| `GET /api/admin/runtime/apis` | 이 프로세스가 실제로 들고 있는 외부 API base URL 등. **기동 시점의 `.env`를 반영하므로** `.env`를 바꿨는데 값이 그대로면 프로세스를 재시작해야 한다는 뜻이다 |

## 글 인사이트

### `GET /api/admin/post-insight/{post_id}`

발행 글 1건의 근거 요약(관리자 「이 글의 근거」 화면). 어떤 학원 자료·조사값이 그 글에 들어갔는지 되짚는 읽기 전용 경로다.

## 공개 조회 API

공개 조회 API는 `/api/v1/{domain}` 아래에서 동작한다.

### `GET /api/v1/{domain}/site`

공개 사이트가 쓰는 도메인 요약(브랜드·base URL 등). 인증 없이 열려 있다.

### `GET /api/v1/{domain}/posts`

쿼리:

| 이름 | 설명 | 기본/제한 |
| --- | --- | --- |
| `limit` | 목록 개수 | 기본 50, 최대 100 |
| `offset` | 시작 위치 | 기본 0 |

응답:

```json
{
  "count": 10,
  "items": [
    {
      "id": "...",
      "domain": "example.com",
      "slot_id": "...",
      "slug": "sample-post",
      "title": "제목",
      "meta_description": "설명",
      "images": {},
      "design_template_id": "local-guide",
      "generated_at": "2026-06-23 00:00:00",
      "body_chars": 3000
    }
  ]
}
```

공개 목록은 `published` 상태 글만 반환한다.

### `GET /api/v1/{domain}/posts/{slug}`

쿼리:

| 이름 | 설명 |
| --- | --- |
| `include_rendered` | `true` 또는 `1`이면 `body_html` 포함 |

응답:

```json
{
  "post": {
    "id": "...",
    "domain": "example.com",
    "slug": "sample-post",
    "title": "제목",
    "meta_description": "요약",
    "body_markdown": "# 제목",
    "images": {},
    "design_template_id": "local-guide",
    "generated_at": "2026-01-01 00:00:00",
    "region": "경기도 안성시",
    "academy_names": ["○○자동차운전전문학원"]
  },
  "body_html": "<article>...</article>"
}
```

> 공개 상세 응답은 명시 화이트리스트만 포함한다. `provider`/`model`/`cost_usd`/`session_id`/`job_id`/토큰·시간 등 내부·비용 필드는 노출하지 않는다. `region`/`academy_names`는 소비 사이트의 JSON-LD 등 SEO 파생용이며, 값이 없으면 각각 `null`/`[]`이다.

### `GET /api/v1/{domain}/generated-images/{file}`

생성 이미지 PNG 파일을 반환한다. 파일명은 안전한 이미지 파일명만 허용된다.

### `GET /api/v1/{domain}/sitemap.xml`

쿼리:

| 이름 | 설명 |
| --- | --- |
| `base_url` | 사이트맵 URL 생성 기준 주소. 없으면 `https://{domain}` |

응답은 XML이다. 글 URL은 `/community/{slug}` 형식으로 만들어진다.

### `GET /api/v1/{domain}/academies`

쿼리:

| 이름 | 설명 | 기본/제한 |
| --- | --- | --- |
| `region` | 지역 부분 검색 | 선택 |
| `limit` | 목록 개수 | 기본 50, 최대 1000 |

응답:

```json
{ "count": 10, "items": [] }
```

`items`는 명시 화이트리스트로만 구성된다.

`id`, `region`, `name`, `address`, `price`, `shuttle`, `hours`, `pass_rate`, `phone`, `vphone`, `review`, `seo_title`, `seo_keywords`, `seo_description`, `latitude`, `longitude`, `thumb_url`, `photos`(배열로 파싱), `academy_type`, `synced_at`.

원천 흔적(`source_name`, `source_url`, `external_id`, `extra`), 리뷰 원문 페이로드(`review_json`, `blog_reviews`), 원천 마케팅 문구(`seo_content`)는 노출하지 않는다.

### `POST /api/v1/{domain}/academies`

공개 쓰기용 엔드포인트다. `PUBLIC_WRITE_TOKEN`이 설정되어 있으면 `token` 쿼리 또는 `x-public-write-token` 헤더가 일치해야 한다.

요청은 단일 객체, 객체 배열, 또는 `{ "items": [...] }`를 받을 수 있다.

응답:

```json
{ "ok": true, "upserted": 3 }
```

## 관리자 Next.js 클라이언트 사용 현황

`apps/admin-next/lib/api.ts`가 현재 쓰는 주요 호출은 다음과 같다.

| 함수 | API |
| --- | --- |
| `getOptions()` | `GET /options` |
| `listDomains()` | `GET /domains` |
| `getDomainDetail()` | `GET /domains/{domain}?include=slots,posts,academies,jobs&limit=500` |
| `listSlots()` | `GET /domains/{domain}/slots` |
| `listAcademies()` | `GET /domains/{domain}/academies` |
| `updateDomain()` | `PATCH /domains/{domain}` |
| `replaceAxis()` | `PUT /domains/{domain}/axes/{axis}` |
| `enqueueGenerate()` | `POST /domains/{domain}/jobs/generate` |
| `updateSlotTitle()` | `PATCH /domains/{domain}/slots/{slot_id}` |
| `listTemplates()` | `GET /domains/{domain}/templates` |
| `createTemplate()` | `POST /domains/{domain}/templates` |
| `updateTemplate()` | `PATCH /domains/{domain}/templates/{template_id}` |
| `cloneTemplate()` | `POST /domains/{domain}/templates/clone` |
| `getCoherence()` | `GET /domains/{domain}/templates/coherence` |
| `downloadPostExport()` | `POST /domains/{domain}/posts/export` |
| `syncDrivingplusAcademies()` | `POST /domains/{domain}/sync/drivingplus/academies` |
| `syncDrivingplusRegions()` | `POST /domains/{domain}/sync/drivingplus/regions` |

