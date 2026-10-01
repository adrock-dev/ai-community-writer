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

## Windows PC 설치 (상시 실행 PC)

### 1. 프로그램 설치 (PowerShell)

```powershell
winget install OpenJS.NodeJS      # Node.js 24 이상 (node -v 로 확인)
winget install Git.Git
```

설치 후 PowerShell을 새로 엽니다(PATH 반영).

### 2. 글 생성 CLI 설치·로그인

```powershell
npm i -g @openai/codex
codex login                        # 브라우저에서 ChatGPT 계정 로그인
npm i -g @anthropic-ai/claude-code
claude                             # 처음 실행 때 로그인 후 /exit
```

하나만 있어도 되지만 둘 다 두면 한도에 걸렸을 때 다른 쪽으로 넘어갑니다. **삽화 생성은 Codex로만** 하므로 Codex는 필수입니다.

### 3. 코드 받기

```powershell
cd $HOME
git clone -b develop git@github.com:adrock-dev/ai-community-writer.git
cd ai-community-writer
npm install
```

비공개 저장소라 이 PC의 GitHub SSH 키가 등록돼 있어야 합니다(`https://github.com/...` 주소로 받으면 로그인 창이 뜹니다).

### 4. 비밀값 파일 두기

사용자 폴더(`C:\Users\<사용자>\`)에 두 파일을 둡니다. 메신저·메일 말고 USB 등으로 직접 옮깁니다.

| 파일 | 내용 |
| --- | --- |
| `.naver-searchad.env` | 네이버 검색광고 API 키(키워드 수집) — [설정](#설정)의 `naver.searchadEnvFile` |
| `.ai-community-writer.env` | 발행 API 키 — [자동 발행](#자동-발행). **운영 서버의 `WRITER_API_KEY`와 같은 값**이어야 합니다 |

프로젝트 폴더에 두려면 `secrets\` 폴더(git 제외)에 넣고 `config.json`에 경로를 적습니다. 상대 경로는 프로젝트 폴더 기준입니다.

```json
{
  "naver": { "searchadEnvFile": "secrets/naver-searchad.env" },
  "publish": { "credentialsFile": "secrets/ai-community-writer.env" }
}
```

### 5. 설정

기본값이 운영 서버(`sources.profile=prod`, 운영 사이트 주소)라 **`config.json`은 만들지 않아도 됩니다.**
개발 PC의 `config.json`(dev 서버 주소)은 복사하지 않습니다. 하루 생성 편수·생성 간격 등을 바꿀 때만
`copy config.example.json config.json` 후 필요한 항목만 남깁니다.

### 6. 점검

```powershell
npm run doctor           # 설치·로그인·API 연결·발행 키 확인
npm run doctor -- --llm  # CLI를 실제로 한 번 호출 (사용량 조금 소모)
```

### 7. 실행

```powershell
npm start
```

브라우저에서 **http://127.0.0.1:8787** → 주제 화면 **키워드 수집** → 주제 **생성 예약** → 글 검수에서 수정·**승인** → **지금 게시**(또는 내보내기).

- PowerShell 창을 닫으면 멈춥니다. 켜 둔 채로 둡니다.
- 절전 모드에 들어가면 작업이 멈추므로 전원 설정에서 절전을 끕니다.

### 8. (선택) 로그온 시 자동 실행

작업 스케줄러 → 작업 만들기 → 트리거 "로그온할 때", 동작 "프로그램 시작":

- 프로그램: `npm.cmd`
- 인수: `start`
- 시작 위치: `C:\Users\<사용자>\ai-community-writer`

### 알아 둘 점

- 유의사항·주제·글은 그 PC의 `data/writer.db`에만 저장됩니다. 새 PC는 `guides/*.md` 초기값으로 시작하므로,
  다른 PC에서 고친 유의사항을 가져오려면 `data/writer.db`를 같은 위치로 복사하거나(글·주제도 함께 옮겨짐) 설정 화면에서 다시 입력합니다.
- 업데이트: `git pull` → `npm install` → `npm start` 다시 실행.

## CLI 업데이트 (Codex / Claude)

Codex·Claude CLI는 자주 갱신되고, 오래된 버전은 로그인·모델·사용률 기록 형식이 달라 생성이 실패할 수 있습니다.
**도구 서버(`npm start`)를 멈춘 뒤** 업데이트합니다(실행 중인 CLI 파일은 Windows에서 덮어쓰지 못합니다).

```powershell
codex --version                      # 현재 버전
npm i -g @openai/codex@latest        # 최신으로 업데이트
codex --version                      # 바뀐 버전 확인

claude --version
claude update                        # Claude 는 자체 업데이트 명령이 있다 (또는 npm i -g @anthropic-ai/claude-code@latest)
```

- 로그인은 유지됩니다. "로그인 필요" 오류가 나면 `codex login` / `claude`로 다시 로그인합니다.
- 업데이트 후 `npm run doctor -- --llm`으로 실제 호출이 되는지 확인하고 `npm start`로 다시 켭니다.
- 문제가 생기면 이전 버전으로 되돌립니다: `npm i -g @openai/codex@<버전>` (버전 목록: `npm view @openai/codex versions`).
- `EBUSY`·`EPERM` 오류가 나면 Codex·Claude를 쓰는 창(이 도구, 터미널, VS Code 확장)을 모두 닫고 다시 실행합니다.

## 관리 화면

`npm start` 후 브라우저에서 **http://127.0.0.1:8787** 을 엽니다.

| 화면 | 하는 일 |
| --- | --- |
| 대시보드 `/` | 검수 대기·초안·승인·내보냄 수, LLM 사용률, 다음 생성 가능 시각 |
| 주제 `/topics` | 채널·섹션별 주제 후보(30일 검색 수·점수), **생성 예약**, 건너뛰기, 키워드 수집 실행, **다른 채널로 예약**(주제 재활용), **주제 직접 추가**(여러 채널·글 방향) |
| 글 검수 `/articles` | 상태별 목록 → 글 상세에서 미리보기·남은 문제·근거 자료·이미지·생성 기록 확인, **수정·승인·반려·다시 생성** |
| 자동 발행 (글 상세) | 승인한 글을 **지금 게시** — 운전면허PLUS 커뮤니티·드라이빙존 블로그·연수 블로그. 카페는 원고만 |
| 내보내기 (글 상세) | 승인한 글을 채널 형식으로 복사(필드별 복사, 본문 복사, 서식 포함 복사), **내보내기 폴더 만들기**(이미지 포함), 게시 URL 입력 → 발행 완료 |
| 작업 `/jobs` | 작업 큐 상태, 대기 사유(생성 간격·사용량 한도), 오류, 취소 |
| 유의사항 설정 `/settings/guides` | 작성 가이드 관리 |
| 삽화 설정 `/settings/images` | 생성 삽화 화풍(사진풍·일러스트·섞어서)을 공통·채널별로 선택. 저장하면 재시작 없이 다음 글부터 적용, config.json 값보다 우선 |

글 상태: 검수 대기(review) / 초안(draft, 문제 남음) → **승인** → 내보냄 → 발행. 어느 단계에서든 반려할 수 있고, 승인한 글을 고치면 다시 검수 대기가 됩니다.
초안은 "남은 문제를 확인했습니다"에 체크해야 승인됩니다.

내보내기 폴더(`output/exports/<글 번호>-<채널>/`): 채널 형식 본문(`본문.md`/`본문.html`/`본문.txt`), 서식 복사용 HTML, `images/`(본문의 모든 이미지), `안내.txt`(제목·설명·키워드·섹션·노출 지역·직접 올려야 할 생성 삽화).

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
| `writer.linkChance` | `0.3` | 자사 사이트 링크(요금·지점 안내 등, 채널 `linkTargets`)를 넣을 수 있는 글의 비율. 글마다 무작위로 정하며 0이면 넣지 않음 |
| `images.style` | `photo` | 생성 삽화 화풍(관리 화면 `/settings/images`에서 저장하면 그 값이 우선). `photo`(사진풍) / `illustration`(일러스트) / `mixed`(글마다 둘 중 무작위, 한 글 안에서는 같은 화풍). 학원·지점 실제 사진에는 영향 없음 |
| `images.styleByChannel` | `{}` | 채널별 삽화 화풍(채널 id → `photo` / `illustration` / `mixed`). 적지 않은 채널은 `images.style`. 예: `{ "drivingzone-blog": "illustration" }` |
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
| `publish.credentialsFile` | `~/.ai-community-writer.env` | 발행 API 키 파일 (`DRIVINGPLUS_WRITER_API_KEY`, `DRIVINGZONE_WRITER_API_KEY`) |
| `publish.drivingplusApi` / `drivingzoneApi` | 빈 값 | 발행할 API 서버. 비우면 `sources` 주소 |
| `publish.drivingplusSiteUrl` / `drivingzoneSiteUrl` / `dztrainingSiteUrl` | 운영 사이트 | 게시 주소(published URL)를 만들 사이트 |
| `publish.indexNowKeys.drivingplus` / `drivingzone` / `dztraining` | 운전면허PLUS 공개 키 / 빈 값 | 발행 뒤 IndexNow 통보 키(사이트 루트 `{key}.txt`와 같아야 함). 비우면 통보 안 함 |
| `publish.timeoutSec` | `60` | 발행 요청 제한 시간 |

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

**주제 재활용**: 주제는 채널 하나에 묶이지 않습니다. 주제 화면의 **다른 채널로 예약**은 그 채널·섹션에 같은 키워드의 주제를 만들고(이미 있으면 그 주제) 생성을 예약합니다. 지역 주제는 운전면허PLUS 커뮤니티 안에서만 옮길 수 있습니다. 같은 주제로 다른 채널에 쓴 글은 생성 때 "피해야 할 기존 글" 맨 앞에 들어가고, 유사도 검사도 그대로 거칩니다.
검색 키워드에서 나오지 않는 주제(예: 운전면허학원 가기 전 드라이빙존 연습)는 **주제 직접 추가**로 만듭니다. 대표 키워드·글 유형·글 방향을 넣고 채널을 여러 개 고르면 채널마다 주제가 생깁니다. 글 방향은 프롬프트에 들어가지만, 글에 쓰는 숫자·조건은 유의사항과 근거 자료에 있는 것만 씁니다(그런 운영 사실은 유의사항에 넣습니다). 30일 검색 수는 수집 기록에서 찾고, 없으면 검색광고 API로 조회합니다. 다시 수집해도 직접 고른 글 유형과 글 방향은 유지됩니다.

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

## 글 생성

```powershell
npm run generate -- --channel=dztraining-blog              # 그 채널 점수 1위 주제로 1편 생성
npm run generate -- --channel=drivingplus-community --type=cost   # 글 유형 지정
npm run generate -- --topic=161                            # 주제 번호 지정
npm run generate -- --topic=161 --dry                      # LLM 호출 없이 프롬프트만 보기
```

생성된 글은 DB에 저장되고 `output/articles/<글 번호>-<채널>.md`로도 떨어집니다.
실행 중인 서버에서는 `POST /api/topics/<주제 번호>/generate`로 예약하면 워커가 생성 간격·사용량 한도에 맞춰 씁니다.
다른 채널에서 다시 쓰려면 먼저 `POST /api/topics/<주제 번호>/copy`(본문 `{"channelId": "...", "sectionCode": "..."}`)로 그 채널의 주제를 만들고, 돌려받은 주제 번호로 예약합니다.

생성 과정의 기본 규칙:

- **사실만 씁니다.** 특히 학원·실내운전연습장에 대한 서술은 근거 자료(학원·지점 데이터)와 유의사항에 있는 것만 씁니다. 기계 검사를 통과한 원고는 LLM이 한 번 더 **사실 검증**을 해서 근거 없는 문장을 찾아 고쳐 쓰게 합니다.
- **금액은 "25만원", "62만 7천원"** 처럼 만 단위로 쓰고, 금액이 나오는 문장·표에는 **부가세 포함·별도**를 반드시 적습니다. 드라이빙존 요금은 부가세 별도입니다(`src/sources/drivingzone.ts`의 `DRIVINGZONE_PRICE_VAT_INCLUDED`). 유의사항 "공단 안내" 묶음에 있는 도로교통공단 수수료·과태료만 쓴 문장·표는 부가세 표기 없이 통과합니다.
- **이미지는 2장 이상** 넣습니다. 학원·지점의 실제 사진을 먼저 쓰고, 모자라면 Codex CLI 이미지 생성으로 삽화를 만듭니다(`data/images/`, 서버 `/images/<파일>`, 화풍은 `images.style`). 삽화에는 글자·로고·얼굴을 넣지 않고 실제 장소처럼 소개하지 않습니다.

- **검수 대기(review)**: 품질·유사도 검사를 통과한 글
- **초안(draft)**: 3번 고쳐 써도 문제가 남은 글. 남은 문제는 글에 함께 저장됩니다(`/api/articles/<번호>`의 `qualityIssues`)
- 어느 쪽이든 사람이 검수·승인하기 전에는 내보내지 않습니다(P4).

**글 양식 바꾸기**: `prompts/` 폴더의 Markdown을 고칩니다.

| 파일 | 역할 |
| --- | --- |
| `prompts/base.md` | 모든 글 공통 원칙 (SEO·AEO·GEO, 사실 원칙, 금지 표현) |
| `prompts/channels/<채널>.md` | 채널 목소리·분량·마무리 방식 |
| `prompts/types/<글 유형>.md` | 글 유형별 구성 (비용·추천·시험·연수 등 12종) |
| `prompts/channels/<채널>/<글 유형>.md` | 특정 채널에서 그 유형만 다르게 쓸 때 (있으면 위 파일 대신 사용) |

## 자동 발행

승인한 글은 글 상세의 **지금 게시**로 대상 사이트에 바로 올립니다(작업 화면에서 진행 확인). 사람이 승인하지 않은 글은 올리지 않습니다.

| 채널 | 대상 | 비고 |
| --- | --- | --- |
| 운전면허PLUS 커뮤니티 | api.drive `PUT /v1/writer/community/posts/:sourceKey` | 섹션·칸(필터)은 채널 정의 규칙으로, **지역 글은 노출 대상 지역**까지 지정. 발행 뒤 IndexNow 통보 |
| 드라이빙존 블로그 / 연수 블로그 | api.drivingzone `PUT /v1/writer/articles/:sourceKey` | 본문은 에디터 HTML, 첫 이미지를 목록 썸네일로 올림. 지역 지정 없음 |
| 드라이빙존 카페 | — | 원고만 (내보내기에서 복사) |

- 생성 삽화는 이 PC에만 있으므로 대상 서버에 먼저 올리고 본문 주소를 바꿉니다. 올린 이미지는 기억해 두어 다시 보내도 또 올리지 않습니다.
- 같은 글을 다시 보내면 대상 사이트에서는 **수정**이 됩니다(글마다 고유 식별자 `aiw-<설치 id>:<글 번호>`).
- 발행 API 키는 저장소 밖 파일(`publish.credentialsFile`, 기본 `~/.ai-community-writer.env`)에 둡니다. 키 값은 각 서버의 `WRITER_API_KEY` 와 같아야 합니다.

  ```
  DRIVINGPLUS_WRITER_API_KEY=...
  DRIVINGZONE_WRITER_API_KEY=...
  ```

  같은 이름의 환경 변수가 있으면 그것을 우선합니다. 키가 없으면 그 브랜드는 내보내기(복사)만 됩니다. `npm run doctor` 가 키·서버 설정을 확인합니다(글은 만들지 않음).
- 대상 서버 준비(한 번): api.drive `WRITER_API_KEY`·`WRITER_ADMIN_ID` + DDL(`2026092803`·`2026092804`), api.drivingzone `WRITER_API_KEY`·`WRITER_USER_ID`·`WEB_REVALIDATION_SECRET` + DDL(`2026092801`).

## 유의사항 설정 (작성 가이드)

글을 쓸 때 반드시 지켜야 하는 운영 규칙과 사실은 **`http://127.0.0.1:8787/settings/guides`** 화면에서 관리합니다.

- 적용 범위: 공통 → 브랜드 전체(운전면허PLUS / 드라이빙존) → 채널별. 넓은 범위부터 겹쳐 적용됩니다.
- 규칙마다 묶음 이름(예: 교육 운영)을 붙일 수 있고, 삭제하지 않고 **사용 끄기**도 할 수 있습니다.
- 화면 아래 "채널별 최종 적용 미리보기"에서 생성 프롬프트에 들어갈 형태를 확인합니다.
- 규칙에 적힌 숫자(시간·금액·비율)는 품질 검사에서 본문 숫자의 근거로도 씁니다.

예) 드라이빙존 전체 → 요금 → `드라이빙존 요금은 부가세 미포함(별도) 가격이다`

규칙은 그 PC의 DB에 저장됩니다. `guides/*.md`는 DB가 비어 있는 첫 실행 때 가져오는 초기값이자 **PC 사이 동기화용 파일**입니다.

**다른 PC와 맞추기 (git)** — 화면 맨 위 "파일 동기화" 카드에서 합니다. 자동으로 덮어쓰지 않습니다.

1. 규칙을 고친 PC: **파일에 저장** (DB → `guides/common.md`, `guides/<브랜드>.md`, `guides/channels/<채널>.md`)
2. `git add guides` → `git commit` → `git push`
3. 받을 PC: `git pull` → **파일에서 불러오기** (guides 파일로 그 PC의 규칙을 **전부 교체**)

카드의 표시("guides 폴더와 같음/다름")로 저장·불러오기가 필요한지 알 수 있습니다. 두 PC에서 따로 고치면 나중에 불러온 쪽이 이기므로, 규칙은 한 PC에서 고치고 저장하는 것을 권장합니다.
파일에서 `(사용 안 함)`으로 시작하는 규칙은 꺼진 규칙이고, `## (묶음 없음)`은 묶음 이름이 없는 규칙입니다.
서버는 기본적으로 이 PC(`127.0.0.1`)에서만 접속되며, 별도 로그인이 없으므로 `server.host`를 외부에 열지 마세요.

## 개발 명령

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | 파일 변경 시 자동 재시작 |
| `npm run doctor` | 설치·설정 점검 |
| `npm run collect` | 키워드 수집·주제 후보 갱신 |
| `npm run generate` | 글 1편 생성 (`--dry`: 프롬프트만) |
| `npm run typecheck` | 타입 검사 |
| `npm run lint` / `npm run format` | Biome 린트 / 포맷 |
| `npm test` | 단위 테스트 (vitest) |
| `npm run check` | 위 세 가지를 한 번에 |
