# Adrock Driving Content Ops 기획/디자인 문서

## Source of truth
- Status: Active
- Last refreshed: 2026-06-24
- Primary product surfaces:
  - NestJS 관리자/공개 API: `apps/api-nest`
  - Next.js 사내 관리자: `apps/admin-next`
  - 외부 공개 사이트 연동 키트: `integration/nextjs-community-kit`
  - 운영 산출물/데이터: `data/`, `output/`
- Evidence reviewed:
  - `INDEX.md`, `DEPLOY.md`, `docs/admin-json-api.md`, `docs/source-analysis.md`
  - `apps/api-nest/src/admin.controller.ts`, `public.controller.ts`, `db.service.ts`, `slot.service.ts`, `worker.service.ts`, `constants.ts`, `drivingplus-api.service.ts`, `image-generation.service.ts`
  - `apps/admin-next/app/*`, `components/*`, `lib/api.ts`, `lib/types.ts`, `app/globals.css`
  - `scripts/qa-posts.mjs`, `scripts/verify-company-clean.mjs`
  - `.env.example`, `dev.sh`, `docker-compose.yml`
- 작성 기준:
  - 이 문서는 현재 구현된 소스와 기존 문서를 기준으로 정리한 운영/디자인 기준서입니다.
  - 실제 고객사 운영 정책, API 인증값, 발행 도메인, 색인 제출 정책은 저장소에 확정값이 없으므로 Open questions로 분리합니다.

## Brand
- Personality:
  - 내부 운영자가 대량 SEO 콘텐츠를 안전하게 생성·검수·발행하도록 돕는 신뢰형 운영 도구.
  - 운전면허·운전학원 도메인에 특화된 “검증된 자료 기반 콘텐츠 운영 콘솔”.
  - 화려한 소비자 서비스보다 작업 상태, 데이터 근거, 실패 원인, 다음 액션을 명확히 보여주는 실무형 톤.
- Trust signals:
  - 작업 큐 상태(`queued`, `running`, `done`, `failed`)와 결과 payload 표시.
  - 슬롯/글/학원 자료/축/설정의 단계별 관리.
  - 품질 게이트, 제외 키워드, 회사 제출용 clean 검증 스크립트.
  - 공개 API와 관리자 API 계약 문서화.
- Avoid:
  - “자동으로 무조건 고품질 글 생성”처럼 과장된 표현.
  - 검증되지 않은 가격·합격률·셔틀 정보를 단정하는 콘텐츠 생성.
  - 내부 API명, 원천 시스템명, 내부 데이터 경로가 공개 글에 노출되는 구조.
  - 운영자가 현재 단계와 위험도를 모르는 상태에서 대량 생성 버튼을 누르게 하는 UX.

## Product goals
- Goals:
  - 운전면허·운전학원 도메인의 지역/키워드 기반 SEO 글을 대량으로 기획, 생성, 검수, 발행 가능 상태로 관리한다.
  - 운영자가 도메인 생성 → 데이터 동기화 → 축/슬롯 준비 → 테스트 글 생성 → 대량 생성 → 검수/내보내기 → 색인 요청 흐름을 하나의 콘솔에서 수행하게 한다.
  - 검증된 학원 자료만 사용해 가격·셔틀·합격률 등 민감 정보를 보수적으로 작성한다.
  - 외부 Next.js 사이트가 공개 API로 발행 글을 가져가 렌더링할 수 있게 한다.
- Non-goals:
  - 모든 업종을 지원하는 범용 programmatic SEO 도구가 아니다. 현재 운영본은 `driving` 도메인 전용이다.
  - 사람 편집자의 최종 판단을 완전히 대체하지 않는다.
  - Google Indexing API 실제 제출은 현재 워커에서 의도적으로 보류되어 있으며, URL 수집/설정 저장까지만 존재한다.
  - 외부 원천 API 인증/가용성/데이터 품질을 보장하지 않는다.
- Success signals:
  - 신규 도메인이 별도 개발 없이 관리자에서 생성되고 driving 프리셋이 적용된다.
  - 운영자가 1개 테스트 글을 생성하고 QA 결과를 확인한 뒤 대량 생성으로 확장할 수 있다.
  - 생성 글이 내부 데이터 노출, 과장 claim, 이미지 슬롯 누락 등 품질 게이트를 통과한다.
  - 공개 API로 게시글 목록/상세/sitemap이 안정적으로 조회된다.
  - 실패한 작업은 원인과 복구 액션이 관리자 UI에서 확인된다.

## Personas and jobs
- Primary personas:
  - 콘텐츠 운영 매니저: 도메인과 생성 흐름을 관리하고 발행 후보를 검수한다.
  - SEO 운영자: 지역/키워드/템플릿 축을 조합해 검색 수요 기반 글 후보를 만든다.
  - 기술 담당자: API, 워커, DB, 외부 동기화, 배포, 장애 복구를 담당한다.
  - 외부 사이트 개발자: 공개 API를 기존 Next.js 사이트에 연결한다.
- User jobs:
  - 도메인을 생성하고 운전학원 도메인 기본값을 적용한다.
  - 외부 DrivingPlus/학원 데이터를 동기화한다.
  - 지역·키워드·의도·페르소나·수식어 축을 확인/수정한다.
  - 글 후보 슬롯을 만들고 우선순위/상태를 확인한다.
  - 1개 테스트 글로 품질을 확인한 뒤 10개/100개 단위로 확장한다.
  - 완료 글을 검수하고 Markdown/HTML로 내보낸다.
  - 공개 API/사이트맵/연동 키트로 공개 사이트에 붙인다.
- Key contexts of use:
  - 데스크톱 관리자 브라우저 중심.
  - 장시간 작업 큐/워커 실행이 있는 백오피스 환경.
  - 로컬 개발 또는 Docker 단일 API 컨테이너 운영.
  - Codex/Claude CLI 인증 상태에 따라 생성 가능성이 달라지는 개발자 운영 환경.

## Information architecture
- Primary navigation:
  - 관리자 대시보드 `/`
  - 작업 큐 `/jobs`
  - 도메인 개요 `/t/[domain]`
  - 글 생성 중심 `/t/[domain]/generate`
  - 검수/내보내기 중심 `/t/[domain]/posts`
  - 글 상세 `/t/[domain]/post/[postId]`
- Core backend surfaces:
  - 관리자 JSON API: `/api/admin/*`
  - 공개 콘텐츠 API: `/api/v1/:domain/*`
  - 워커 큐: `jobs` table + `WorkerService`
  - SQLite 원천 DB: 기본 `data/admin.db`, 환경변수 `SEO_DB_PATH`로 변경 가능
- Content hierarchy:
  1. 도메인/운영 상태
  2. 데이터 준비 상태(학원 자료, 축, 슬롯)
  3. 생성 옵션(provider, model, 웹자료, 이미지 생성, timeout/cooldown)
  4. 작업 큐 상태와 실패 원인
  5. 발행 글 검수/내보내기/공개 API

## Design principles
- Principle 1: 안전한 다음 액션을 먼저 보여준다.
  - 대량 생성보다 1개 테스트 작성, QA 확인, 조건부 확장을 권장한다.
- Principle 2: 운영 판단에 필요한 상태를 숨기지 않는다.
  - 슬롯 수, planned/published 집계, 작업 큐, payload/result, 실패 원인을 노출한다.
- Principle 3: 운전학원 도메인의 데이터 진실성을 우선한다.
  - 실제 학원명·주소·전화·사진·리뷰 등 확인된 자료만 근거로 사용한다.
  - 가격·셔틀·합격률은 데이터가 있을 때만 단정한다.
- Principle 4: 공개 글에는 내부 흔적을 절대 남기지 않는다.
  - 내부 API, 원천 시스템명, “검증된 자료” 같은 작성자용 문구가 발행 글에 나오면 실패로 본다.
- Tradeoffs:
  - 운영자 편의를 위해 많은 컨트롤을 한 화면에 두었지만, `DomainClient` 책임이 커져 유지보수 부담이 있다.
  - 빠른 MVP를 위해 SQLite와 로컬 CLI 기반 워커를 사용하지만, 다중 인스턴스/대규모 큐에는 별도 큐/DB 설계가 필요하다.

## Visual language
- Color:
  - 관리자 기본 배경 `#f6f7fb`, 패널 흰색, 라인 `#e5e7eb`.
  - primary 보라/블루 `#5132d7`, success green, warning amber, danger red.
- Typography:
  - 시스템 sans 기반 한국어 백오피스 톤.
  - 수치/상태/ID에는 compact table typography와 monospace 보조 사용.
- Spacing/layout rhythm:
  - 카드형 섹션, 16px grid gap, 18px card padding.
  - 좌측 사이드바 + 메인 콘텐츠의 데스크톱-first layout.
- Shape/radius/elevation:
  - 16px radius 카드, 11~14px 버튼/입력 반경, 은은한 shadow.
- Motion:
  - 사이드바 접힘, 카드 hover 정도의 짧은 transition만 사용.
  - 생성/큐 상태는 애니메이션보다 텍스트/상태 배지 중심.
- Imagery/iconography:
  - 관리자 UI는 장식 이미지 최소화.
  - 공개 글 렌더링은 학원 사진/생성 이미지 슬롯을 활용할 수 있음.

## Components
- Existing components to reuse:
  - Admin: `AppShell`, `DashboardClient`, `DomainClient`, `JobsClient`, `PostDetailClient`
  - CSS primitives: `card`, `btn`, `badge`, `tabs`, `workflow`, `writer-hint`, `table-wrap`, `flow-card`, `next-action`
  - API client: `apps/admin-next/lib/api.ts`
  - Shared types: `apps/admin-next/lib/types.ts`
- New/changed components recommended:
  - `DomainClient` 내부를 `AxesPanel`, `AcademiesPanel`, `SlotsPanel`, `JobsPanel`, `PostsPanel`, `SettingsPanel`로 분리.
  - 생성 옵션을 `GenerationOptionsCard`로 분리.
  - 품질 게이트/QA 결과를 별도 `QualityReport`로 시각화.
- Variants and states:
  - Provider: `codex`, `claude`
  - Job kind: `generate`, `dedup`, `prune`, `indexing`
  - Job status: `queued`, `running`, `done`, `failed`
  - Slot status: `planned`, `in_progress`, `published`, `failed`, `pruned`
  - Post status: `published`, `noindex`, `deleted`
- Token/component ownership:
  - CSS 변수는 `apps/admin-next/app/globals.css`가 소유.
  - 운영 API 계약은 `docs/admin-json-api.md`와 `apps/api-nest/src/admin.controller.ts`가 기준.
  - 생성 정책/템플릿/프리셋은 `apps/api-nest/src/constants.ts`와 `worker.service.ts`가 기준.

## Accessibility
- Target standard:
  - 내부 관리자 기준 practical WCAG AA.
- Keyboard/focus behavior:
  - 기본 form/button/table 구조는 키보드 접근 가능해야 한다.
  - 대량 작업 버튼은 disabled 사유 또는 주변 설명을 제공해야 한다.
- Contrast/readability:
  - 상태 배지 색상은 텍스트와 함께 의미를 제공한다.
  - table 정보량이 많으므로 hover 색상만으로 상태를 구분하지 않는다.
- Screen-reader semantics:
  - route heading, form label, button text가 명확해야 한다.
  - alert/오류 영역은 향후 `role="alert"` 적용 권장.
- Reduced motion and sensory considerations:
  - 큰 모션은 없지만 transition은 짧게 유지한다.

## Responsive behavior
- Supported breakpoints/devices:
  - desktop-first.
  - `globals.css`의 980px 이하 breakpoint에서 사이드바/그리드가 축소된다.
- Layout adaptations:
  - 좌측 AppShell 사이드바는 접힘 상태를 지원한다.
  - table은 `table-wrap` overflow로 처리한다.
- Touch/hover differences:
  - 내부 관리자이므로 hover가 보조 역할을 하지만, 클릭/탭만으로 주요 작업이 가능해야 한다.

## Interaction states
- Loading:
  - API 요청 중 카드/텍스트 기반 로딩 표시.
  - 작업 큐는 자동 새로고침/수동 새로고침으로 상태 확인.
- Empty:
  - 도메인 없음, 슬롯 없음, 학원 자료 없음, 글 없음 상태는 다음 생성/동기화 액션으로 연결해야 한다.
- Error:
  - API client는 `message/detail` 기반 Error를 던진다.
  - 워커 실패는 `jobs.error`, `slots.last_error`에 남는다.
- Success:
  - 도메인 생성, 슬롯 생성, 작업 큐 등록, 글 export 완료 등은 alert/상태 갱신으로 확인.
- Disabled:
  - 선택 슬롯이 없으면 선택 글 작성/삭제 disabled.
  - API 키/외부 인증 미설정 기능은 명확한 안내 필요.
- Offline/slow network:
  - 긴 LLM 생성은 작업 큐로 분리되어 브라우저 요청 timeout에 직접 묶이지 않는다.

## Content voice
- Tone:
  - 한국어 운영자 친화, 짧고 명확한 안내.
  - “1개 테스트 작성 → QA 확인 → 현재 검색 10개 → 전국 골고루 100개”처럼 행동 순서를 제시.
- Terminology:
  - 도메인, 축, 슬롯, 글 후보, 작업 큐, 검수, 내보내기, 색인, 학원자료, 공개 API.
  - 사용자-facing 문구에서는 raw technical term보다 운영 용어를 우선.
- Microcopy rules:
  - 버튼은 결과를 예측 가능하게 쓴다.
  - 위험한 대량 작업은 범위/예상 시간/전제 조건을 함께 보여준다.
  - 실패 메시지는 원인과 다음 복구 액션을 함께 제공한다.

## Implementation constraints
- Framework/styling system:
  - Backend: NestJS 11, TypeScript, Node built-in SQLite(`node:sqlite`) 기반 `DatabaseSync` 사용.
  - Admin: Next.js 15, React 19, TypeScript, plain CSS.
  - Worker: 로컬 `codex exec` 또는 `claude --print` CLI 호출.
- Design-token constraints:
  - 새 UI 라이브러리 없이 기존 CSS 변수/클래스 재사용 권장.
- Performance constraints:
  - `getDomainDetail(...limit=500)`는 많은 데이터를 한 번에 가져올 수 있어 대규모 도메인에서 분리 로딩 필요.
  - SQLite 단일 파일/동기 DB 접근은 단순하지만 대규모 동시성에는 한계가 있다.
- Compatibility constraints:
  - Docker 운영 시 Codex/Claude 인증 파일 마운트가 필요할 수 있다.
  - `node:sqlite` 사용 가능 Node 버전 확인 필요.
  - 공개 API CORS는 `PUBLIC_API_ORIGINS`로 제한 가능.
- Security constraints:
  - 운영 환경에서 `ADMIN_PASSWORD` 필수.
  - `PUBLIC_WRITE_TOKEN` 설정 시 공개 학원 POST 보호.
  - DB(`data/admin.db`)와 `.env`는 민감 정보로 취급.
- Test/screenshot expectations:
  - `npm run typecheck`
  - `npm run build`
  - `npm run verify:company-clean`
  - `npm run qa:posts` 또는 `npm run qa:posts:all`
  - 관리자 주요 플로우 수동 smoke: 도메인 생성/슬롯 생성/작업 등록/작업 큐 확인/글 상세 확인.

## Open questions
- [ ] 실제 운영 배포는 단일 Docker API만 사용할지, Admin Next도 별도 배포할지 확정 필요 / owner: engineering / impact: 배포 구조·환경변수
- [ ] Codex/Claude 중 기본 생성 provider와 모델 정책 확정 필요 / owner: content/engineering / impact: 비용·품질·인증
- [ ] DrivingPlus 외부 API의 운영 base URL/인증/장애 대응 정책 확정 필요 / owner: backend / impact: 학원 데이터 신뢰성
- [ ] Google Indexing 실제 제출 기능을 구현할지, 수동 제출/별도 파이프라인으로 둘지 결정 필요 / owner: SEO/engineering / impact: 색인 자동화 범위
- [ ] 생성 글 승인/반려 상태를 정식 workflow로 둘지 결정 필요 / owner: product/content / impact: 편집 거버넌스
- [ ] `DomainClient` 대형 컴포넌트 분리 우선순위 확정 필요 / owner: frontend / impact: 유지보수성
- [ ] `data/admin.db`를 운영에서 계속 SQLite로 둘지, Postgres 등으로 이전할지 결정 필요 / owner: engineering / impact: 동시성·백업·운영 안정성
