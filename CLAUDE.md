# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

네이버 검색량 기준으로 주제를 정해 Codex/Claude CLI로 채널별 원고를 쓰고, 사람이 검수·승인한 글만 내보내는
로컬 도구. **Windows PC 상시 실행이 1차 대상**이다. 설계·단계·외부 시스템 현황은 `docs/architecture.md`가 기준이다.

@docs/architecture.md

이전 구조(NestJS + Next 관리자)는 `archive/legacy-content-ops` 브랜치에 있다. 옛 코드가 필요하면 그 브랜치에서 꺼내 옮긴다.

## 명령어

- `npm start` — `node src/main.ts`. 빌드 단계 없음. API 서버와 작업 워커가 한 프로세스에서 돈다.
- `npm run collect` — 네이버 30일 검색량 수집 → 주제 후보 갱신 (실제 검색광고 API 호출).
- `npm run generate -- --channel=<채널> [--type=<유형>] [--topic=<id>] [--dry]` — 글 1편 생성. `--dry`는 LLM 없이 프롬프트만 출력한다.
- `npm run doctor` — 설치·로그인·API 연결 점검. `-- --llm`을 붙이면 실제 CLI를 한 번 호출한다(사용량 소모).
- `npm run check` — typecheck + Biome lint + vitest. **커밋 전 반드시 통과시킨다.**
- `npm test` / `npm run typecheck` / `npm run lint`

## 규약

- Node 24 타입 스트리핑으로 실행하므로:
  - 상대 import는 **`.ts` 확장자**를 쓴다 (`./config.ts`).
  - **enum, namespace, 생성자 parameter property, 데코레이터 금지** (`erasableSyntaxOnly`). 상수 배열 + 유니온 타입을 쓴다.
  - 타입만 가져올 때는 `import type`.
- `strict` + `noUncheckedIndexedAccess`.
- Biome 포맷: 큰따옴표, 세미콜론, 2칸 들여쓰기, 줄 길이 100.
- 코드 주석·문서·UI 문구는 한국어.
- 설정은 `config.json` 하나(선택). 새 설정 항목은 `src/config.ts` 스키마에 **기본값과 함께** 추가하고 `config.example.json`, README 표를 같이 갱신한다.
- 채널·섹션은 `src/channels.ts`에 데이터로 정의한다. 채널별 분기는 이 정의를 읽어서 처리하고 하드코딩을 늘리지 않는다.
- 브랜드·채널별 운영 규칙(예: 드라이빙존 교육시간)은 코드나 프롬프트에 박지 말고 유의사항 설정(DB `guide_rules`, 화면 `/settings/guides`)에 둔다. `guides/*.md`는 첫 실행 초기값일 뿐이다.
- 관리 화면은 빌드 없이 `hono/html`로 서버에서 만든다(값 자동 이스케이프). `.tsx`는 Node 타입 스트리핑이 지원하지 않는다.
- 글 양식은 `prompts/`(base → 채널 → 채널 전용 유형 | 공통 유형)에 둔다. 양식을 코드에 박지 않는다.
- 품질 규칙을 바꾸면 `src/quality/gate.ts`와 `test/writer.test.ts`를 함께 고친다. 게이트 문구는 운영자에게 보이고 재작성 프롬프트에도 들어가므로 "무엇을 어떻게 고칠지"까지 쓴다.
- 시드 키워드와 섹션별 포함어·제외어는 `seeds/*.md`에 둔다. 주제 품질 조정은 먼저 시드 파일로 하고, 코드(묶기·점수)는 그다음이다.

## Windows 주의

- 경로는 `node:path`로 조합하고, `~` 해석은 `resolvePath()`를 쓴다.
- npm 스크립트에 bash 전용 문법(`rm -rf`, `VAR=x cmd`, `&&` 외 셸 기능)을 쓰지 않는다. 필요하면 Node 스크립트로 작성한다.
- 전역 설치 CLI는 Windows에서 `codex.cmd`/`claude.cmd`이므로 `spawn` 시 이를 처리해야 하고, 타임아웃 종료는 프로세스 트리 단위(`taskkill /T /F`)로 한다.

## 반드시 지킬 원칙

- **LLM은 API 키가 아니라 CLI 서브프로세스 + OAuth 로그인**으로 호출한다. Claude 경로는 자식 env에서 `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`을 제거한다.
- 생성 글은 **확인된 데이터만** 쓴다. 가격·합격률·셔틀·후기를 지어내지 않는다. 내부 API 주소·원천 시스템명을 본문에 노출하지 않는다.
- 사람이 승인하지 않은 글은 내보내지 않는다.
- LLM 한도로 못 돈 작업은 실패가 아니라 보류(`LlmUnavailableError` → `queue.defer`)로 처리한다. 사용률 기준(`pauseAtUsagePercent`)을 우회하지 않는다.
- 원천 API 응답은 화이트리스트 정규화(`src/sources/`)를 거친 값만 프롬프트에 넣는다. 원본 응답에는 비공개 정보가 섞여 있다.
- 네이버 인증 파일 등 비밀값은 저장소 밖에 두고 커밋하지 않는다.
