# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

운전면허·운전학원 도메인 전용 콘텐츠 운영 시스템. 검증된 학원 데이터만 사용해 SEO 게시글을 자동 생성·검수·발행한다.

- `apps/api-nest` — NestJS 11 API + 백그라운드 워커. 저장소는 **ORM 없이 Node 내장 `node:sqlite`(`DatabaseSync`)**, DB 파일은 `data/admin.db`. 시스템의 핵심이자 source of truth.
- `apps/admin-next` — Next.js 15(App Router)/React 19 사내 관리자 UI. 브라우저는 API를 직접 호출하지 않고 `app/api/admin/[...path]/route.ts` 프록시가 서버에서 admin 토큰을 주입한다.
- `integration/nextjs-community-kit` — 공개 사이트가 `/api/v1/*` 콘텐츠를 소비하는 드롭인 키트.

콘텐츠 파이프라인: 도메인 → 축 프리셋(지역/키워드/인텐트/페르소나) → **슬롯**(키워드×템플릿) → **잡 큐**(SQLite `jobs`) → 워커가 **post** 생성 → 품질 게이트 통과 후 발행. 워커는 `WorkerService.loop`의 단일 폴링 루프(기본 3초)로 잡을 하나씩 claim한다.

배경·아키텍처·인수인계 맥락은 기존 문서를 참조한다:
@HANDOFF.md
@DEVELOPER_CONTEXT.md

## 명령어 (모두 저장소 루트에서 실행)

npm workspaces는 선언되어 있지 않고, 루트 스크립트가 `npm --prefix`로 각 앱에 위임한다.

- `npm run dev` — `./dev.sh`. NestJS API(+워커)와 Next 관리자를 함께 기동. `.env` 자동 로드, 포트(3001/8765) 사용 중이면 자동 증가.
- `npm run typecheck` — 두 앱 `tsc --noEmit`. **린트/포맷 도구가 없으므로 사실상 유일한 정적 검사다.**
- `npm run build` — API는 `tsc`, 관리자는 `next build`.
- `npm run qa:posts` / `qa:posts:all` — 발행된(또는 전체) post 품질 감사. 마크다운을 HTML로 재렌더링해 검사한다.
- `npm run verify:company-clean` — 추적 파일에서 금지된 내부/레거시 용어를 스캔.
- `npm run worker:once` — 워커 1회 실행(`apps/api-nest/src/worker-once.ts`).

테스트 러너(jest/vitest)는 **없다**. "테스트"는 애드혹 Node 스크립트(`scripts/qa-posts.mjs`, `scripts/tests/candidate-heading-gate.mjs`)이며 CI도 없다.

## 커밋 전 필수 게이트

커밋·제출 전 다음을 모두 통과시킨다:

1. `npm run verify:company-clean`
2. `npm run typecheck`
3. `npm run qa:posts`

커밋은 `develop` 브랜치에 작성한다(현재 브랜치 확인 후, 아니면 사용자에게 먼저 확인). `push`는 자동으로 하지 않는다.

## 코드 스타일 / 규약

린트·포맷 설정이 없다. 강제되는 규칙은 TypeScript 컴파일러 설정뿐:

- `apps/api-nest`: `strict` + **`noUncheckedIndexedAccess`** (배열/레코드 접근이 `T | undefined`를 반환 — 코드 곳곳의 `!`/`|| ""` 가드는 이 때문). `module: NodeNext`, `experimentalDecorators`(NestJS).
- ESM 임포트는 **명시적 `.js` 확장자**를 쓴다(`./db.service.js`). NodeNext 때문이며, 임포트 추가 시 주의.
- 관찰된 관례(도구 강제 아님): 큰따옴표, 세미콜론, 2-스페이스 들여쓰기.
- 코드·주석·문서는 대부분 한국어다.

## 반드시 알아야 할 함정

- **LLM 텍스트 생성은 API 키가 아니라 CLI 서브프로세스 + OAuth에 의존한다.** `runLlm()`(`worker.service.ts`)이 `codex exec` 또는 `claude --print` 바이너리를 서브프로세스로 spawn해 스트림 JSON을 파싱한다. 기본 프로바이더는 `codex`. Claude 경로에서는 OAuth 강제를 위해 서브프로세스 env의 `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`을 삭제한다. 로컬에 해당 CLI가 설치돼 있어야 생성이 동작한다.
- **이미지 생성**(`image-generation.service.ts`)은 CLI를 쓰지 않고 `~/.codex/auth.json`을 직접 읽어 Codex `responses` 엔드포인트를 호출한다. 401은 Codex/ChatGPT 인증 만료를 뜻한다.
- **`verify:company-clean` 금지 용어 게이트**가 있다. 저장소는 범용 SEO 도구에서 포크·정제돼 운전 도메인으로 특화됐다. 멀티테넌시·서비스형 SW를 가리키는 일반 용어, 경쟁 브랜드명, 레거시 내부 용어를 도입하면 검증이 실패한다. 금지 목록은 `scripts/verify-company-clean.mjs`에 있다.
- **품질 게이트가 두 곳에 독립 구현돼 있다.** 런타임 게이트(`worker.service.ts`의 `articleQualityIssues`/`postSurfaceQualityIssues`)와 렌더 인식 게이트(`scripts/qa-posts.mjs`)는 로직을 공유하지만 DRY하지 않다. **품질 규칙을 바꿀 때 두 쪽을 함께 맞춰라.**
- 생성 프롬프트(`buildPrompt`)에는 "절대 원칙"이 있다: 확인된 데이터만 사용, 가격·합격률·셔틀·후기 날조 금지, 실제보다 많은 후보 주장 금지, 내부 API URL/인용 마커 노출 금지.
- `data/article-patterns/summary.json`이 생성 시 프롬프트에 주입된다(없으면 graceful fallback). 원본 `.xlsx`/`.csv`는 gitignore.
- 도메인은 `driving` 버티컬에 하드 특화돼 있다(`constants.ts`). 새 도메인은 `driving` + `local-guide` 디자인으로 기본 설정된다.

## 환경 변수

`.env.example`(루트 + 각 앱)에 정리돼 있다. 핵심: `ADMIN_PASSWORD`(prod 필수), `API_WORKER=1`(워커를 API 프로세스 내 실행), `SEO_DB_PATH`(기본 `data/admin.db`), 품질 노브 `SEO_QUALITY_MIN_TEXT_CHARS`/`MAX_TEXT_CHARS`/`MAX_ATTEMPTS`. admin-next 프록시는 `ADMIN_API_TOKEN`을 `x-admin-token`으로 전달하며 이는 `ADMIN_PASSWORD`와 같아야 한다.
