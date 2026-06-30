# Adrock Driving Content Ops

운전면허·운전학원 도메인 전용 **SEO 콘텐츠 운영 시스템**입니다. 관리자가 지역/키워드 축으로
슬롯을 만들면, 워커가 **검증된 학원 데이터만** 사용해 글을 생성하고 품질 게이트로 검수한 뒤 공개 API로
발행합니다.

```text
apps/
  api-nest/    NestJS API + 백그라운드 워커 + SQLite(data/admin.db). 시스템의 source of truth
  admin-next/  Next.js 사내 관리자 UI. /api/admin/* 프록시로 API 호출
integration/
  nextjs-community-kit/  공개 사이트가 /api/v1/* 콘텐츠를 소비하는 드롭인 키트
```

구조·아키텍처·운영 맥락은 [`INDEX.md`](./INDEX.md), [`HANDOFF.md`](./HANDOFF.md),
[`DEVELOPER_CONTEXT.md`](./DEVELOPER_CONTEXT.md), 배포는 [`DEPLOY.md`](./DEPLOY.md)를 참고하세요.

---

## 사전 준비물

- **Node.js 24 LTS 이상 권장** (레포 Docker 이미지는 `node:25`).
  저장소는 ORM 없이 **Node 내장 `node:sqlite`** 모듈을 쓰기 때문입니다.
  - Node 22.5 ~ 23.x 에서는 `--experimental-sqlite` 플래그가 필요할 수 있습니다.
  - **Node 20 이하에서는 API/워커가 기동되지 않습니다.** (단, 단위 테스트는 `node:sqlite`를
    import하지 않으므로 구버전에서도 `npm test`는 동작합니다.)
- **npm** (각 앱이 자체 `package-lock.json`을 가집니다. 워크스페이스 선언은 없습니다.)
- **(선택) 콘텐츠 생성용 CLI 인증** — 실제로 글을 생성하려면 `codex`(기본) 또는 `claude` CLI가
  PATH에 설치되어 있고 OAuth/구독 로그인이 되어 있어야 합니다. 생성은 API 키가 아니라 이 CLI를
  서브프로세스로 호출해 동작합니다([아래 참고](#콘텐츠-생성llm-동작-방식)).
  CLI가 없어도 **관리자 UI와 API 자체는 정상 기동**되며, 생성 작업만 실패합니다.

---

## 빠른 시작 (macOS / Linux)

```bash
# 1. 환경 변수 준비
cp .env.example .env        # 필요한 값만 수정 (로컬은 ADMIN_PASSWORD 비워도 됨)

# 2. API(+워커) + 관리자 동시 기동
./dev.sh
```

`dev.sh`는 `.env`를 자동 로드하고, `node_modules`가 없으면 각 앱에 의존성을 설치하며,
포트가 사용 중이면 자동으로 다음 빈 포트로 옮깁니다. 종료는 `Ctrl-C`.

| 서비스 | 주소 |
| --- | --- |
| 사내 관리자 UI | http://localhost:3001 (사용 중이면 다음 빈 포트) |
| API | http://127.0.0.1:8765 |
| 공개 API 예시 | http://127.0.0.1:8765/api/v1/{domain}/posts |

---

## 빠른 시작 (Windows)

`dev.sh`는 bash 스크립트이며 `lsof`/`pkill`을 사용하므로 **Windows에서는 그대로 실행되지 않습니다.**
두 가지 방법 중 하나를 쓰세요.

### 방법 A — WSL / Git Bash (권장)

WSL2 또는 Git Bash 안에서는 macOS/Linux 절차와 동일하게 `./dev.sh`를 쓸 수 있습니다.
이때 Node도 WSL 쪽(24+)에 설치되어 있어야 합니다.

### 방법 B — 두 터미널에서 직접 실행

`.env.example`을 `.env`로 복사한 뒤, 터미널 두 개를 엽니다.

PowerShell:

```powershell
# 터미널 1 — API + 워커
cd apps\api-nest
npm install
$env:API_WORKER = "1"
npm run dev

# 터미널 2 — 사내 관리자
cd apps\admin-next
npm install
$env:SEO_API_BASE_URL = "http://127.0.0.1:8765"
npm run dev
```

cmd.exe 에서는 환경 변수 설정만 다릅니다: `set API_WORKER=1`,
`set SEO_API_BASE_URL=http://127.0.0.1:8765`.

---

## 환경 변수

전체 목록과 설명은 [`.env.example`](./.env.example)(루트)와 각 앱의
`apps/api-nest/.env.example`, `apps/admin-next/.env.example`에 있습니다. 자주 쓰는 값:

| 변수 | 용도 | 기본값 |
| --- | --- | --- |
| `ADMIN_HOST` / `ADMIN_PORT` | API bind 주소/포트 | `127.0.0.1` / `8765` |
| `ADMIN_PASSWORD` | 관리자 API 보호 토큰 | 비움(로컬 오픈) — **운영 필수** |
| `API_WORKER` | API 프로세스에서 워커도 함께 실행 | `1` |
| `SEO_API_BASE_URL` | 관리자가 호출할 API base | `http://127.0.0.1:8765` |
| `ADMIN_API_TOKEN` | 관리자 프록시가 API로 전달할 토큰 | (관리자 측) `ADMIN_PASSWORD`와 같은 값 |
| `SEO_DB_PATH` | SQLite DB 경로 | `data/admin.db` |
| `WORKER_POLL_INTERVAL` | 워커 폴링 주기(초) | `3` |
| `PUBLIC_API_ORIGINS` | 공개 API CORS 허용 | `*` — **운영에서는 도메인 제한** |

> 관리자가 API를 호출할 때 `ADMIN_PASSWORD`(API)와 `ADMIN_API_TOKEN`(관리자)은 **같은 값**이어야
> 인증이 통과합니다. 로컬에서 둘 다 비우면 인증 없이 열립니다.

---

## 콘텐츠 생성(LLM) 동작 방식

이 부분이 가장 비직관적입니다.

- 텍스트 생성은 `codex`(기본) 또는 `claude` **CLI 바이너리를 서브프로세스로 실행**하고 스트림
  JSON 출력을 파싱해 본문으로 씁니다. provider는 작업별로 선택하며 기본은 `codex`입니다.
- 따라서 **`ANTHROPIC_API_KEY` 같은 API 키가 아니라 CLI의 OAuth/구독 로그인**으로 인증합니다.
  (Claude 경로에서는 OAuth를 강제하기 위해 서브프로세스 env의 API 키 변수를 제거합니다.)
- 이미지 생성은 별개로 `~/.codex/auth.json`을 직접 읽어 Codex 백엔드를 호출합니다.
  `401`은 Codex/ChatGPT 인증 만료를 뜻합니다.

---

## 검증 / 테스트

```bash
npm test                    # 품질 게이트 단위 테스트(vitest) — Node 20에서도 동작
npm run typecheck           # API + 관리자 타입체크(tsc). 린트/포맷 도구가 없는 대신 사실상 유일한 정적 검사
npm run lint                # Biome 린트  (자동수정: npm run lint:fix)
npm run qa:posts            # 발행된 글 품질 감사 (전체: npm run qa:posts:all)
npm run verify:company-clean # 회사 제출용 금지 용어 스캔
npm run build               # API(tsc) + 관리자(next build) 빌드
```

커밋·제출 전에는 `verify:company-clean` + `typecheck` + `qa:posts`를 통과시킵니다.

---

## Docker

```bash
docker compose up --build
```

생성(LLM)을 쓰려면 호스트의 인증을 마운트해야 합니다 — `docker-compose.yml`의
`~/.claude`, `~/.codex` 볼륨 주석을 해제하세요. DB는 `adrock-db` 볼륨에 보존됩니다.
자세한 내용은 [`DEPLOY.md`](./DEPLOY.md)를 참고하세요.
