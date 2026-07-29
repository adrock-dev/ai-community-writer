# T01 Hybrid Smoke 결과

## 실행 조건

- snapshot: `data/content-generation-evaluation/codex-cli-single-pair-20260720/snapshots/pair-01.json`
- 지역/유형: 전북특별자치도 익산시 / `B_supplement`
- candidates: `120, 149, 140, 122, 112` (순서 고정)
- slot seed: `live-ab-01-전북특별자치도 익산시`
- provider/model: `codex` / `gpt-5.6-luna`
- timeout: 600 seconds, repair/fallback/운영 저장 비활성

legacy, v2, hybrid 모두 생성에 성공했고 candidate ID·순서·seed·provider/model·timeout triple integrity가 true였다. Codex CLI usage는 보존됐고 비용은 `not_measured_chatgpt_cli`다.

## Hybrid 결과

평가 runner가 남긴 raw/final artifact는 `data/content-generation-evaluation/t01-hybrid-smoke-20260720-rerun/`에 있다. 초기 runner의 historical `forcedTitle` object 처리와 final normalization 누락을 수정한 뒤, 저장된 hybrid raw output을 최신 운영 후처리와 gate로 read-only 재평가했다.

재평가 결과:

- 최종 H1: `전북특별자치도 익산시 운전면허학원 BEST 5`
- 원천 review source: 1개
- review metadata 노출: 없음
- review gate issue: 없음
- FAQ/checklist decision-support issue: 없음
- hybrid hard failure: 없음

원문에는 대표 review 1개와 `출처: DrivingPlus 수강생 리뷰`가 연결된 학원 설명 직후에 있었다. 이 smoke는 콘텐츠 우열을 판단하지 않는다.

## 제한

historical snapshot의 `forcedTitle`이 title-rule object로 저장돼 기존 runner artifact에 `# [object Object]`가 남았다. runner는 이를 문자열 제목으로 재해석하고 운영 worker와 동일한 H1 rewrite/Markdown normalization을 적용하도록 수정됐다. 최신 runner로 새 output root에서의 clean triple 재실행은 전체 A/B/C 전에 수행할 후속 smoke다.

