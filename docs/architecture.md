# 아키텍처 설계

네이버 검색 수요를 기준으로 주제를 정하고, Codex/Claude CLI로 채널별 원고를 쓴 뒤,
사람이 검수·승인한 글만 각 채널로 내보내는 로컬 도구다. Windows PC에서 상시 실행하는 것을 전제로 한다.

> 이전 구조(NestJS API + Next 관리자, 축 조합 슬롯 방식)는 `archive/legacy-content-ops` 브랜치에 보관돼 있다.
> 필요한 코드는 `git show archive/legacy-content-ops:<경로>`로 꺼내 옮긴다.

## 1. 전체 흐름

```
① 키워드 수집   네이버 검색광고 API(keywordstool) 최근 30일 PC·모바일 검색량 + 데이터랩 추세
② 주제 후보     유사 키워드 묶기 → 대표/보조 키워드 → 채널·섹션 배정 → 점수화
③ 주제 선택     운영자가 후보를 골라 생성 큐에 넣는다
④ 생성          CLI 작성 → 유사도 검사 → 품질 게이트 → 기준 미달 시 재작성
⑤ 검수          운영자가 수정 후 승인 또는 반려
⑥ 내보내기      채널 형식(MD/HTML/카페 원고)으로 복사·파일 저장
⑦ 발행 완료     실제 게시 URL 입력 (이후 성과 추적 기준)
```

글 상태: `draft → review → approved → exported → published` (반려 시 `rejected`).

## 2. 채널

정의는 `src/channels.ts`. 섹션 추가는 해당 채널 `sections`에 항목 하나를 더하면 된다.

| 채널 | 주제 영역 | 섹션 | 형식 |
| --- | --- | --- | --- |
| `drivingplus-community` | 학원 찾기·비교·추천, 시험 정보 | `drive_story`, `exam_procedure_guide`, `test_center_guide` | Markdown |
| `drivingzone-blog` | 면허 취득 | `blog` | HTML |
| `dztraining-blog` | 장롱면허·연수 | `blog_training` | HTML |
| `drivingzone-cafe` | 면허 취득 + 장롱면허·연수 (원고만) | `cafe` | 카페 원고 |

채널은 운영 브랜드(`drivingplus`, `drivingzone`)에 속한다. 브랜드는 작성 가이드를 공유한다.

유사도 비교는 **채널 전체**를 대상으로 한다. 같은 주제를 여러 채널에 쓰면 채널끼리가 가장 큰 유사문서 위험이다.

## 3. 작성 가이드 (유의사항)

글 생성 시 반드시 지켜야 하는 운영 규칙과 사실. 운영자가 **설정 화면(`/settings/guides`)**에서 관리한다.

- 저장: DB `guide_rules` (scope, group_name, text, enabled, sort_order). `guides/*.md`는 DB가 비었을 때 한 번 가져오는 초기값.
- 적용 범위(scope): `common` → `brand:<drivingplus|drivingzone>` → `channel:<채널 id>` 순으로 겹쳐 적용(`loadGuideRules`).
- 생성 프롬프트에 필수 규칙으로 들어가고(P3), 품질 게이트에서 본문 숫자(시간·금액·비율)의 근거 자료로도 쓴다.
- 서버에 로그인이 없으므로 `127.0.0.1`에만 연다.

## 4. 키워드 수집·주제 후보 (P2)

```
seeds/<채널>.md 시드 ──▶ 검색광고 API keywordstool (5개씩, 30일 PC+모바일 검색 수)
   ──▶ 공통 필터(seeds/common.md) + 섹션 필터(포함어·제외어) + 최소 검색 수
   ──▶ keyword_stats(수집일 스냅샷) · keyword_sources 저장
   ──▶ 지역 판정(시군구 252곳 별칭 사전) · 글 유형 판정(규칙)
   ──▶ 묶기: 같은 지역 + 같은 글 유형 + 지역명 뺀 글자 2-gram Jaccard ≥ 0.5
   ──▶ 점수 = log10(검색 수) × 경쟁도 × 추세(선택) ÷ (1 + 0.5×같은 채널 유사 글 + 같은 브랜드 다른 채널의 같은 주제 글)
   ──▶ topics (channel, section, topic_key) 기준 갱신. 운영자 상태(건너뜀 등)는 유지
```

- 연관 키워드는 범위가 매우 넓다(시드 하나에 수백 개). 섹션별 포함어·제외어로 섹션·채널 간 주제를 가른다.
- 네이버는 띄어쓰기 변형("운전 연수" / "운전연수")을 따로 집계하므로 버리지 않고 합산한다.
- 글 유형이 다르면 글자가 비슷해도 묶지 않는다("운전연수"가 "운전연수비용"을 흡수하지 않게).
- "연수"(인천 연수구)처럼 운전 용어와 겹치는 지역 별칭은 지역으로 보지 않는다.
- **브랜드 단위 판단**: 운전면허PLUS와 드라이빙존(블로그·연수 블로그·카페)은 주제가 겹쳐도 서로 감점하지 않는다(2026-09-28 결정). 운전면허PLUS도 연수·장롱면허를 운전학원 관점으로 다룬다. 같은 브랜드 안에서는 한 채널에 쓴 주제의 다른 채널 점수를 낮춘다.
- 겹치는 주제는 **글 양식으로 구분**한다. 프롬프트를 채널 × 글 유형 단위로 따로 둔다(P3, `prompts/<채널>/<글 유형>.md`). 같은 섹션 안에서도 글 유형이 다르면 프롬프트가 다르다.
- 운전면허PLUS 섹션 배치: 학원 전반·학원 연수 → `drive_story`, 시험 절차·면허 종류 → `exam_procedure_guide`, 시험장과 시험장 업무(적성검사·갱신·재발급) → `test_center_guide`. 면허 관리 주제(적성검사만 월 약 3.3만 회)가 커지면 api.drive에 이미 있는 `license_tips` 섹션으로 분리한다.

## 5. 모듈 구성 (예정 포함)

```
src/
  main.ts         진입점 (npm start)
  config.ts       config.json 로드·검증. 모든 값에 기본값
  paths.ts        경로 해석 (~, 상대 경로, Windows 구분자)
  channels.ts     브랜드·채널·섹션 정의
  guides.ts       작성 가이드(유의사항) 저장·조회·초기값 가져오기
  web/            로컬 관리 화면 (layout, guides: 유의사항 설정)
  server.ts       로컬 HTTP 서버 (Hono)
  app.ts          DB·큐·LLM·작업 핸들러 조립
  doctor.ts       설치·설정 점검 (npm run doctor)
  db/             node:sqlite 스키마·마이그레이션(user_version)
  llm/            command(실행 파일 찾기) · process(실행·트리 종료) · providers(인자·출력 파싱·사용률)
                  · limits(한도 판정) · client(순서·쉬기·기록)
  queue/          queue(jobs 테이블) · pacer(생성 간격·일일 한도) · worker(폴링 루프)
  sources/        drivingplus(학원·실내연습장) · drivingzone(지점) · http(응답 캐시)
  keywords/       searchad(검색광고 API) · datalab(추세, 선택) · seeds(시드·필터 파일)
                  · regions(지역 별칭) · cluster(키워드 묶기)
  topics/         intent(글 유형 규칙) · planner(수집→묶기→점수→저장) · store(조회·상태)
  cli/collect.ts  npm run collect
  writer/         채널별 프롬프트 (SEO/AEO/GEO 구조, 톤, 형식)             [P3]
  similarity/     shingle 유사도, 목차 구조 비교, 같은 유형 "피할 패턴"     [P3]
  quality/        품질 게이트 (기존 규칙 중 유효한 것 이식)                 [P3]
  export/         채널별 결과물                                            [P4]
  web/            검수·승인·내보내기 UI                                    [P4]
```

TypeScript는 Node 24의 타입 스트리핑으로 **빌드 없이** 실행한다(`node src/main.ts`).
그래서 import는 `.ts` 확장자를 쓰고, enum·namespace 같은 비소거 문법은 쓰지 않는다(`erasableSyntaxOnly`).

## 6. DB 테이블 (P1에서 확정)

| 테이블 | 내용 |
| --- | --- |
| `keyword_stats` | 키워드, PC·모바일 월간 검색량, 경쟁도, 수집 시각 (스냅샷 누적) |
| `topics` | 대표·보조 키워드, 채널·섹션, 점수, 상태 |
| `articles` | 채널·섹션, 글 유형, 제목, 본문, 설명, 노출 대상(audience), 상태, 게시 URL |
| `article_fingerprints` | 목차, 도입부, shingle 해시 — 유사도 비교용 |
| `jobs` | 종류, 상태, 다음 실행 시각, 시도 횟수, 오류 |
| `llm_usage` | 프로바이더별 호출 결과, 한도 해제 시각 |

## 7. LLM 호출과 사용량 한도

- 기존 방식 유지: `codex exec` / `claude --print`를 서브프로세스로 실행하고 OAuth 로그인을 쓴다. Claude 경로는 `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`을 제거해 구독 인증을 강제한다.
- **사용률을 미리 읽어 멈춘다.**
  - Claude: `--output-format stream-json`의 `rate_limit_event`가 5시간·주간 창의 사용률과 리셋 시각을 준다.
  - Codex: `exec --json`에는 없고, 세션 로그(`~/.codex/sessions/YYYY/MM/DD/rollout-*-<thread_id>.jsonl`)의 `rate_limits`에 있다. 그래서 `--ephemeral` 없이 실행해 스레드 id로 로그를 찾는다.
  - 어느 창이든 `llm.pauseAtUsagePercent` 이상이면 그 창의 리셋 시각까지 해당 프로바이더를 쉰다(`provider_state`).
- **그래도 한도에 걸리면** 거절 이벤트나 오류 문구(usage limit, 429, "try again in/at …", epoch)에서 해제 시각을 읽고, 없으면 `llm.limitCooldownMin`만큼 쉰다.
- `llm.order` 순서로 다음 프로바이더로 넘어가고, 모두 쉬는 중이면 작업을 **실패가 아닌 보류**(`defer`, 시도 횟수 미차감)로 돌린다.
- 평상시에도 `pacing` 간격(무작위)과 일일 한도를 지킨다(`Pacer`).
- CLI는 저장소 밖 빈 폴더(OS 임시 폴더 `ai-community-writer-llm`)에서 실행한다. 저장소 안에서 실행하면 이 저장소의 CLAUDE.md/AGENTS.md가 글 작성에 섞인다. Claude는 도구·MCP·세션 저장을 끈다.
- Windows: npm 전역 설치 `.cmd`는 내부 JS 진입점을 찾아 `node <js>`로 직접 실행하고(셸 인용 문제 회피), 타임아웃 시 `taskkill /T /F`로 트리째 종료한다.

## 8. 외부 시스템 현황 (2026-09-28 조사)

- **api.drive 커뮤니티**
  - `community_post` + `community_post_audience`(scope: EVERYWHERE/RADIUS/ACADEMIES/SERVICE_REGIONS/MIXED) 구조는 있으나, 목록 API의 노출 대상 필터(`applyAudienceFilter`)는 미구현이다. 웹이 항상 위치를 보내므로 현재는 모든 글이 전국에 노출된다.
  - 목록 조회가 `community_post_filter`를 INNER JOIN하므로 필터가 없는 글은 목록에 나오지 않는다. 내보낼 때 섹션·필터를 필수로 둔다.
  - 글 작성 API가 없다 (P6에서 추가).
- **web.drivingplus 커뮤니티**: 글 상세 메타데이터에 description·JSON-LD가 없고, sitemap에서 제외돼 있다 (P5).
- **학원·실내연습장 데이터** (`src/sources/`, 24시간 캐시, 갱신 실패 시 이전 캐시 사용)
  - api.drive `GET /v1/academy/get-all-academy` — 인증 없음, 약 4MB, 384곳(실내연습장 17곳 포함). 가격 관측치·공시 수강료·셔틀·운영시간·사진·리뷰. 학원 SEO 문구(`seo*`)는 우리가 만든 홍보 문구라 근거에서 뺀다.
  - api.drivingzone `GET /v1/store`(27곳) + `GET /v1/store/:id` — 인증 없음, 운영시간·지하철·강사·리뷰. 합격률·평균 소요일이 0이면 미집계로 본다.
  - ⚠️ 지점 API가 대표자명·사업자번호·SMS 수신 번호를 공개 응답에 포함한다. 정규화는 화이트리스트로 해당 필드를 버리지만, api.drivingzone 쪽에서도 응답에서 빼야 한다.
- **drivingzone / dztraining 블로그**: 같은 `article` 테이블(board type `blog` / `blog_training`), 글 작성은 PHP 관리자(세션 인증)만 가능.

## 9. 단계

| 단계 | 내용 |
| --- | --- |
| P0 | 기존 구조 정리, 새 골격 (설정·채널 정의·작성 가이드·서버 진입점·테스트) |
| P1 | DB, Windows 대응 LLM 러너와 한도 대응, 작업 큐, 원천 데이터 조회, `npm run doctor` |
| P2 | 키워드 수집·묶기, 주제 후보, `npm run collect`, `/api/topics` |
| P3 | 채널별 프롬프트, 유사도 검사, 품질 게이트 |
| P4 | 검수·승인·내보내기 UI |
| P5 | web.drivingplus 커뮤니티 SEO(description, JSON-LD, 글이 생기면 sitemap 자동 포함), api.drive 노출 대상 필터 구현 |
| P6 | api.drive / api.drivingzone 글 작성 API → 자동 발행 전환 |
