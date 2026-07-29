# T01 live A/B 실행 기록

## 결론

2026-07-20에 운영 DB를 읽기 전용으로 사용해 legacy T01과 `t01_data_gated_v2`의 실제 모델 A/B 생성을 시도했다. 입력 snapshot과 프롬프트는 생성·저장됐지만, 실제 콘텐츠 생성은 0건이다. 현재 설치된 Codex CLI `0.142.0`이 환경의 기본 모델 `gpt-5.6-terra`를 지원하지 않아 provider가 HTTP 400을 반환했다. 임의 모델 또는 mock 출력으로 대체하지 않았다.

## 실행 경계

- 평가 전용 스크립트: `apps/api-nest/src/scripts/run-live-t01-ab.ts`
- 결과 루트: `data/content-generation-evaluation/live-ab-20260720-escalated/`
- DB: `data/admin.db`를 `DatabaseSync` 읽기 전용으로 열었다.
- 후보 선택: 실제 `selectAcademiesForRegion()`와 `seededCandidateSample()`을 호출했다.
- facts/prompt: legacy는 `WorkerService.buildFacts()`와 `buildPrompt()`, v2는 `t01DataGatedPromptContract()`를 사용했다.
- 모델 호출: 기존 `runLlm(prompt, { provider: "codex", model: "", timeoutSec: 600 })`와 동일한 provider/model/timeout을 사용했다.
- 출력 post, slot, academies, generation mode 기본값, 운영 프롬프트는 변경하지 않았다.

## 운영 모델 설정 확인

| 항목 | 실제 값 |
| --- | --- |
| provider | `codex` |
| 애플리케이션 요청 model | 빈 문자열(현재 Codex 기본 모델 사용) |
| 현재 환경 기본 모델 | `gpt-5.6-terra` (Codex CLI 오류 메시지에서 확인) |
| Codex CLI | `0.142.0` |
| timeout | 600초 |
| temperature / top_p / max output tokens | 애플리케이션 및 `codex exec` 인자에 없음 |
| retry | `runLlm` 자체 재시도 없음 |
| sampling seed | 미지원. `codex exec --help`와 `llm-runner.ts`에 해당 옵션 없음 |
| system prompt | Codex 내부 prompt는 비공개, 앱은 생성 prompt 하나를 stdin으로 전달 |

동일 CLI를 읽기 전용으로 직접 호출했을 때 다음 오류를 재현했다.

```text
The 'gpt-5.6-terra' model requires a newer version of Codex.
Please upgrade to the latest app or CLI and try again.
```

`runLlm()`은 이 경우 CLI 종료 코드가 0인 이벤트 스트림을 빈 `summary`로 해석해 `empty_output`만 남긴다. 이 실행에서는 운영 코드를 고치지 않았으므로 원본 provider 오류를 결과 JSON에 복원하지 못했다. 위 직접 probe가 원인 증거다.

## 표본 및 pair

| ID | 지역 | 분류 | 후보 상태 |
| --- | --- | --- | --- |
| 01 | 전북특별자치도 익산시 | B_supplement | supplement 포함 |
| 02 | 제주특별자치도 제주시 | E_facts_sparse | 후보 충분, 변동 비교 facts 희소 |
| 03 | 강원특별자치도 동해시 | B_supplement | supplement 포함 |
| 04 | 경기도 고양시 덕양구 | B_supplement | supplement 포함 |
| 05 | 강원특별자치도 고성군 | C_far | far 포함 |
| 06 | 경상북도 울릉군 | D_insufficient | 후보 2 미만으로 T01 title rule에서 사전 제외 |
| 07 | 강원특별자치도 강릉시 | E_facts_sparse | 후보 충분, 변동 비교 facts 희소 |
| 08 | 강원특별자치도 원주시 | E_facts_sparse | 후보 충분, 변동 비교 facts 희소 |

8개 snapshot, 8개 pair 계획을 만들었다. pair 06은 두 모드 모두 동일한 `min_generate=2` 규칙으로 생성 전에 제외됐다. 나머지 7개 pair(14 호출)는 실제 Codex provider 호출을 시도했으나 모두 빈 출력으로 실패했다.

## Pair 무결성

각 pair는 저장 전 legacy/v2에 같은 target region, candidate ID 배열, 후보 순서, slot seed, provider/model 및 timeout을 사용하도록 검사했다. `execution-summary.json`의 8개 pair 모두 다음은 `true`다.

- `sameCandidateIds`
- `sameCandidateOrder`
- `sameSlotSeed`
- `sameModel`
- `sameTimeout`
- `sameCommonRequestParameters`

v2의 variant/prompt만 실험 요인으로 달라지도록 구성했다. LLM sampling seed는 provider가 지원하지 않아 사용하지 않았다.

## 저장 산출물

- snapshot: `data/content-generation-evaluation/live-ab-20260720-escalated/snapshots/`
- prompt: `.../prompts/legacy/`, `.../prompts/v2/`
- raw/final: `.../raw/`, `.../final/` (실패로 본문 비어 있음)
- quality/metrics: `.../quality/`, `.../metrics/`
- 종합 실행 기록: `.../execution-summary.json`

## 재실행 전제

Codex CLI/App을 `gpt-5.6-terra`를 지원하는 버전으로 올린 뒤, 동일 스크립트와 새 output root로 재실행해야 한다. 그 전에는 live 콘텐츠 A/B, 사람 블라인드 평가, 비용·토큰·repair 비교를 완료로 주장할 수 없다.

## 구현 검증

- `npm --prefix apps/api-nest run typecheck`: 통과
- `npm --prefix apps/api-nest test`: 13 files, 137 tests 통과
- `git diff --check`: 통과

첫 테스트 시도에 전달한 Jest 전용 `--runInBand`는 Vitest가 지원하지 않아 거절됐으며, 위의 옵션 없는 Vitest 전체 실행이 유효한 결과다.
