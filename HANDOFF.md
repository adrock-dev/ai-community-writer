# 인수인계서 - Adrock Driving Content Ops

## 1. 프로젝트 개요

- 프로젝트명: Adrock Driving Content Ops
- 패키지명: `adrock-content-ops`
- 목적: 운전면허·운전학원 도메인 전용 SEO 콘텐츠 운영 시스템
- 구성:
  - `apps/api-nest`: NestJS API + worker + SQLite 저장소
  - `apps/admin-next`: Next.js 사내 관리자 UI
  - `integration/nextjs-community-kit`: 외부 Next.js 사이트 연동 예시
  - `docs`: API/소스 분석 문서
  - `scripts`: 생성 글 QA, 회사 제출용 clean 검증
  - `data`, `output`: SQLite DB/원천 자료/생성 산출물

현재 이 프로젝트는 범용 SEO 도구가 아니라 **운전면허·운전학원 도메인 전용 운영본**입니다. 새 도메인은 기본적으로 `driving` vertical, `local-guide` 디자인, 운전학원 축 프리셋으로 시작합니다.

## 2. 핵심 실행 명령

루트 기준:

```bash
npm run dev              # ./dev.sh 실행, API+worker+Admin 동시 기동
npm run typecheck        # API + Admin 타입체크
npm run build            # API + Admin 빌드
npm run audit:all        # 양쪽 npm audit high 이상 검사
npm run worker:once      # Nest worker 한 번 실행
npm run qa:posts         # published 글 QA
npm run qa:posts:all     # deleted 제외 전체 글 QA
npm run verify:company-clean
```

직접 실행:

```bash
cd apps/api-nest
API_WORKER=1 npm run dev

cd apps/admin-next
SEO_API_BASE_URL=http://127.0.0.1:8765 npm run dev
```

기본 주소:

- API: `http://127.0.0.1:8765`
- Admin: `http://localhost:3001`
- 공개 API 예시: `http://127.0.0.1:8765/api/v1/{domain}/posts`

## 3. 환경변수

주요 환경변수는 `.env.example`, `apps/api-nest/.env.example`, `apps/admin-next/.env.example`를 참고합니다.

| 변수 | 용도 | 비고 |
| --- | --- | --- |
| `ADMIN_HOST` | Nest API bind host | 기본 `127.0.0.1` |
| `ADMIN_PORT` | Nest API port | 기본 `8765` |
| `ADMIN_PASSWORD` | 관리자 API 보호 토큰 | 운영 필수 |
| `API_WORKER` | API 프로세스에서 worker 같이 실행 | `1`이면 같이 실행 |
| `SEO_API_BASE_URL` | Admin이 호출할 API base | 기본 `http://127.0.0.1:8765` |
| `ADMIN_API_TOKEN` | Admin proxy가 API로 전달할 토큰 | `ADMIN_PASSWORD`와 동일값 |
| `SEO_DB_PATH` | SQLite DB 경로 | 기본 `data/admin.db` 또는 Docker `/data/admin.db` |
| `PUBLIC_API_ORIGINS` | 공개 API CORS 허용 | 운영에서는 도메인 제한 권장 |
| `PUBLIC_WRITE_TOKEN` | 공개 학원 POST 보호 토큰 | 설정 시 token 필요 |
| `DRIVINGPLUS_API_BASE_URL` | 외부 학원/지역 원천 API | 기본 dev URL 존재 |
| `DRIVINGPLUS_API_TIMEOUT_MS` | 외부 API timeout | 기본 30000 |
| `WORKER_POLL_INTERVAL` | worker poll interval | 기본 3초 |

## 4. 주요 파일과 책임

| 경로 | 책임 |
| --- | --- |
| `apps/api-nest/src/admin.controller.ts` | 관리자 JSON API, 인증, 도메인/축/슬롯/글/학원/작업/설정 엔드포인트 |
| `apps/api-nest/src/public.controller.ts` | 공개 글/학원/sitemap/generated image API |
| `apps/api-nest/src/db.service.ts` | SQLite schema/migration/CRUD |
| `apps/api-nest/src/slot.service.ts` | 축 조합 기반 슬롯 생성, driving preset 적용 |
| `apps/api-nest/src/worker.service.ts` | generate/dedup/prune/indexing 작업 처리, LLM 호출, 품질 게이트 |
| `apps/api-nest/src/drivingplus-api.service.ts` | 외부 DrivingPlus 학원/지역 데이터 동기화 |
| `apps/api-nest/src/image-generation.service.ts` | Codex backend 기반 이미지 생성 선택 기능 |
| `apps/api-nest/src/constants.ts` | driving vertical, 템플릿, 디자인 템플릿, 프리셋 |
| `apps/admin-next/app/api/admin/[...path]/route.ts` | Admin Next → Nest API 프록시 |
| `apps/admin-next/components/DashboardClient.tsx` | 도메인 생성/대시보드 |
| `apps/admin-next/components/DomainClient.tsx` | 도메인 상세/생성/검수/설정 대부분의 UI |
| `apps/admin-next/components/JobsClient.tsx` | 작업 큐 UI |
| `apps/admin-next/components/PostDetailClient.tsx` | 글 상세/렌더링 확인 |
| `apps/admin-next/lib/api.ts` | Admin API client |
| `apps/admin-next/lib/types.ts` | UI 타입 계약 |
| `docs/admin-json-api.md` | 관리자 API 상세 명세 |
| `docs/source-analysis.md` | 현재 소스 구조 분석 |
| `scripts/qa-posts.mjs` | 생성 글 품질 QA |
| `scripts/verify-company-clean.mjs` | 회사 제출용 금지 흔적 검사 |

## 5. 관리자 화면 라우트

| 라우트 | 역할 |
| --- | --- |
| `/` | 대시보드, 도메인 목록/생성, 시작 플로우 |
| `/jobs` | 전체 작업 큐, 3초 폴링/수동 새로고침 |
| `/t/[domain]` | 도메인 상세 개요 |
| `/t/[domain]/generate` | 글 생성 중심 화면 |
| `/t/[domain]/posts` | 검수/내보내기 중심 화면 |
| `/t/[domain]/post/[postId]` | 글 상세/렌더 HTML 확인 |

## 6. 관리자 API 요약

Base: `/api/admin`

인증: `ADMIN_PASSWORD`가 있으면 아래 중 하나 필요.

- cookie `admin_token`
- header `x-admin-token`
- header `Authorization: Bearer <token>`

주요 엔드포인트:

- `GET /options`
- `GET/POST /domains`
- `GET/PATCH/DELETE /domains/:domain`
- `PUT /domains/:domain/axes/:axis`
- `POST /domains/:domain/axes/preset`
- `POST /domains/:domain/axes/ai-fill`
- `GET/POST /domains/:domain/slots`, `DELETE/POST reset /slots/:slotId`
- `GET /domains/:domain/posts`, `GET/DELETE /posts/:postId`, `POST /posts/export`
- `GET/POST/DELETE /domains/:domain/academies`
- `POST /domains/:domain/sync/drivingplus/*`
- `POST /domains/:domain/jobs/generate|dedup|prune|indexing`
- `GET /jobs`
- `GET/POST /settings/indexing`

상세 계약은 `docs/admin-json-api.md`를 기준으로 봅니다.

## 7. 공개 API 요약

Base: `/api/v1/:domain`

- `GET /posts`: 발행 글 목록
- `GET /posts/:slug`: 글 상세, `include_rendered=true` 지원
- `GET /generated-images/:file`: 생성 이미지 파일 제공
- `GET /sitemap.xml`: sitemap XML
- `GET /academies`: 공개 학원 목록
- `POST /academies`: 학원 자료 수신, `PUBLIC_WRITE_TOKEN` 설정 시 보호

## 8. 워커 흐름

작업 종류:

- `generate`: 슬롯 → facts 수집 → 선택 이미지 생성 → LLM 글 생성 → repair 시도 → 품질 게이트 → posts 저장
- `dedup`: 유사 글 감지, 낮은 품질/중복 글 noindex 후보 처리
- `prune`: 짧거나 품질 이슈가 있는 글 정리
- `indexing`: URL 수집. 실제 Google 제출은 아직 의도적으로 skip

LLM provider:

- `codex`: `codex exec` 사용
- `claude`: `claude --print` 사용

중요 주의:

- Codex/Claude CLI 인증이 로컬/컨테이너에 있어야 생성 가능.
- Docker 사용 시 `.claude`, `.codex` 마운트가 필요할 수 있음.
- 생성 품질 게이트 실패 시 `slots.last_error`, `jobs.error`를 확인.

## 9. 데이터베이스

기본 DB:

```text
data/admin.db
```

주요 테이블:

- `domains`
- `axes`
- `slots`
- `posts`
- `jobs`
- `app_settings`
- `academies`
- `seo_regions`

주의:

- `data/admin.db`, `data/admin.db-wal`, `data/admin.db-shm`은 운영 데이터이므로 백업 대상.
- DB 파일을 커밋/배포/공유할 때 민감정보 또는 외부 원천 자료 포함 여부를 확인해야 함.

## 10. 현재 운영 의도

이 시스템은 “무작정 글을 많이 찍어내는 도구”가 아니라, 다음 원칙으로 운전학원 SEO 글을 운영하려는 의도로 만들어졌습니다.

1. 운전학원 지역/키워드 축을 이용해 후보 슬롯을 만든다.
2. 실제 학원 데이터가 있는 지역은 해당 학원 자료를 근거로 작성한다.
3. 자료가 부족하면 억지 BEST 숫자를 만들지 않고 상담 체크리스트/확인 가이드 중심으로 쓴다.
4. 1개 테스트 글을 먼저 만들고 품질 확인 후 대량 생성한다.
5. 공개 글에는 내부 API/원천 시스템/데이터 처리 흔적을 남기지 않는다.
6. 생성 후 QA와 검수를 거쳐 외부 사이트로 내보낸다.

## 11. 알려진 리스크

- `DomainClient.tsx`가 매우 큰 컴포넌트라 유지보수 난이도가 높음.
- `getDomainDetail(...limit=500)`가 많은 데이터를 한 번에 불러 대형 도메인에서 느려질 수 있음.
- SQLite + 동기 DB 접근은 단순하지만 대규모 동시성에는 한계가 있음.
- Google Indexing 실제 제출은 미구현/보류.
- 외부 DrivingPlus API 기본값이 dev URL로 보이며 운영 endpoint 확정 필요.
- LLM provider는 로컬 CLI 인증에 의존.
- 생성 이미지 기능은 Codex auth/installation id/Backend API 접근에 의존.
- `output/`, `data/` 산출물에는 공개 전 QA가 필요한 글이 섞일 수 있음.

## 12. 다음 개발자 권장 순서

1. `npm run typecheck`, `npm run build`, `npm run verify:company-clean`로 현 상태 확인.
2. `.env`와 운영 환경변수 확정.
3. `ADMIN_PASSWORD`, `PUBLIC_WRITE_TOKEN`, `PUBLIC_API_ORIGINS` 운영 보안 설정.
4. 실제 운영 DB 백업/마이그레이션 정책 확정.
5. DrivingPlus API 운영 endpoint/인증/장애 대응 확인.
6. Codex/Claude provider 정책 확정.
7. `DomainClient` 기능별 분리.
8. 생성 글 승인/반려 workflow 도입 여부 결정.
9. Google Indexing 실제 제출을 구현할지 결정.
10. 공개 사이트 연동 키트를 실제 사이트에 맞게 적용.

## 13. 검증 기록

작성일: 2026-06-24

문서 작성 후 수행해야 하는 표준 검증:

```bash
npm run typecheck
npm run build
npm run verify:company-clean
```

`qa:posts`는 DB에 생성 글이 있는 운영/개발 상황에서 실행합니다.
