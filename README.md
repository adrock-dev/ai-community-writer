# AI Community Writer

운전면허·운전학원·운전연수 콘텐츠 작성 도구입니다. 네이버 검색량(최근 30일)으로 주제를 정하고,
Codex 또는 Claude CLI로 채널별 원고를 쓰고, 사람이 검수·승인한 글만 내보냅니다.

발행 채널: 운전면허PLUS 커뮤니티, 드라이빙존 블로그, 드라이빙존 연수 블로그, 드라이빙존 카페(원고).

설계와 진행 단계는 [`docs/architecture.md`](./docs/architecture.md)를 참고하세요.

## 준비물

- **Node.js 24 이상** — 빌드 없이 TypeScript를 바로 실행하고, 내장 `node:sqlite`를 씁니다.
- **글 생성용 CLI 로그인** (둘 중 하나 이상)
  - Codex: `npm i -g @openai/codex` 후 `codex login`
  - Claude: `npm i -g @anthropic-ai/claude-code` 후 `claude` 실행해 로그인
- **네이버 검색광고 API 인증 파일** (키워드 수집 단계부터 필요) — 기본 위치 `~/.naver-searchad.env`
  (Windows: `C:\Users\<사용자>\.naver-searchad.env`)

## 실행 (Windows / macOS 공통)

```powershell
npm install
npm start
```

`http://127.0.0.1:8787/health`가 응답하면 정상입니다. 종료는 `Ctrl+C`.

## 설정

설정 파일은 선택입니다. 없으면 기본값으로 실행됩니다. 바꿀 값이 있을 때만 예시를 복사해 필요한 항목만 남기세요.

```powershell
copy config.example.json config.json
```

| 항목 | 기본값 | 설명 |
| --- | --- | --- |
| `server.port` | `8787` | 로컬 UI·API 포트 |
| `dbPath` | `data/writer.db` | SQLite 파일 |
| `llm.order` | `["codex", "claude"]` | 사용 순서. 한도에 걸리면 다음으로 넘어감 |
| `llm.timeoutSec` | `600` | 글 1편 생성 제한 시간 |
| `pacing.minIntervalSec` / `maxIntervalSec` | `300` / `900` | 생성 사이 대기(무작위) |
| `pacing.dailyLimit` | `10` | 하루 최대 생성 편수 |
| `naver.searchadEnvFile` | `~/.naver-searchad.env` | 검색광고 API 인증 파일 |
| `sources.profile` | `prod` | 학원·연습장 데이터 API 환경 (`prod` / `dev`) |
| `sources.drivingplusApi` / `drivingzoneApi` | 빈 값 | 비우면 profile 주소 사용. 다른 서버를 쓸 때만 지정 |

| profile | api.drive | api.drivingzone |
| --- | --- | --- |
| `prod` | `https://api.drivingplus.me` | `https://api.drivingzone.co.kr` |
| `dev` | `https://api-dev.drivingplus.me:18104` | `https://adrock.duckdns.org:18099` |

`config.json`은 git에 올라가지 않습니다. 다른 위치의 설정을 쓰려면 환경 변수 `WRITER_CONFIG`에 경로를 지정합니다.

## 작성 가이드 (운영 규칙)

글을 쓸 때 반드시 지켜야 하는 규칙은 `guides/` 폴더의 Markdown 파일에 적습니다. `- `로 시작하는 한 줄이 규칙 하나입니다.

| 파일 | 적용 대상 |
| --- | --- |
| `guides/common.md` | 모든 채널 |
| `guides/drivingplus.md` | 운전면허PLUS 커뮤니티 |
| `guides/drivingzone.md` | 드라이빙존 블로그·연수 블로그·카페 |
| `guides/channels/<채널 id>.md` | 특정 채널만 (선택) |

```markdown
## 교육 운영

- 드라이빙존 교육시간은 1일 1회 최대 1시간 30분 교육 가능
```

## 개발 명령

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | 파일 변경 시 자동 재시작 |
| `npm run typecheck` | 타입 검사 |
| `npm run lint` / `npm run format` | Biome 린트 / 포맷 |
| `npm test` | 단위 테스트 (vitest) |
| `npm run check` | 위 세 가지를 한 번에 |
