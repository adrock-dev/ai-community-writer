# Live T01 A/B 준비도

기준일: 2026-07-20

판정: `blocked_missing_credentials`

## 충족한 조건

* `openai_responses` provider가 명시적 routing으로 구현됨
* fetch mock provider 테스트 13개 통과
* 전체 API Nest 테스트 150개 통과
* typecheck와 build 통과
* `store: false`, output parsing, usage parsing, timeout, sanitized error 처리 확인
* Codex/Claude command argument 회귀와 provider 생략 시 Codex 기본 routing 확인
* T01 v2는 기존 명시적 opt-in 상태이며 운영 default는 legacy

## 아직 충족하지 못한 조건

* `OPENAI_API_KEY`로 모델별 1회 smoke 성공
* 실제 OpenAI 응답 text/usage 확인
* 동일 candidate snapshot의 legacy/T01 v2 단일 pair 생성
* pair 품질 gate 결과와 prompt/result 저장 확인

따라서 전체 8개 지역 A/B는 실행하지 않았고, 단일 legacy/v2 pair도 실행하지 않았다. credential을 제공한 뒤 smoke가 성공하면, 기존 readonly A/B snapshot 중 supplement 포함 사례 하나로 repair/fallback 없이 단일 pair를 먼저 실행해야 한다.

운영 기본 provider는 `codex`, 운영 기본 `generation_mode`는 legacy로 유지된다.

### 2026-07-20 재검증

사전 gate는 다시 통과했다: provider mock 13개, 전체 150개 테스트, typecheck, build. 그러나 credential gate가 여전히 닫혀 있어 두 model smoke 및 단일 legacy/v2 pair는 실행하지 않았다. 준비도 판정은 계속 `blocked_missing_credentials`다.
