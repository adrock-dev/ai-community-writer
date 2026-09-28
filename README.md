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
npm run doctor          # 설치·로그인·API 연결 점검 (실제 LLM 호출까지: npm run doctor -- --llm)
npm start
```

`http://127.0.0.1:8787/health`가 응답하면 정상입니다. 종료는 `Ctrl+C`.

## LLM 사용량과 대기

Codex·Claude CLI는 구독 사용량(5시간 창, 주간 창) 안에서 동작합니다. 이 도구는 호출할 때마다 사용률을 읽어서

- 사용률이 `llm.pauseAtUsagePercent`(기본 80%) 이상이면 그 창이 리셋될 때까지 해당 CLI를 쉬고
- 한도에 걸리면 오류 문구의 해제 시각까지(모르면 `llm.limitCooldownMin`분) 쉬며
- `llm.order`의 다음 CLI로 넘어갑니다. 모두 쉬는 중이면 작업은 실패가 아니라 **대기**로 남았다가 자동으로 재개됩니다.

같은 계정을 사람도 쓰므로 기준을 100%보다 낮게 두는 것을 권장합니다. 현재 사용률은 `/health`의 `llm`에서 볼 수 있습니다.
Codex 사용률은 `~/.codex/sessions`의 세션 기록에서 읽으므로, 생성할 때마다 세션 기록이 쌓입니다.

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
| `llm.pauseAtUsagePercent` | `80` | 사용률이 이 값 이상이면 리셋까지 쉼 |
| `llm.limitCooldownMin` | `60` | 한도 해제 시각을 모를 때 쉬는 시간(분) |
| `pacing.minIntervalSec` / `maxIntervalSec` | `300` / `900` | 생성 사이 대기(무작위) |
| `pacing.dailyLimit` | `10` | 하루 최대 생성 편수 |
| `worker.pollSec` | `5` | 작업 큐 확인 주기(초) |
| `keywords.minMonthlyVolume` | `30` | 30일 검색 수가 이보다 적은 키워드는 버림 |
| `keywords.maxTopicsPerSection` | `50` | 섹션별 저장할 주제 후보 수 |
| `keywords.clusterThreshold` | `0.5` | 키워드 묶기 기준 (낮출수록 크게 묶임) |
| `keywords.trendTopN` | `30` | 추세를 조회할 상위 주제 수 |
| `naver.searchadEnvFile` | `~/.naver-searchad.env` | 검색광고 API 인증 파일 (`NAVER_AD_API_KEY`, `NAVER_AD_SECRET_KEY`, `NAVER_AD_CUSTOMER_ID`). 같은 이름의 환경 변수가 있으면 그것을 우선 |
| `naver.datalabClientId` / `datalabClientSecret` | 빈 값 | 데이터랩 API (선택, 추세 반영용). 비우면 인증 파일의 `NAVER_DATALAB_CLIENT_ID` / `NAVER_DATALAB_CLIENT_SECRET` 사용 |
| `sources.profile` | `prod` | 학원·연습장 데이터 API 환경 (`prod` / `dev`) |
| `sources.drivingplusApi` / `drivingzoneApi` | 빈 값 | 비우면 profile 주소 사용. 다른 서버를 쓸 때만 지정 |
| `sources.cacheTtlHours` | `24` | 학원·지점 데이터 캐시 유지 시간 |
| `sources.timeoutSec` | `60` | 원천 API 요청 제한 시간 |

| profile | api.drive | api.drivingzone |
| --- | --- | --- |
| `prod` | `https://api.drivingplus.me` | `https://api.drivingzone.co.kr` |
| `dev` | `https://api-dev.drivingplus.me:18104` | `https://adrock.duckdns.org:18099` |

`config.json`은 git에 올라가지 않습니다. 다른 위치의 설정을 쓰려면 환경 변수 `WRITER_CONFIG`에 경로를 지정합니다.

## 키워드 수집과 주제 후보

```powershell
npm run collect            # 수집 후 섹션별 상위 주제 10개 출력 (--top=20 으로 개수 변경)
```

실행 중인 서버에서는 `POST /api/keywords/collect`로 작업 큐에 넣고, 결과는 `GET /api/topics?channel=<채널 id>`로 봅니다.

1. `seeds/<채널 id>.md`의 **시드 키워드**로 네이버 검색광고 API 연관 키워드와 **최근 30일 PC·모바일 검색 수**를 받습니다.
2. `seeds/common.md`의 공통 포함어·제외어와 섹션별 **포함어·제외어**로 거릅니다. 섹션 필터가 없으면 연관 키워드 범위가 넓어 모든 섹션에 같은 주제가 쌓입니다.
3. 같은 지역·같은 글 유형이면서 글자가 비슷한 키워드를 한 주제로 묶습니다. 검색 수가 가장 큰 키워드가 대표 키워드가 됩니다.
4. 검색 수(로그), 광고 경쟁도, 추세(선택), 이미 쓴 글 수로 점수를 매겨 저장합니다. 운영자가 건너뛴 주제는 다시 수집해도 건너뛴 상태로 남습니다.

추세는 네이버 데이터랩 검색어 트렌드 API 키가 있을 때만 반영합니다. 없으면 30일 검색 수만으로 점수를 매깁니다.

**데이터랩 키 발급** (현재 회사 프로젝트에는 발급된 키가 없음)

1. [developers.naver.com](https://developers.naver.com)에 회사 계정으로 로그인
2. Application → 애플리케이션 등록
   - 사용 API: **데이터랩 (검색어트렌드)**
   - 비로그인 오픈 API 서비스 환경: WEB, URL `http://localhost` (서버 호출이라 형식만 맞으면 됨)
3. 발급된 Client ID / Client Secret을 **검색광고 인증 파일(`~/.naver-searchad.env`)에 추가** (권장 — 비밀값을 저장소 밖 한곳에 둠)

```
NAVER_DATALAB_CLIENT_ID=발급받은ID
NAVER_DATALAB_CLIENT_SECRET=발급받은Secret
```

`config.json`의 `naver.datalabClientId` / `datalabClientSecret`에 직접 넣어도 되며, 설정값이 우선합니다.
하루 1,000회까지 호출할 수 있고, 수집 1회에 상위 30개 주제 기준 6회 정도 씁니다. `npm run doctor`로 키 인식 여부를 볼 수 있습니다.

```markdown
## drive_story

### 시드
- 운전학원추천

### 포함어
- 학원
- 추천

### 제외어
- 연수
```

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
| `npm run doctor` | 설치·설정 점검 |
| `npm run collect` | 키워드 수집·주제 후보 갱신 |
| `npm run typecheck` | 타입 검사 |
| `npm run lint` / `npm run format` | Biome 린트 / 포맷 |
| `npm test` | 단위 테스트 (vitest) |
| `npm run check` | 위 세 가지를 한 번에 |
