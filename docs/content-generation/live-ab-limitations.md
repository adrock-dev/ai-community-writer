# T01 live A/B 한계와 재실행 조건

## 핵심 차단 요인

`codex exec --json`의 직접 읽기 전용 probe는 현재 기본 모델 `gpt-5.6-terra`에 대해 다음 400 오류를 반환했다.

```text
The 'gpt-5.6-terra' model requires a newer version of Codex.
Please upgrade to the latest app or CLI and try again.
```

설치 버전은 Codex CLI `0.142.0`이다. 따라서 provider/model 인증 여부와 무관하게 실제 콘텐츠를 만들 수 없었다. mock, 다른 provider, 이전 모델, 온도 조정으로 대체하지 않았다.

## 평가 범위의 한계

- 8개 지역 snapshot과 7개 유효 호출 pair는 확보했지만 유효한 글 pair는 0개다.
- 경상북도 울릉군은 실제 후보가 T01 최소 생성 규칙(2개)에 미달해 양 모드에서 동일하게 제외됐다.
- Codex provider는 sampling seed를 노출하지 않는다. 재실행해도 동일 slot seed·동일 prompt snapshot 비교는 가능하지만 완전한 샘플링 재현은 보장되지 않는다.
- `runLlm()`은 Codex JSON 이벤트의 provider 오류가 종료 코드 0으로 전달될 때 원인 문자열 대신 빈 summary를 남긴다. 본 작업은 운영 코드를 변경하지 않았으므로 직접 probe 결과를 원인 증거로 문서화했다.
- 읽기 전용 evaluator는 post/job/slot을 변경하지 않으므로 실제 worker의 repair loop를 실행하지 않는다. 품질 gate의 최초 결과는 수집할 수 있으나 repair 횟수·반복 실패는 live 비교할 수 없다.
- provider가 token/cost 모델 메타데이터를 반환하지 않아 토큰·비용 비교는 `null`이다.

## 유지한 불변 조건

다음은 이 작업에서 변경하지 않았다.

- `generation_mode` 기본값(legacy)
- legacy/v2 후보 선정, `region LIKE`, supplement/far, 2/7/5/20km/50km 기준
- academies DB, 스키마, 슬롯, 운영 prompt, quality rule, 비T01 흐름

평가 전용으로 `run-live-t01-ab.ts`, 결과 artifacts 및 이 문서만 추가했다.

## 재실행 체크리스트

1. `gpt-5.6-terra`가 지원되는 Codex CLI/App으로 갱신한다.
2. `codex login status`가 계속 인증 상태인지 확인한다.
3. 별도 output root를 지정해 evaluator를 재실행한다. 기존 실패 artifacts는 보존한다.
4. 7개 유효 pair의 legacy/v2 모두 비어 있지 않은 output인지 확인한다.
5. pair integrity, 자동 사실/지역 검사, 블라인드 자료를 다시 생성한다.
6. 사람 블라인드 평가 전에는 어느 모드가 더 낫다는 결론을 내리지 않는다.

## 모델 검토

평가 설계·snapshot·자동 검사 작성에는 GPT-5.6 Terra High 수준으로 충분하다. 그러나 현재 문제는 추론 능력이 아니라 로컬 Codex CLI와 해당 모델의 버전 호환성이다. 콘텐츠 승자 판정에는 독립적인 사람 평가가 필요하며, 모델을 바꾸는 것은 공정한 운영-model A/B의 대안이 아니다.
