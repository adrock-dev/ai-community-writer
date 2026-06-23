# 관리자 JSON API

- 검토일: 2026-06-23
- 근거 코드: `apps/api-nest/src/admin.controller.ts`, `apps/api-nest/src/public.controller.ts`, `apps/api-nest/src/db.service.ts`, `apps/admin-next/lib/types.ts`, `apps/admin-next/lib/api.ts`

Nest API는 관리자 화면용 JSON API를 `/api/admin/*` 아래에 제공한다. 관리자 Next.js 앱은 자체 라우트 핸들러 `apps/admin-next/app/api/admin/[...path]/route.ts`를 통해 이 API로 프록시한다.

## 인증

`ADMIN_PASSWORD`가 설정되어 있으면 모든 관리자 JSON 엔드포인트는 아래 셋 중 하나를 받아야 한다.

- cookie: `admin_token=<ADMIN_PASSWORD>`
- header: `x-admin-token: <ADMIN_PASSWORD>`
- header: `Authorization: Bearer <ADMIN_PASSWORD>`

관리자 Next.js 프록시는 브라우저 쿠키, 브라우저 토큰, 서버 환경 변수 `ADMIN_API_TOKEN`을 Nest API로 전달한다.

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
| `academy_type_filter` | string[] | 학원 유형 필터 |
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
| `status` | `planned` \| `in_progress` \| `published` \| `failed` \| `pruned` | 슬롯 상태 |
| `last_error` | string \| null | 마지막 오류 |
| `created_at` | string | 생성 시각 |

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
| `blog_reviews` | 블로그 리뷰 배열을 JSON 문자열로 저장한 값. 보통 `title`, `content`, `link` 중심 | 블로그 리뷰 주제와 링크를 보조 근거로 포함 |

직접 upsert할 때는 `review_json` 또는 `reviews` 입력이 `review_json`에 저장되고, `blog_reviews` 입력은 JSON 문자열로 저장된다. 외부 학원 동기화는 일반 리뷰와 블로그 리뷰를 각각 정규화해 이 필드에 넣는다.

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
      "academy_type_filter": [],
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
    "pruned": 0
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
- `academy_type_filter`

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

`axis`는 `region`, `keyword`, `intent`, `persona`, `modifier` 중 하나다.

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

### `POST /api/admin/domains/{domain}/axes/ai-fill`

현재 Nest 런타임에서는 외부 축 생성 대신 도메인 업종 프리셋을 안전하게 다시 적용한다.

응답:

```json
{ "ok": true, "summary": { "applied_preset": "driving" }, "axes": {} }
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
    "pruned": 0
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

### `POST /api/admin/domains/{domain}/sync/drivingplus/academies`

요청:

```json
{
  "include_blog_reviews": true,
  "blog_review_limit": 3
}
```

응답:

```json
{
  "ok": true,
  "fetched": 100,
  "upserted": 95,
  "skipped": 5,
  "warnings": []
}
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
  "include_blog_reviews": true,
  "blog_review_limit": 3
}
```

응답:

```json
{
  "ok": true,
  "regions": {},
  "academies": {},
  "axis_replaced": true,
  "level": "2"
}
```

### `DELETE /api/admin/domains/{domain}/academies/{academy_id}`

응답:

```json
{ "ok": true, "deleted": 1 }
```

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

## 공개 조회 API

공개 조회 API는 `/api/v1/{domain}` 아래에서 동작한다.

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
    "slug": "sample-post",
    "title": "제목",
    "body_markdown": "# 제목",
    "images": {}
  },
  "body_html": "<article>...</article>"
}
```

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
| `downloadPostExport()` | `POST /domains/{domain}/posts/export` |
| `syncDrivingplusAcademies()` | `POST /domains/{domain}/sync/drivingplus/academies` |
| `syncDrivingplusRegions()` | `POST /domains/{domain}/sync/drivingplus/regions` |

