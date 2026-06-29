# 개발 맥락 문서 - Adrock Driving Content Ops

## 0. 이 문서의 목적

이 문서는 다음 개발자가 “왜 이렇게 만들었는지, 무엇을 써서 만들었는지, 앞으로 어디로 확장해야 하는지”를 빠르게 이해하도록 작성한 상세 개발 맥락 문서입니다.

이 프로젝트는 단순 Next 관리자나 단순 API 서버가 아닙니다. 다음 네 가지가 함께 동작하는 콘텐츠 운영 시스템입니다.

1. 운전면허·운전학원 도메인에 특화된 관리자 콘솔
2. SQLite 기반 데이터 저장소와 관리자/공개 API
3. Codex/Claude CLI를 호출하는 콘텐츠 생성 워커
4. 외부 Next.js 사이트에 붙일 수 있는 공개 콘텐츠 API/렌더링 키트

현재 저장소에는 이미 `DESIGN.md`, `INDEX.md`, `DEPLOY.md`, `docs/admin-json-api.md`, `docs/source-analysis.md`가 있었고, 이 문서는 그 내용을 실제 코드 기준으로 이어받아 “의도와 방향성” 중심으로 정리합니다.

---

## 1. 이 프로젝트를 만든 의도

프로젝트의 목적은 운전면허·운전학원 관련 SEO 콘텐츠를 반복적으로 만들고 관리하는 것입니다.

하지만 중요한 점은 “자동 글 양산” 자체가 목적이 아니라는 것입니다. 현재 코드의 여러 품질 게이트와 기본 content brief를 보면, 의도는 다음에 가깝습니다.

> 검증된 학원 데이터와 지역/키워드 축을 기반으로, 운영자가 안전하게 글 후보를 만들고, 테스트 생성 후 검수·내보내기까지 수행하는 내부 콘텐츠 운영 콘솔.

즉 다음을 해결하려는 도구입니다.

- 지역별 운전학원/운전면허 키워드가 많다.
- 사람이 모든 조합을 수작업으로 기획하기 어렵다.
- 그렇다고 검증되지 않은 가격/합격률/셔틀 정보를 임의로 쓰면 위험하다.
- 생성된 글이 내부 데이터 흔적을 노출하면 안 된다.
- 운영자는 작업 큐와 실패 원인을 봐야 한다.
- 외부 공개 사이트는 최종 글만 API로 받아 렌더링해야 한다.

그래서 현재 시스템은 다음 흐름을 갖습니다.

```text
도메인 생성
→ driving 프리셋 적용
→ 지역/키워드/의도/페르소나/수식어 축 준비
→ 학원 자료 동기화/입력
→ 슬롯 생성
→ 1개 테스트 글 작성
→ 품질 게이트/검수
→ 대량 생성
→ 글 내보내기/공개 API 제공
```

---

## 2. 왜 운전 도메인 전용으로 좁혔는가

`constants.ts`와 `admin.controller.ts`를 보면 현재 vertical은 사실상 `driving`만 허용합니다.

```ts
export const DRIVING_VERTICALS = ["driving"] as const;
```

도메인 생성 시에도 다른 vertical이면 거부합니다.

이렇게 한 이유는 다음으로 해석됩니다.

1. 회사 제출/운영본에서 범용 서비스 흔적을 제거하려는 목적
2. 운전면허·운전학원 글은 필요한 데이터와 위험한 claim이 명확함
3. 템플릿, 지역/키워드 프리셋, 학원 데이터, QA 규칙을 한 도메인에 맞춰 강하게 최적화할 수 있음
4. 범용화보다 실제 운영 가능한 한 분야의 품질을 우선함

이 방향은 유지하는 것이 좋습니다. 당장 다른 업종으로 확장하려고 하면 다음이 모두 바뀌어야 합니다.

- 프리셋 축
- 템플릿 종류
- 외부 데이터 모델
- 품질 게이트
- 금지 claim
- 공개 글 렌더링 정책
- 회사 clean 검증 규칙

따라서 다음 개발자는 이 프로젝트를 “범용 SEO 툴”로 착각하지 말아야 합니다.

---

## 3. 왜 Nest API + Next Admin 구조인가

현재 구조:

```text
apps/api-nest      # API, worker, DB
apps/admin-next    # 사내 관리자 UI
```

이 분리는 다음 의도가 있습니다.

### 3.1 Nest API의 역할

Nest API는 실제 운영 데이터와 작업을 책임집니다.

- 도메인/축/슬롯/글/학원/작업 저장
- SQLite schema/migration
- 외부 학원 데이터 동기화
- 워커 큐 처리
- 공개 API 제공
- 인증 처리

즉, 시스템의 기준 source of truth는 Nest API + SQLite입니다.

### 3.2 Next Admin의 역할

Next Admin은 운영자에게 API를 안전하게 조작하는 UI를 제공합니다.

중요한 점은 브라우저가 Nest API를 직접 호출하지 않고, Next route handler가 프록시한다는 것입니다.

파일:

```text
apps/admin-next/app/api/admin/[...path]/route.ts
```

의도:

- CORS/토큰 노출을 줄인다.
- `ADMIN_API_TOKEN`을 서버 측에서 Nest API로 전달할 수 있다.
- 운영자는 Admin UI만 접근하면 된다.

---

## 4. 왜 SQLite를 쓰는가

현재 DB는 기본적으로 `data/admin.db` SQLite 파일입니다.

의도:

- 로컬/단일 서버 운영이 쉽다.
- 별도 DB 서버 없이 빠르게 배포 가능하다.
- 콘텐츠 운영 도구 초기 단계에서 schema와 데이터를 빠르게 바꿀 수 있다.
- Docker에서는 `/data/admin.db` 볼륨으로 보존 가능하다.

장점:

- 설치/운영 단순
- 백업이 파일 단위로 쉬움
- 개발자 로컬 재현이 쉬움

한계:

- 대규모 동시 쓰기에는 적합하지 않음
- 여러 API 인스턴스가 같은 DB를 안정적으로 공유하기 어려움
- 작업 큐도 DB 테이블 기반이라 대량/분산 워커에는 한계

향후 트래픽/작업량이 커지면 Postgres + 별도 큐(BullMQ, SQS 등)로 이전하는 것이 자연스럽습니다. 하지만 현재 단계에서는 SQLite가 MVP 운영 속도에 맞는 선택입니다.

---

## 5. 현재 사용한 API와 외부 의존성

## 5.1 관리자 API

Base:

```text
/api/admin
```

주요 책임:

- 운영자 UI가 사용하는 JSON API
- `ADMIN_PASSWORD` 기반 보호

인증 방식:

- cookie `admin_token`
- header `x-admin-token`
- header `Authorization: Bearer`

사용 의도:

- 사내 관리자만 접근해야 하는 도메인/글/작업/설정 관리 API
- Next Admin proxy가 토큰을 전달

중요 엔드포인트:

```text
GET  /api/admin/options
GET  /api/admin/domains
POST /api/admin/domains
GET  /api/admin/domains/:domain
PATCH /api/admin/domains/:domain
DELETE /api/admin/domains/:domain
PUT  /api/admin/domains/:domain/axes/:axis
POST /api/admin/domains/:domain/axes/preset
POST /api/admin/domains/:domain/slots/generate
GET  /api/admin/domains/:domain/slots
POST /api/admin/domains/:domain/jobs/generate
POST /api/admin/domains/:domain/jobs/dedup
POST /api/admin/domains/:domain/jobs/prune
POST /api/admin/domains/:domain/jobs/indexing
GET  /api/admin/jobs
GET  /api/admin/settings/indexing
POST /api/admin/settings/indexing
```

상세는 `docs/admin-json-api.md`를 기준으로 유지해야 합니다.

## 5.2 공개 API

Base:

```text
/api/v1/:domain
```

의도:

- 외부 공개 사이트가 발행 글과 학원 데이터를 가져갈 수 있게 함
- 관리자 API와 분리
- 공개 가능한 데이터만 제공

주요 엔드포인트:

```text
GET  /api/v1/:domain/posts
GET  /api/v1/:domain/posts/:slug
GET  /api/v1/:domain/generated-images/:file
GET  /api/v1/:domain/sitemap.xml
GET  /api/v1/:domain/academies
POST /api/v1/:domain/academies
```

주의:

- `POST /academies`는 `PUBLIC_WRITE_TOKEN` 설정 시 token 또는 `x-public-write-token` 필요.
- 공개 API CORS는 `PUBLIC_API_ORIGINS`로 운영 도메인만 허용하는 것이 좋다.

## 5.3 DrivingPlus 외부 API

파일:

```text
apps/api-nest/src/drivingplus-api.service.ts
```

환경변수:

```text
DRIVINGPLUS_API_BASE_URL
DRIVINGPLUS_API_TIMEOUT_MS
```

기본값은 dev URL로 보입니다.

의도:

- 운전학원 자료와 지역 데이터를 외부 원천에서 동기화
- 일반 리뷰, 블로그 리뷰, 사진, 주소, 전화, 학원 유형 등 생성 근거 확보

주의:

- 운영 endpoint와 인증 방식 확정 필요
- 외부 API 장애 시 관리자 sync 기능 실패 가능
- 가져온 데이터 품질이 글 품질을 좌우함

## 5.4 LLM CLI API

워커는 SDK가 아니라 로컬 CLI를 호출합니다.

Provider:

- `codex`: `codex exec`
- `claude`: `claude --print`

의도:

- 기존 로컬 인증/CLI 환경을 활용
- provider를 선택 가능하게 함
- API key를 앱 코드에 직접 넣지 않음

주의:

- 컨테이너/서버에서 CLI 설치와 인증 필요
- `timeout_sec` 설정 중요
- provider별 stdout format parsing 실패 가능성 고려 필요

## 5.5 Codex 이미지 생성 backend

파일:

```text
apps/api-nest/src/image-generation.service.ts
```

의도:

- 선택적으로 글용 이미지를 생성해 `[IMAGE:key]` 슬롯에 연결
- Codex auth 파일과 installation id를 사용

환경/의존:

- `CODEX_HOME`
- `CODEX_AUTH_FILE`
- `CODEX_INSTALLATION_ID_FILE`
- `CODEX_IMAGEGEN_PROVIDER`
- `CODEX_IMAGEGEN_MODEL`
- `SEO_PUBLIC_ASSET_BASE_URL` 또는 `SEO_API_BASE_URL`

주의:

- 이미지 생성은 선택 기능입니다.
- 인증 누락 시 warning/fail 처리가 필요합니다.
- 공개 URL base 설정이 잘못되면 외부 사이트에서 이미지가 깨질 수 있습니다.

## 5.6 Google Indexing 설정

관리자에는 indexing 설정 API가 있고, 워커에는 indexing job이 있습니다.

현재 코드상 중요한 점:

- `google_sa_json` 설정 저장 가능
- `indexing_url_template` 저장 가능
- 워커는 URL을 수집하지만 실제 Google 제출은 의도적으로 skip

즉 현재 색인 기능은 “완성된 자동 제출”이 아닙니다.

앞으로 구현하려면:

- Google Indexing API service account 연동
- URL_UPDATED/URL_DELETED 제출
- 제출 결과 저장
- quota/error handling
- dry-run 옵션

---

## 6. 관리자 UI를 이렇게 만든 의도

관리자 UI는 예쁜 랜딩이 아니라 작업 콘솔입니다.

### 6.1 대시보드

의도:

- 운영자가 도메인 상태를 보고 바로 다음 작업으로 이동
- 도메인 생성과 최근 작업 확인
- “무엇부터 하면 되는지”를 보여주는 시작점

### 6.2 도메인 상세

`DomainClient`가 대부분의 기능을 담당합니다.

의도:

- 한 도메인 안에서 축, 학원자료, 슬롯, 글, 작업, 설정을 연결해 운영
- 도메인별 workflow를 유지
- 생성/검수/설정이 분리되어도 같은 데이터 맥락을 공유

현재 문제:

- 파일이 너무 큼
- 상태/로딩/API 호출/렌더링 책임이 한 컴포넌트에 몰려 있음

향후 방향:

- 기능별 패널로 분리하되, API 정책이 더 안정된 뒤 진행

### 6.3 작업 큐 화면

의도:

- 생성은 긴 시간이 걸리므로 즉시 응답형 UI가 아니라 큐 기반으로 처리
- 운영자가 `queued/running/done/failed`를 확인
- payload/result/error를 보고 원인을 파악

### 6.4 글 상세 화면

의도:

- 생성된 Markdown과 렌더 HTML을 확인
- 외부 공개 사이트에서 어떻게 보일지 사전 검수
- 내보내기 전 품질 확인

---

## 7. 워커와 품질 게이트의 의도

이 프로젝트에서 가장 중요한 부분은 `worker.service.ts`입니다.

생성 흐름은 단순히 LLM에 프롬프트를 던지는 구조가 아닙니다.

대략 흐름:

```text
job payload 확인
→ slot 선택
→ region 기반 학원 facts 수집
→ 이미지 슬롯 수집/선택 생성
→ LLM 생성
→ Markdown normalize
→ 품질 gate 검사
→ repair prompt 재시도
→ 제외 키워드 검사
→ 최종 surface gate
→ posts 저장
→ slot published/failed 반영
```

품질 게이트가 보는 것:

- H1 존재
- 본문 길이
- H2 구조
- 표/목록/FAQ 등 rich structure
- 내부 API/원천 데이터 문구 노출 여부
- 위험한 과장 claim
- 이미지 슬롯 사용 여부
- 실제 후보 수보다 부풀린 BEST 숫자
- 금지/제외 키워드 포함 여부

의도:

- LLM이 실수해도 바로 발행하지 않도록 방어
- 생성 실패를 실패로 기록해 운영자가 확인 가능하게 함
- 내부 데이터 언어를 공개 글에서 제거

다음 개발자가 반드시 유지해야 하는 방향:

- 품질 게이트를 우회하지 말 것
- 실패를 숨기고 published 처리하지 말 것
- repair를 무한 반복하지 말 것
- 검증되지 않은 학원 정보 claim을 허용하지 말 것

---

## 8. 슬롯/템플릿 설계 의도

템플릿은 `T01`~`T15`로 구성되어 있습니다.

예:

- `T01`: 지역 운전학원 BEST 비교
- `T03`: 운전면허 가이드 총정리
- `T05`: 비용 및 시간 절약 전략
- `T07`: 지역 허브 총정리
- `T14`: 전문학원 단독 소개

슬롯은 다음 축의 조합입니다.

- region
- keyword
- intent
- persona
- modifier

의도:

- 검색 수요를 지역/키워드/의도 단위로 분해
- 글 후보를 사람이 하나씩 기획하지 않고 자동 생성
- 단, `priority_score`, `excluded_keywords`, 기존 슬롯 중복 등을 통해 무작정 늘리지 않음

주의:

- 템플릿 추가 시 worker prompt, QA, 공개 렌더링까지 같이 봐야 함
- BEST 숫자와 실제 학원 후보 수 불일치가 가장 큰 리스크 중 하나

---

## 9. 데이터 동기화 의도

학원 데이터는 글의 사실 근거입니다.

현재 모델은 다음 데이터를 받습니다.

- 학원명
- 주소
- 전화/가상전화
- 가격
- 셔틀
- 운영시간
- 합격률
- 일반 리뷰
- 리뷰 JSON
- 블로그 리뷰
- 사진
- 위경도
- 학원 유형
- source URL/name

의도:

- 글 생성 시 “확인 가능한 정보”만 사용하기 위함
- 지역별 후보 수를 정확히 알고 BEST 숫자 부풀림 방지
- 이미지 슬롯을 실제 학원 사진과 연결
- 후기는 보조 근거로만 사용

주의:

- 외부 API 데이터가 틀리면 글도 틀릴 수 있음
- 가격/셔틀/합격률은 반드시 데이터가 있을 때만 단정해야 함
- 원천명/내부 API URL은 공개 글에 나오면 안 됨

---

## 10. 공개 사이트 연동 방향

`integration/nextjs-community-kit`은 공개 사이트가 이 API를 붙이는 예시입니다.

의도:

- 콘텐츠 운영 서버와 공개 사이트를 분리
- 공개 사이트는 `/api/v1/:domain/posts`를 읽어 목록/상세/sitemap 구성
- 공개 렌더링 로직은 `post-rendering.ts` 또는 kit 컴포넌트를 참고

향후 실제 적용 시:

- 공개 사이트 도메인에 맞게 `PUBLIC_API_ORIGINS` 제한
- `base_url`이 실제 URL로 sitemap에 반영되게 설정
- 이미지 URL base가 외부에서 접근 가능한지 확인
- noindex/deleted 글이 노출되지 않는지 확인

---

## 11. 앞으로의 방향성

### 11.1 단기: 운영 안정화

우선순위:

1. `ADMIN_PASSWORD` 필수화
2. `PUBLIC_API_ORIGINS` 운영 도메인 제한
3. `PUBLIC_WRITE_TOKEN` 설정
4. DB 백업 정책 수립
5. DrivingPlus 운영 API 확정
6. provider/model 기본값 확정
7. `npm run verify:company-clean`을 배포 전 필수화
8. `npm run qa:posts`를 발행 전 필수화

### 11.2 중기: 유지보수성 개선

- `DomainClient` 기능별 분리
- API client를 기능별 module로 분리
- 도메인 상세 데이터 include/limit 최적화
- 작업 실패 원인 UI 개선
- 품질 게이트 결과를 관리자에서 더 잘 보여주기
- 승인/반려 상태 추가 검토

### 11.3 장기: 운영 확장

- SQLite → Postgres 검토
- DB jobs → 전용 큐 시스템 검토
- Google Indexing 실제 제출 구현
- 외부 API 동기화 스케줄러 추가
- 다중 도메인/다중 운영자 권한 체계
- 콘텐츠 버전 관리/수정 이력

---

## 12. 다음 개발자가 주의할 것

1. `driving` 전용이라는 제약을 함부로 제거하지 말 것.
2. 품질 게이트를 약화하지 말 것.
3. 내부 API/원천 시스템명 공개 노출 방지 규칙을 유지할 것.
4. 대량 생성 전 1개 테스트 생성 흐름을 유지할 것.
5. `data/admin.db`는 코드가 아니라 운영 데이터라는 점을 기억할 것.
6. Codex/Claude CLI 인증 없는 환경에서 worker 생성이 실패할 수 있음을 문서화할 것.
7. 공개 API와 관리자 API를 혼동하지 말 것.
8. `verify-company-clean`이 잡는 금지 흔적은 회사 제출/운영본 요구사항으로 보고 유지할 것.

---

## 13. 배포 전 체크리스트

- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run verify:company-clean`
- [ ] `npm run qa:posts` 또는 `npm run qa:posts:all`
- [ ] `.env` 운영값 확인
- [ ] `ADMIN_PASSWORD` 설정
- [ ] `ADMIN_API_TOKEN` 설정
- [ ] `PUBLIC_API_ORIGINS` 제한
- [ ] `PUBLIC_WRITE_TOKEN` 설정
- [ ] DB 백업 확인
- [ ] Codex/Claude 인증 확인
- [ ] 외부 API endpoint 확인
- [ ] 공개 사이트에서 `/api/v1/:domain/posts`, `/sitemap.xml` 확인
- [ ] 생성 글 내부 흔적/과장 claim 수동 검수

---

## 14. 핵심 요약

이 프로젝트는 운전면허·운전학원 SEO 콘텐츠를 안전하게 만들기 위한 내부 운영 시스템입니다.

지금까지의 작업 의도는 다음입니다.

- 범용 도구가 아니라 driving 도메인 전용으로 좁혀 품질을 높인다.
- 지역/키워드/의도/페르소나/수식어 축으로 글 후보를 만든다.
- 실제 학원 데이터와 리뷰/사진을 근거로 글을 작성한다.
- Codex/Claude CLI를 worker에서 호출해 글을 생성한다.
- 품질 게이트로 내부 흔적, 과장 claim, 구조 부족, 이미지 누락을 막는다.
- 관리자 UI는 대시보드, 도메인 운영, 작업 큐, 글 검수로 구성한다.
- 공개 사이트는 `/api/v1/:domain` 공개 API로 최종 글을 가져간다.

앞으로는 “더 많은 글 생성”보다 “운영 안정성, 품질 검수, API/DB/보안 체계 정리”가 우선입니다.
