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

## 3. 작성 가이드 (브랜드별 기본 룰)

글 생성 시 반드시 지켜야 하는 운영 규칙을 Markdown 파일로 관리한다. 운영자가 메모장으로 고칠 수 있고 git으로 이력이 남는다.

```
guides/common.md                  모든 채널 공통 (사실 확인, 노출 금지 등)
guides/drivingplus.md             운전면허PLUS 커뮤니티
guides/drivingzone.md             드라이빙존 블로그·연수 블로그·카페
guides/channels/<channelId>.md    특정 채널 전용 (선택)
```

- `- `로 시작하는 목록 한 줄이 규칙 하나, `## 제목`은 규칙 묶음 이름이다.
- 공통 → 브랜드 → 채널 순으로 모아(`src/guides.ts`) 생성 프롬프트의 필수 규칙으로 넣는다 [P3].
- 검수 화면에서 해당 글에 적용된 규칙 목록을 함께 보여 준다 [P4].
- 숫자·시간처럼 기계적으로 확인할 수 있는 규칙은 품질 게이트 검사로도 연결할 수 있다 [P3 이후 검토].

## 4. 모듈 구성 (예정 포함)

```
src/
  main.ts         진입점 (npm start)
  config.ts       config.json 로드·검증. 모든 값에 기본값
  paths.ts        경로 해석 (~, 상대 경로, Windows 구분자)
  channels.ts     브랜드·채널·섹션 정의
  guides.ts       작성 가이드 로드 (guides/*.md)
  server.ts       로컬 HTTP 서버 (Hono)
  db/             node:sqlite 스키마·마이그레이션                        [P1]
  llm/            CLI 러너(Windows .cmd, 프로세스 트리 종료), 한도 감지, 프로바이더 전환 [P1]
  queue/          작업 큐, 생성 간격, 일일 한도, 재개 시각                 [P1]
  sources/        api.drive 학원·실내연습장, api.drivingzone 지점 조회      [P1]
  keywords/       검색광고 API, 데이터랩, 키워드 묶기                      [P2]
  topics/         주제 후보 점수화, 채널·섹션 배정                         [P2]
  writer/         채널별 프롬프트 (SEO/AEO/GEO 구조, 톤, 형식)             [P3]
  similarity/     shingle 유사도, 목차 구조 비교, 같은 유형 "피할 패턴"     [P3]
  quality/        품질 게이트 (기존 규칙 중 유효한 것 이식)                 [P3]
  export/         채널별 결과물                                            [P4]
  web/            검수·승인·내보내기 UI                                    [P4]
```

TypeScript는 Node 24의 타입 스트리핑으로 **빌드 없이** 실행한다(`node src/main.ts`).
그래서 import는 `.ts` 확장자를 쓰고, enum·namespace 같은 비소거 문법은 쓰지 않는다(`erasableSyntaxOnly`).

## 5. DB 테이블 (P1에서 확정)

| 테이블 | 내용 |
| --- | --- |
| `keyword_stats` | 키워드, PC·모바일 월간 검색량, 경쟁도, 수집 시각 (스냅샷 누적) |
| `topics` | 대표·보조 키워드, 채널·섹션, 점수, 상태 |
| `articles` | 채널·섹션, 글 유형, 제목, 본문, 설명, 노출 대상(audience), 상태, 게시 URL |
| `article_fingerprints` | 목차, 도입부, shingle 해시 — 유사도 비교용 |
| `jobs` | 종류, 상태, 다음 실행 시각, 시도 횟수, 오류 |
| `llm_usage` | 프로바이더별 호출 결과, 한도 해제 시각 |

## 6. LLM 호출과 사용량 한도

- 기존 방식 유지: `codex exec` / `claude --print`를 서브프로세스로 실행하고 OAuth 로그인을 쓴다. Claude 경로는 `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`을 제거해 구독 인증을 강제한다.
- CLI는 남은 사용량을 미리 알려주지 않으므로 **걸리는 순간을 감지**한다.
  - stderr·스트림에서 한도 문구(usage limit, rate limit, 429, reset 시각)를 찾으면 해당 프로바이더를 해제 시각까지 중지.
  - `llm.order` 순서대로 다음 프로바이더로 전환, 모두 중지면 큐 대기.
  - 평상시에도 `pacing` 간격(무작위)과 일일 한도를 지킨다.

## 7. 외부 시스템 현황 (2026-09-28 조사)

- **api.drive 커뮤니티**
  - `community_post` + `community_post_audience`(scope: EVERYWHERE/RADIUS/ACADEMIES/SERVICE_REGIONS/MIXED) 구조는 있으나, 목록 API의 노출 대상 필터(`applyAudienceFilter`)는 미구현이다. 웹이 항상 위치를 보내므로 현재는 모든 글이 전국에 노출된다.
  - 목록 조회가 `community_post_filter`를 INNER JOIN하므로 필터가 없는 글은 목록에 나오지 않는다. 내보낼 때 섹션·필터를 필수로 둔다.
  - 글 작성 API가 없다 (P6에서 추가).
- **web.drivingplus 커뮤니티**: 글 상세 메타데이터에 description·JSON-LD가 없고, sitemap에서 제외돼 있다 (P5).
- **학원·실내연습장 데이터**
  - api.drive `GET /v1/academy/get-all-academy` — 인증 없음, `indoor_academy` 포함, 수강료·셔틀·운영시간·사진·리뷰.
  - api.drivingzone `GET /v1/store`, `GET /v1/store/:id` — 인증 없음, 지점 합격률·평균 소요일·리뷰.
- **drivingzone / dztraining 블로그**: 같은 `article` 테이블(board type `blog` / `blog_training`), 글 작성은 PHP 관리자(세션 인증)만 가능.

## 8. 단계

| 단계 | 내용 |
| --- | --- |
| P0 | 기존 구조 정리, 새 골격 (설정·채널 정의·작성 가이드·서버 진입점·테스트) |
| P1 | DB, Windows 대응 LLM 러너와 한도 대응, 작업 큐, 원천 데이터 조회 |
| P2 | 키워드 수집·묶기, 주제 후보 |
| P3 | 채널별 프롬프트, 유사도 검사, 품질 게이트 |
| P4 | 검수·승인·내보내기 UI |
| P5 | web.drivingplus 커뮤니티 SEO(description, JSON-LD, 글이 생기면 sitemap 자동 포함), api.drive 노출 대상 필터 구현 |
| P6 | api.drive / api.drivingzone 글 작성 API → 자동 발행 전환 |
