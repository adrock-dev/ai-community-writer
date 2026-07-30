# Adrock 배포 / 실행

- 검토일: 2026-07-30 (코드·`Dockerfile`·`docker-compose.yml`·`dev.sh`와 대조 — 이전 기재 2026-06-16)

백엔드는 **NestJS API + Nest worker**입니다. Python FastAPI/Jinja와 Electron 관리자는 제거했고, 사내 관리자/공개 API의 실행 기준은 `apps/api-nest`입니다.

Node는 `node:sqlite`의 `DatabaseSync`를 쓰므로 그 API가 있는 버전이 필요합니다(운영 이미지는 `node:25-slim`).

## 로컬 개발

가장 간단한 실행:

```bash
./dev.sh
```

`dev.sh`는 루트 `.env`가 있으면 자동 로드하고, API와 관리자를 함께 띄웁니다. **포트가 사용 중이면 빈 포트로 자동 변경합니다**(`NEXT_PORT` 3001→3002…, `ADMIN_PORT` 8765→8766…). 그래서 관리자가 3001에 없을 수 있으니 실행 로그의 `[dev] … 자동 변경` 줄을 확인하세요.

수동 실행:

```bash
# 터미널 1 — Nest API + worker
cd apps/api-nest
npm install
API_WORKER=1 npm run dev

# 터미널 2 — Next 사내 관리자
cd ../admin-next
npm install
SEO_API_BASE_URL=http://127.0.0.1:8765 npm run dev
```

주소(기본값):

- Nest API: `http://127.0.0.1:8765`
- Next 사내 관리자: `http://localhost:3001`
- 공개 API: `http://127.0.0.1:8765/api/v1/{domain}/posts`

**`npm run dev` 중에는 `npm run build`를 돌리지 마세요.** `next dev`와 `apps/admin-next/.next` 청크를 공유해 관리자 화면이 통째로 깨집니다(복구: dev 정지 → `rm -rf apps/admin-next/.next` → 재시작). 타입만 확인할 목적이면 `npm run typecheck`으로 충분합니다.

새로 클론했거나 장비를 옮겼으면 `npm run hooks:install`로 pre-commit 훅을 다시 심으세요(`.git/hooks`는 버전 관리되지 않습니다).

## Docker

```bash
cp .env.example .env
# ADMIN_PASSWORD 등 수정
docker compose up --build
```

**이미지에는 API와 워커만 들어갑니다.** `Dockerfile`이 `apps/api-nest`만 복사·빌드하므로 `docker compose up`으로 뜨는 것은 API(+워커)뿐입니다. 사내 관리자(`apps/admin-next`)는 이 컴포즈에 없으니 별도로 실행하고 `SEO_API_BASE_URL`을 컨테이너 API로 향하게 하세요.

### 저장소 볼륨 — DB는 두 개입니다

`adrock-db` 볼륨이 `/data`에 붙고, 컴포즈가 `SEO_DB_PATH=/data/admin.db`를 넣어 운영 DB를 그 볼륨에 둡니다.

**학원 심층조사는 별도 DB(`academy_research.db`)를 쓰는데, 이 값은 컴포즈가 설정하지 않습니다.** 비워 두면 컨테이너 내부 경로(`/app/data/academy_research.db`)에 생겨 **컨테이너를 다시 만들면 조사 데이터가 사라집니다.** 원천에서 다시 받을 수 있는 자료와 달리 **AI 심층조사값과 검증완료 승인은 복구가 불가능합니다**(380곳 재조사 ≈ 4~5시간 + LLM 비용, 승인은 사람이 다시 판단 — `docs/data-portability.md`). 조사 데이터를 `admin.db`가 초기화돼도 살아남게 하려고 일부러 분리한 것이므로, 컨테이너로 운영하려면 `.env`에서 다음 줄의 주석을 반드시 풀어 볼륨 안으로 보내세요.

```bash
ACADEMY_RESEARCH_DB_PATH=/data/academy_research.db
```

### 생성(LLM)을 쓰려면 인증 마운트가 필요합니다

본문 생성은 API 키가 아니라 로컬 `codex`/`claude` CLI의 OAuth 인증에 의존합니다. 컨테이너에는 그 인증이 없으므로 `docker-compose.yml`의 아래 두 줄 주석을 풀어야 생성이 동작합니다(없으면 생성 작업이 실패합니다).

```yaml
# - ${HOME}/.claude:/root/.claude:ro
# - ${HOME}/.codex:/root/.codex:ro
```

## 인증

`ADMIN_PASSWORD`를 설정하면 사내 관리자 API는 아래 중 하나가 필요합니다.

- cookie `admin_token`
- header `x-admin-token`
- header `Authorization: Bearer`

Next 사내 관리자 프록시(`app/api/admin/[...path]/route.ts`)는 서버 측 환경변수 `ADMIN_API_TOKEN`을 API로 전달하며, 이 값은 `ADMIN_PASSWORD`와 같아야 합니다. 환경변수 출처는 실행 방식에 따라 다릅니다 — `./dev.sh`는 **루트 `.env`**를 로드해 넘기고, `apps/admin-next`를 직접 띄우면 그 앱의 `.env`/`.env.local` 또는 셸 환경을 씁니다.

## 운영 전 확인

- `ADMIN_PASSWORD` 설정(비우면 관리자 API가 열립니다)
- `PUBLIC_API_ORIGINS`를 공개 사이트 도메인으로 제한(기본 `*`)
- `PUBLIC_WRITE_TOKEN` 설정(공개 학원 POST 보호)
- 백업 대상은 **DB 두 개와 그 WAL/SHM 파일 전부**입니다 — `data/admin.db`, `data/academy_research.db`(+ `-wal`, `-shm`). 복사 절차와 주의점은 `docs/data-portability.md`가 정본입니다.
- 배포 전 게이트는 `CLAUDE.md`가 기준입니다(`verify:company-clean`·`verify:copy-sync`·`typecheck`·`test`·`qa:posts`, 그리고 배포 산출물이 필요할 때만 `build`).
