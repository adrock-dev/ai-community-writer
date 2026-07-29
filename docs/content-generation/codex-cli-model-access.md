# Codex CLI 모델 접근 결과

기준일: 2026-07-20

| 모델 | 0.142.0 결과 | 0.144.6 결과 | 최종 판정 |
| --- | --- | --- | --- |
| `gpt-5.6-luna` | `cli_version_unsupported`: “requires a newer version of Codex” HTTP 400 이벤트 | 최종 메시지·usage 이벤트 수신 | `accessible` |
| `gpt-5.4-mini` | 최종 메시지·usage 이벤트 수신 | 업데이트 후 다시 최종 메시지·usage 이벤트 수신 | `accessible` |

모든 smoke는 빈 임시 디렉터리, `--sandbox read-only`, `--skip-git-repo-check`, `--ephemeral`, `--ignore-rules`, 짧은 비학원 한국어 문장으로 실행했다. 성공한 최종 메시지는 임시 파일에만 저장했고, 운영 DB·콘텐츠 테이블에는 저장하지 않았다.

업데이트 후 smoke usage는 Codex CLI JSON event에서 직접 확인했다.

| 모델 | input | cached input | output | reasoning output | final output file |
| --- | ---: | ---: | ---: | ---: | ---: |
| Luna | 17,049 | 8,960 | 26 | 0 | 96 bytes |
| GPT-5.4 mini | 16,414 | 4,480 | 113 | 83 | 106 bytes |

이 usage는 ChatGPT-authenticated Codex CLI event의 측정값이다. API token 사용량이나 API 비용으로 환산하지 않았고, 비용은 `not_measured_chatgpt_cli`다.
