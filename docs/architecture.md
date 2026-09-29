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
| `drivingplus-community` | 학원 찾기·비교·추천, 시험 정보 | `drive_story`, `exam_procedure_guide`, `license_tips` | Markdown |
| `drivingzone-blog` | 면허 취득 | `blog` | HTML |
| `dztraining-blog` | 장롱면허·연수 | `blog_training` | HTML |
| `drivingzone-cafe` | 면허 취득 + 장롱면허·연수 (원고만) | `cafe` | 카페 원고 |

채널은 운영 브랜드(`drivingplus`, `drivingzone`)에 속한다. 브랜드는 작성 가이드를 공유한다.

유사도 비교는 **채널 전체**를 대상으로 한다. 같은 주제를 여러 채널에 쓰면 채널끼리가 가장 큰 유사문서 위험이다.

## 3. 작성 가이드 (유의사항)

글 생성 시 반드시 지켜야 하는 운영 규칙과 사실. 운영자가 **설정 화면(`/settings/guides`)**에서 관리한다.

- 저장: DB `guide_rules` (scope, group_name, text, enabled, sort_order). `guides/*.md`는 DB가 비었을 때 가져오는 초기값이자 PC 간 동기화 파일: 설정 화면 "파일에 저장"(DB → 파일, 범위마다 파일 하나 `common.md`·`<브랜드>.md`·`channels/<채널>.md`)과 "파일에서 불러오기"(파일 → DB 전부 교체)로 git 을 거쳐 주고받는다. 자동 덮어쓰기는 하지 않는다.
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
- **지역 글은 운전면허PLUS 커뮤니티만 쓴다**(채널 정의 `regional`, 2026-09-28 결정). 드라이빙존 블로그·연수 블로그·카페에서는 지역 키워드("강남운전연수")를 주제 후보에서 빼고, 예전에 만들어진 지역 후보는 다음 수집 때 지운다. 근거 자료도 지역으로 좁히지 않고, 노출 대상(audience)도 운전면허PLUS만 지정한다.
- **브랜드 단위 판단**: 운전면허PLUS와 드라이빙존(블로그·연수 블로그·카페)은 주제가 겹쳐도 서로 감점하지 않는다(2026-09-28 결정). 운전면허PLUS도 연수·장롱면허를 운전학원 관점으로 다룬다. 같은 브랜드 안에서는 한 채널에 쓴 주제의 다른 채널 점수를 낮춘다.
- 겹치는 주제는 **글 양식으로 구분**한다. 프롬프트를 채널 × 글 유형 단위로 따로 둔다(P3, `prompts/<채널>/<글 유형>.md`). 같은 섹션 안에서도 글 유형이 다르면 프롬프트가 다르다.
- 운전면허PLUS 섹션 배치: 학원 전반·학원 연수 → `drive_story`(칸 `driving_info`), 시험 절차·면허 종류 → `exam_procedure_guide`(칸 `theory_exam`·`skill_test`·`road_test`·`examinee_guide`), 시험장과 면허 업무(적성검사·갱신·재발급) → `license_tips`(칸 `test_center`·`license_care`, 2026-09-28 신설). 시험장 안내 탭(`test_center_guide`)은 글이 아니라 시험장 목록이라 글을 올려도 보이지 않는다. 칸 배정 규칙은 `channels.ts` 섹션의 `filters`(`resolveFilterCodes`).

## 5. 글 생성 (P3)

```
주제(topic) ─┬─ 유의사항: 공통 → 브랜드 → 채널 (guide_rules)
             ├─ 근거 자료: 운전면허PLUS → api.drive 학원(지역이면 해당 지역 학원, 아니면 전국 집계)
             │            드라이빙존   → api.drivingzone 지점·요금제(license / training)
             └─ 피할 패턴: 같은 글 유형 기존 글의 제목·소제목·도입부 (같은 브랜드 6 + 다른 브랜드 3)
        ▼
프롬프트 = base.md + channels/<채널>.md + (channels/<채널>/<유형>.md | types/<유형>.md) + 주제 + 위 3가지 + 출력 형식
        ▼
이미지: 실제 사진(학원·지점) → 2장보다 적으면 Codex CLI 이미지 생성으로 삽화 보충
        ▼
LLM(CLI) → 구분자 형식 해석 → 품질 게이트 + 유사도 검사 → (통과 시) LLM 사실 검증
        ├─ 문제 있음 → 문제 목록을 붙여 전체 재작성 (최대 3회)
        └─ 저장: 이미지 번호(img1)를 실제 주소로 바꾸고, 문제 없으면 status=review, 남으면 status=draft + quality_issues
```

- **사실 검증**(`src/quality/factcheck.ts`): 학원·실내운전연습장에 대한 구체 서술(요금·시설·장비·강사·셔틀·합격률·후기·평가), 근거와 다른 숫자·조건, 근거 없는 법령 수치, 지어낸 후기를 JSON으로 받아 재작성 지시로 되돌린다. 기계 검사를 통과한 원고에만 돌려 LLM 호출을 아낀다.
- **금액**: 근거 자료부터 "25만원" 표기(`src/writer/money.ts`)와 부가세 포함 여부를 붙인다. 게이트는 만 단위 미사용 금액, 부가세 표기가 없는 문단·표(표는 바로 앞뒤 설명까지)를 잡는다. 드라이빙존 요금은 부가세 별도(운영 확인 2026-09-28).
- **이미지 배치**: 드라이빙존 매장 사진은 비용·추천 글이 아니면 **드라이빙존 안내 섹션에만 1장까지** 쓰고(`sectionMustMention`, 게이트가 섹션 내용으로 확인), 본문 이미지 최소 장수는 글 유형 삽화로 채운다. 시험 절차 섹션에 매장 사진이 뜬금없이 들어가던 문제(2026-09-29) 때문이다.
- **이미지**: 실제 사진은 원천 공개 URL을 그대로 쓰고, 삽화는 `data/images/`에 저장해 `/images/<파일>`로 제공한다. Codex CLI 내장 `image_generation`을 저장소 밖 빈 폴더에서 `workspace-write`로 실행한다. 게이트: 2장 이상, 제공된 번호만, 대체 텍스트 필수, 중복·연속 배치 금지.

- **프롬프트는 채널 × 글 유형 단위.** 같은 주제라도 운전면허PLUS(중립 비교 플랫폼)와 드라이빙존(브랜드 블로그)은 목소리·구성이 다르고, 같은 채널 안에서도 글 유형(비용·추천·시험·연수 …)마다 구성이 다르다. 채널 전용 유형 파일(`channels/<채널>/<유형>.md`)이 있으면 공통 유형 파일 대신 쓴다.
- **근거 자료**에는 원천 시스템 이름·URL을 넣지 않는다. 드라이빙존 공지 API의 비공개 필드는 정규화 단계에서 이미 버린다.
- **품질 게이트**(`src/quality/gate.ts`): 제목·설명 길이와 대표 키워드, 채널별 분량·H2 수·표·FAQ, 첫 문단 결론(AEO), 긴 문단·빈 소제목·키워드 반복, 내부 용어·AI 자기 언급·자리표시·각주·합격 보장 표현, **본문의 금액·비율이 근거 자료+유의사항에 있는지**(어림은 "약" 등을 붙인 10% 이내만), 추천 글의 후보 수 부풀리기.
- **유사도**(`src/similarity/fingerprint.ts`): 본문 글자 5-gram MinHash(64), 제목·소제목 2-gram 유사도. 같은 브랜드는 본문 0.3·제목 0.75·소제목 0.6, 다른 브랜드는 본문 0.45·제목 0.9 이상이면 재작성.
- 생성 작업은 `generate` 작업 큐로 돌며 생성 간격·일일 한도·LLM 사용량 대기를 따른다. LLM 한도로 멈추면 주제는 `queued`로 남아 재개된다.
- 근거 캐시는 정규화된 값을 저장하므로 정규화 규칙을 바꾸면 캐시 키 버전을 올린다.

## 5-1. 검수·내보내기 (P4)

```
review / draft ──수정──▶ 기계 검사 다시(LLM 없음) → review / draft
               ──승인──▶ approved ──내보내기──▶ exported ──게시 URL──▶ published
  (발행 전 어느 단계든) ──반려──▶ rejected   (반려 후 다시 생성 → 같은 주제로 generate 작업)
```

- 초안(문제 남음)은 검수자가 "남은 문제를 확인했습니다"를 체크해야 승인된다. 승인한 글을 고치면 approved_at을 지우고 검수 대기로 돌린다.
- 내보내기 형식(`src/export/`): 운전면허PLUS는 Markdown(content_format=md), 드라이빙존 블로그·연수 블로그는 에디터 HTML, 카페는 텍스트 + 서식 복사용 HTML. 대상 시스템의 제목 필드와 겹치지 않게 본문의 H1은 뺀다. 원고 속 원시 HTML은 글자로 바꾸고 스크립트 주소 링크는 막는다.
- 내보내기 폴더에는 본문의 모든 이미지를 담는다. 실제 사진은 공개 주소 그대로 두고 사본만, 생성 삽화는 `images/파일`로 바꿔 운영자가 직접 올리게 한다(P6 자동 발행에서 업로드 API로 대체).
- 관리 화면은 로그인이 없으므로 `127.0.0.1`에서만 연다.

## 5-2. 자동 발행 (P6)

```
approved / exported ──지금 게시──▶ publish 작업(LLM 없음, 재시도 3회)
   ① 생성 삽화 업로드(블로그는 첫 이미지를 썸네일로) — 올린 결과는 app_state 에 기억
   ② 본문 주소 교체, 제목 줄 제거 → 커뮤니티: Markdown / 블로그: 에디터 HTML
   ③ PUT <대상>/v1/writer/…/:sourceKey  (X-Writer-Key)   sourceKey = aiw-<설치 id>:<글 번호> → 다시 보내면 수정
   ④ published + published_url + external_id 기록, 실패하면 publish_error
   ⑤ IndexNow(키가 있는 사이트만 — 현재 운전면허PLUS)
```

- 대상: 채널 정의 `autoPublish`(`community` / `blog` / `none`). 카페는 원고만.
- 커뮤니티: 섹션 = `section.code`, 칸 = `resolveFilterCodes`, 지역 글(`regional` 채널만)은 `audienceAreas`(시도·시군구) → api.drive 가 광고 지구로 바꿔 `SERVICE_REGIONS` 저장.
- 블로그: 섹션 코드 = board type(`blog` / `blog_training`), 게시 주소는 사이트 `slugify(제목, id)` 규칙.
- 서버 계약: api.drive `docs/domains/community/api.md` §6.4, api.drivingzone `docs/writer-api.md`. 캐시 무효화는 서버가 저장 뒤 한다.
- 키는 저장소 밖 파일(`publish.credentialsFile`). 값은 화면·로그·doctor 에 출력하지 않는다.

## 6. 모듈 구성 (예정 포함)

```
src/
  main.ts         진입점 (npm start)
  config.ts       config.json 로드·검증. 모든 값에 기본값
  paths.ts        경로 해석 (~, 상대 경로, Windows 구분자)
  channels.ts     브랜드·채널·섹션 정의
  guides.ts       작성 가이드(유의사항) 저장·조회·초기값 가져오기
  web/            로컬 관리 화면 (dashboard · topics · articles(검수·내보내기) · jobs · guides)
  export/         render(채널 형식 변환) · bundle(내보내기 폴더)
  publish/        payload(요청 본문) · client(발행 API) · publisher(업로드→게시→기록→IndexNow)
  articles/       store(저장·조회) · review(검수 상태 전이·재검사)
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
  writer/         facts(근거 자료) · prompt(조립·재작성) · output(출력 해석) · generate(1편 생성)
  similarity/     fingerprint(MinHash·소제목·도입부, 피할 패턴, 유사 글 찾기)
  quality/        gate(품질 게이트) · factcheck(LLM 사실 검증)
  images/         generator(Codex CLI 삽화 생성) · scenes(글 유형별 장면)
  cli/generate.ts npm run generate (--dry: 프롬프트만 출력)
```

TypeScript는 Node 24의 타입 스트리핑으로 **빌드 없이** 실행한다(`node src/main.ts`).
그래서 import는 `.ts` 확장자를 쓰고, enum·namespace 같은 비소거 문법은 쓰지 않는다(`erasableSyntaxOnly`).

## 7. DB 테이블 (P1에서 확정)

| 테이블 | 내용 |
| --- | --- |
| `keyword_stats` | 키워드, PC·모바일 월간 검색량, 경쟁도, 수집 시각 (스냅샷 누적) |
| `topics` | 대표·보조 키워드, 채널·섹션, 점수, 상태 |
| `articles` | 채널·섹션, 글 유형, 제목, 본문, 설명, 노출 대상(audience), 상태, 게시 URL |
| `article_fingerprints` | 목차, 도입부, shingle 해시 — 유사도 비교용 |
| `jobs` | 종류, 상태, 다음 실행 시각, 시도 횟수, 오류 |
| `llm_usage` | 프로바이더별 호출 결과, 한도 해제 시각 |

## 8. LLM 호출과 사용량 한도

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

## 9. 외부 시스템 현황 (2026-09-28 조사)

- **api.drive 커뮤니티** (P5 반영, api.drive `60ff406`)
  - 노출 대상(audience)은 **목록·피처드만** 제한한다. 위치가 있으면 EVERYWHERE·audience 없음 + 반경 · 광고 지구(`SERVICE_REGIONS`, 역지오코딩 → `findIdsCoveringLocation`) · 그 지구의 광고 학원(`ACADEMIES`) · `MIXED`(OR). 위치가 없으면 전국 글만. 상세·사이트맵은 위치와 무관.
  - 지역 글은 `SERVICE_REGIONS` + 대상 시군구를 덮는 **광고 지구 id 전부**(`region_admin_area`)로 넣는다. 우리 주제의 지역(시도·시군구 이름)을 지구 id로 바꾸는 일은 P6 글 작성 API가 맡는다.
  - 목록 조회가 `community_post_filter`를 INNER JOIN하므로 필터가 없는 글은 목록에 나오지 않는다. 내보낼 때 섹션·필터를 필수로 둔다.
  - `GET /v1/community/sitemap-posts`(사이트맵용), 상세 응답 `updatedAt`·`seoKeywords`. 조회수 증가가 `updated_at`을 바꾸지 않는다.
  - 작성 도구 발행 API `/v1/writer/community`(P6, api.drive `160fe27`). 저장 후 웹 캐시 태그 `community-posts`·`community-post-{id}` 무효화. 시험장 안내 탭(`test_center_guide`)은 글 목록이 아니므로 시험장·면허 업무 글은 `license_tips`(칸 `test_center`·`license_care`).
- **api.drivingzone 블로그**: 작성 도구 발행 API `/v1/writer/articles`(P6, `74a00a1`). 저장 후 두 사이트 캐시(글 태그 + 목록 경로) 무효화. 블로그 사이트맵은 빌드 때만 갱신된다.
- **web.drivingplus 커뮤니티** (P5 반영, `ae9a0ad`, 문서 `docs/community/seo.md`)
  - 상세: 본문 sr-only SSR, description(`summary` → 본문 첫 문장), `Article`·`BreadcrumbList`·(FAQ 절이 있으면) `FAQPage` JSON-LD, ISR 1시간.
  - `/sitemap-community.xml`(ISR): 글이 생기면 자동으로 실리고, 0건이면 빈 urlset. robots.txt에 등록.
  - 그래서 원고 규칙이 곧 SEO 규칙이다: 본문에 H1 없음(내보내기에서 이미 뺌), `summary`가 description, `## 자주 묻는 질문` + `### 질문`이 FAQPage, 이미지는 https 절대 URL이어야 `og:image`가 된다(생성 삽화는 업로드 후 주소로 바꿔야 함).
- **학원·실내연습장 데이터** (`src/sources/`, 24시간 캐시, 갱신 실패 시 이전 캐시 사용)
  - api.drive `GET /v1/academy/get-all-academy` — 인증 없음, 약 4MB, 384곳(실내연습장 17곳 포함). 가격 관측치·공시 수강료·셔틀·운영시간·사진·리뷰. 학원 SEO 문구(`seo*`)는 우리가 만든 홍보 문구라 근거에서 뺀다.
  - api.drivingzone `GET /v1/store`(27곳) + `GET /v1/store/:id` — 인증 없음, 운영시간·지하철·강사·리뷰. 합격률·평균 소요일이 0이면 미집계로 본다.
  - ⚠️ 지점 API가 대표자명·사업자번호·SMS 수신 번호를 공개 응답에 포함한다. 정규화는 화이트리스트로 해당 필드를 버리지만, api.drivingzone 쪽에서도 응답에서 빼야 한다.
- **drivingzone / dztraining 블로그**: 같은 `article` 테이블(board type `blog` / `blog_training`). 사람은 PHP 관리자로, 작성 도구는 위 발행 API로 쓴다.

## 10. 단계

| 단계 | 내용 |
| --- | --- |
| P0 | 기존 구조 정리, 새 골격 (설정·채널 정의·작성 가이드·서버 진입점·테스트) |
| P1 | DB, Windows 대응 LLM 러너와 한도 대응, 작업 큐, 원천 데이터 조회, `npm run doctor` |
| P2 | 키워드 수집·묶기, 주제 후보, `npm run collect`, `/api/topics` |
| P3 | 채널 × 글 유형 프롬프트, 근거 자료, 유사도 검사, 품질 게이트, 생성 작업, `npm run generate` |
| P4 | 대시보드·주제·글 검수·작업 화면, 수정·승인·반려·다시 생성, 채널별 내보내기(복사·폴더) |
| P5 | web.drivingplus 커뮤니티 SEO(description, JSON-LD, 글이 생기면 sitemap 자동 포함), api.drive 노출 대상 필터 구현 — **완료(2026-09-28)** |
| P6 | api.drive / api.drivingzone 글 작성 API → 자동 발행 전환 — **완료(2026-09-28)**, 서버 DDL·키 적용 대기 |
