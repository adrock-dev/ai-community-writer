# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

운전면허·운전학원 도메인 전용 콘텐츠 운영 시스템. 검증된 학원 데이터만 사용해 SEO 게시글을 자동 생성·검수·발행한다.

- `apps/api-nest` — NestJS 11 API + 백그라운드 워커. 저장소는 **ORM 없이 Node 내장 `node:sqlite`(`DatabaseSync`)**, DB 파일은 `data/admin.db`. 시스템의 핵심이자 source of truth.
- `apps/admin-next` — Next.js 15(App Router)/React 19 사내 관리자 UI. 브라우저는 API를 직접 호출하지 않고 `app/api/admin/[...path]/route.ts` 프록시가 서버에서 admin 토큰을 주입한다.
- `integration/nextjs-community-kit` — 공개 사이트가 `/api/v1/*` 콘텐츠를 소비하는 드롭인 키트.

콘텐츠 파이프라인: 도메인 → 축 프리셋(지역/키워드) → **슬롯**(키워드×템플릿) → **잡 큐**(SQLite `jobs`) → 워커가 **post** 생성 → 품질 게이트 통과 후 발행. (persona/intent/modifier는 도메인 축이 아니라 글유형별 `axis_values` 데이터다.) 워커는 `WorkerService.loop`의 단일 폴링 루프(기본 3초)로 잡을 하나씩 claim한다.

배경·아키텍처·인수인계 맥락은 기존 문서를 참조한다:
@HANDOFF.md
@DEVELOPER_CONTEXT.md

## 명령어 (모두 저장소 루트에서 실행)

npm workspaces는 선언되어 있지 않고, 루트 스크립트가 `npm --prefix`로 각 앱에 위임한다.

- `npm run dev` — `./dev.sh`. NestJS API(+워커)와 Next 관리자를 함께 기동. `.env` 자동 로드, 포트(3001/8765) 사용 중이면 자동 증가.
- `npm run typecheck` — 두 앱 `tsc --noEmit`.
- `npm run test` — API `vitest run`(`apps/api-nest/test/*.test.ts`). `test:watch`도 있다.
- `npm run test:golden` — 골든 스냅샷 대조(`apps/api-nest/scripts/tests/golden-runner.ts`).
- `npm run build` — API는 `tsc`, 관리자는 `next build`.
- `npm run qa:posts` / `qa:posts:all` — 발행된(또는 전체) post 품질 감사. 마크다운을 HTML로 재렌더링해 검사한다.
- `npm run verify:company-clean` — 추적 파일에서 금지된 내부/레거시 용어를 스캔.
- `npm run copy:inventory` — 관리자 UI 안내멘트 역참조표(`docs/ui-copy-inventory.md`) 재생성. `copy:untagged`는 분류가 빠진 사실 주장 문장을 찾는다.
- `npm run verify:copy-sync` — 안내멘트가 코드와 어긋났는지 검사(pre-commit 훅이 자동 실행). `--all`을 주면 staged 대신 워킹트리 전체를 종속 검사 대상으로 본다.
- `npm run lint` / `format` / `lint:fix` — biome(`biome.json`).
- `npm run worker:once` — 워커 1회 실행(`apps/api-nest/src/worker-once.ts`).
- `npm run sync:academies -- <domain>` / `sync:region-directory` — 외부 원천에서 학원·지역 동기화. **기동 중인 API 프로세스는 시작 시점의 `.env`를 들고 있으므로**, base URL을 바꾼 뒤에는 관리자 엔드포인트 대신 이 CLI를 쓴다(현재 셸의 환경변수로 붙는다).

CI는 없다. 로컬 게이트가 전부다.

## 커밋 전 필수 게이트

커밋·제출 전 다음을 모두 통과시킨다:

1. `npm run verify:company-clean`
2. `npm run verify:copy-sync` — 안내멘트가 코드와 어긋났는지. **1·2는 `.git/hooks/pre-commit`이 자동 실행해 실패 시 커밋을 차단한다.** `.git/hooks`는 버전 관리되지 않으므로 **클론·장비 이전 후에는 `npm run hooks:install`로 다시 심어야 한다**(정본은 `scripts/install-git-hooks.sh`, 훅을 고칠 때도 그쪽을 고친다). 나머지는 수동이다.
3. `npm run typecheck`
4. `npm run test`
5. `npm run qa:posts`

커밋은 `develop` 브랜치에 작성한다(현재 브랜치 확인 후, 아니면 사용자에게 먼저 확인). `push`는 자동으로 하지 않는다.

## 코드 스타일 / 규약

biome(`biome.json`)이 있으나 훅으로 강제되지는 않는다. 그 외 강제되는 규칙은 TypeScript 컴파일러 설정뿐:

- `apps/api-nest`: `strict` + **`noUncheckedIndexedAccess`** (배열/레코드 접근이 `T | undefined`를 반환 — 코드 곳곳의 `!`/`|| ""` 가드는 이 때문). `module: NodeNext`, `experimentalDecorators`(NestJS).
- ESM 임포트는 **명시적 `.js` 확장자**를 쓴다(`./db.service.js`). NodeNext 때문이며, 임포트 추가 시 주의.
- 관찰된 관례(도구 강제 아님): 큰따옴표, 세미콜론, 2-스페이스 들여쓰기.
- 코드·주석·문서는 대부분 한국어다.

## 반드시 알아야 할 함정

- **LLM 텍스트 생성은 API 키가 아니라 CLI 서브프로세스 + OAuth에 의존한다.** `runLlm()`(`worker.service.ts`)이 `codex exec` 또는 `claude --print` 바이너리를 서브프로세스로 spawn해 스트림 JSON을 파싱한다. 기본 프로바이더는 `codex`. Claude 경로에서는 OAuth 강제를 위해 서브프로세스 env의 `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`을 삭제한다. 로컬에 해당 CLI가 설치돼 있어야 생성이 동작한다.
- **이미지 생성**(`image-generation.service.ts`)은 CLI를 쓰지 않고 `~/.codex/auth.json`을 직접 읽어 Codex `responses` 엔드포인트를 호출한다. 401은 Codex/ChatGPT 인증 만료를 뜻한다.
- **`verify:company-clean` 금지 용어 게이트**가 있다. 저장소는 범용 SEO 도구에서 포크·정제돼 운전 도메인으로 특화됐다. 멀티테넌시·서비스형 SW를 가리키는 일반 용어, 경쟁 브랜드명, 레거시 내부 용어를 도입하면 검증이 실패한다. 금지 목록은 `scripts/verify-company-clean.mjs`에 있다.
- **품질 게이트가 두 곳에 독립 구현돼 있다.** 런타임 게이트(`quality-gate.ts`의 `articleQualityIssues`/`postSurfaceQualityIssues`)와 렌더 인식 게이트(`scripts/qa-posts.mjs`)는 로직을 공유하지만 DRY하지 않다(qa는 렌더 후 HTML까지 검사). **품질 규칙을 바꿀 때 두 쪽을 함께 맞춰라.** 공유 상수/함수(AI 상투표현·판박이 목록·문장 난이도 임계·`aiClicheIssues`/`boilerplatePhraseIssues`/`repeatedSentenceIssues`/`sentenceDifficultyIssues`)가 어긋나면 `test/gate-parity.test.ts`(드리프트 가드)가 실패한다. qa-posts.mjs는 CLI 진입점(`main()`)에서만 실행되고 import 시엔 미러만 노출한다.
- **미러는 품질 규칙만이 아니다 — `post-rendering.ts`의 마크다운 렌더러도 qa-posts.mjs에 통째로 복제돼 있다**(`markdownBlocks`/`isMarkdownList`/`renderMarkdownTable` 등). 의도적 차이는 학원 카드 `<section>` 래퍼뿐이며, `gate-parity.test.ts`가 `renderMarkdown` 출력을 대조한다. 이 대조가 없던 시절 loose list 렌더 버그가 양쪽에 똑같이 남아 **게이트가 자기 버그를 통과시켰다**(발행 글 21건 중 7건). 렌더러를 고칠 땐 반드시 두 쪽 다 고쳐라.
- 생성 프롬프트(`buildPrompt`)에는 "절대 원칙"이 있다: 확인된 데이터만 사용, 가격·합격률·셔틀·후기 날조 금지, 실제보다 많은 후보 주장 금지, 내부 API URL/인용 마커 노출 금지.
- `data/content_research/summaries/summary_all_article_patterns.json`(원본 21,275개 글 패턴)이 생성 시 프롬프트에 주입된다(없으면 graceful fallback). 단 위험 제목/헤딩(100%·초단기·단기·빠른 합격·N일 최단기 취득·합격 보장)은 주입 전 `isRiskyArticlePattern`으로 걸러진다(런타임 위험 게이트가 못 잡는 표현까지 예방). 원본 `.xlsx`/`.csv`는 gitignore.
- 업종(vertical)은 DB 업종 레지스트리(`db.getVerticals()`, `settings/verticals` CRUD)로 관리되며 도메인 생성은 등록된 업종만 허용한다(기본 `driving`). 단 **프리셋·템플릿·품질 게이트는 아직 `driving`만 특화**돼 있다(`constants.ts`의 `PRESETS`/`TEMPLATE_SPECS`; MVP). 새 도메인은 디자인 자동 매칭(`auto` — 글마다 글 유형의 `default_design` 적용, `docs/design-template-mapping.md` 참조)으로 기본 설정된다.
- **`npm run dev` 중에는 글 생성이 언제든 끊긴다.** `API_WORKER=1`이면 워커가 API 프로세스 안에서 도는데 API는 `tsx watch`라, **`apps/api-nest/src` 아래 파일이 하나라도 저장되면 재시작하며 진행 중인 생성이 죽는다.** 생성 1건은 5~12분 걸린다. 죽은 잡은 `recoverStaleRunningJobs`가 `제한시간+여유(WORKER_CANCEL_EXTRA_GRACE_SEC, 기본 300초)` 초과 후 `failed`로 정리하는데, 에러 메시지가 `실패 처리됨(작업자 응답 없음...)`이라 **코드 문제와 구분되지 않는다.** 판별법: `jobs.heartbeat_at`이 `started_at`에서 거의 안 움직였으면 재시작으로 죽은 것이다. 편집하면서 생성을 돌려야 하면 별도 셸에서 `npm run worker:once`를 쓰거나, 다른 사람이 같은 저장소를 편집 중인지 먼저 확인하라. **잡을 넣는 시점도 중요하다** — `apps/api-nest/src`를 저장한 직후에 잡을 넣으면 재시작 중인 워커가 잡을 claim 하자마자 죽어, `heartbeat_at`이 `started_at`에서 1초도 안 움직인 채 20분간 `running`으로 남는다(실측 2026-07-29).
- **`npm run dev` 중에 `npm run build`를 돌리면 관리자 화면이 깨진다.** `next dev`와 `next build`가 같은 `apps/admin-next/.next`를 쓰는데, 프로덕션 빌드가 dev 서버가 참조하던 청크를 지워 `Cannot find module './873.js'` 같은 **Runtime Error**로 화면이 통째로 안 뜬다. 코드 문제가 아니다. 판별법: `.next/BUILD_ID`·`prerender-manifest.json`·`*.nft.json`(전부 `next build`만 만드는 파일)의 타임스탬프가 dev 서버 시작 시각보다 **나중**이면 빌드가 덮어쓴 것이다. 복구는 dev 정지 → `rm -rf apps/admin-next/.next` → 재시작. **타입만 확인할 목적이면 `npm run typecheck`로 충분하다** — HANDOFF의 배포 전 체크리스트에 `npm run build`가 있어 습관적으로 돌리기 쉬운데, dev가 떠 있으면 그때마다 화면이 죽는다.
- **공통 작성 원칙(`domains.common_principles`)은 프롬프트에 들어가지만 어떤 게이트도 검증하지 않는다.** `buildPrompt`가 `공통원칙:` 한 줄로 주입하며(Legacy Plus도 `buildPrompt` 위에 얹히므로 동일 적용) 지침 텍스트의 15% 안팎을 차지한다. 기본값은 `DEFAULT_DRIVING_COMMON_PRINCIPLES`다. **여기에 「절대 원칙」·아키타입 `writing_guide`·「필수 출력 구조」·품질 게이트가 이미 강제하는 내용을 재서술하지 마라** — 강제력은 안 생기고 여기서만 전달되는 톤·태도 지시만 희석된다. 입력칸 안내·placeholder는 2026-07-28 기준 이 방향으로 정정됐고(`8a1134a`), **투어 문구 한 곳(`DomainClient.tsx:368`)만 아직 "안전·데이터 원칙을 정하라"는 옛 안내로 남아 같은 화면 안에서 모순이다.**
- **화면 안내멘트의 3분의 1 이상은 코드가 강제하는 사실의 사본이다 — 코드를 고치면 같이 썩는다.** 컴포넌트뿐 아니라 **API 오류 메시지(`admin.controller.ts`)와 `admin-next/lib`의 문구도 화면에 그대로 뜬다.** 역참조표가 `docs/ui-copy-inventory.md`에 있다(건수·분류는 그 문서가 정본이다. 여기 숫자를 적으면 그것도 같이 썩는다 — 실제로 한 번 그랬다. `npm run copy:inventory`로 재생성, 분류는 `scripts/ui-copy-classification.json`에서 사람이 지정). **`apps/api-nest/src`의 상수·게이트·프롬프트를 바꿨으면 이 표에서 종속 문장을 먼저 찾아라.** A급은 상수에서 계산 가능한데 손으로 적은 값이라 값에서 렌더하면 드리프트가 사라지고, B급은 파생이 불가능해 사람이 같이 고쳐야 한다. 안내멘트를 새로 쓸 땐 `npm run copy:untagged`로 사실을 주장하는 문장이 분류 없이 남았는지 확인한다(현재 미분류 0).
- **`verify:copy-sync`(pre-commit)가 차단하는 것과 못 하는 것을 구분하라.** 차단: 분류 overlay 해석 실패(문구를 고쳤는데 `match`를 안 고침), 손으로 적은 숫자가 코드값과 불일치, 생성 문서가 낡음. 경고만: B급 종속 코드가 바뀌었는데 문구는 그대로인 경우 — **파생이 불가능해 기계가 판정할 수 없다.** B급을 차단하지 않는 것은 의도적이다. `worker.service.ts`처럼 자주 바뀌는 파일에 매달린 문장이 많아 차단하면 매 커밋이 걸리고, 그러면 `--no-verify`가 습관이 돼 게이트 전체가 죽는다. **경고가 뜨면 나열된 문장이 여전히 맞는 말인지 직접 읽어라.** 커밋까지 기다리지 않도록 `.claude/settings.json`의 `PostToolUse` 훅(`scripts/copy-deps-hook.mjs`)이 **파일을 고친 직후** 매달린 안내멘트를 알린다 — 매달린 게 없으면 아무 말도 하지 않는다.

## 환경 변수

`.env.example`(루트 + 각 앱)에 정리돼 있다. 핵심: `ADMIN_PASSWORD`(prod 필수), `API_WORKER=1`(워커를 API 프로세스 내 실행), `SEO_DB_PATH`(기본 `data/admin.db`), 품질 노브 `SEO_QUALITY_MIN_TEXT_CHARS`/`MAX_TEXT_CHARS`/`MAX_ATTEMPTS`. admin-next 프록시는 `ADMIN_API_TOKEN`을 `x-admin-token`으로 전달하며 이는 `ADMIN_PASSWORD`와 같아야 한다.
