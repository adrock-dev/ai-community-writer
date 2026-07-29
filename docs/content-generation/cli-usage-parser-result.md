# Codex CLI usage parser 재검증

추가 3 pair의 6개 생성물에서 `turn.completed.usage` JSONL event가 정상 보존됐다. parser는 input, cached input, output, reasoning token을 읽고 total은 input + output으로 계산한다. API 가격으로 ChatGPT CLI 사용량을 환산하지 않았고 cost는 `not_measured_chatgpt_cli`다.

| 모드 | 평균 input | 평균 cached | 평균 output | 평균 total | 평균 reasoning | 평균 시간 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| legacy | 22,447 | 9,643 | 4,179 | 26,626 | 797 | 78.964초 |
| v2 | 23,811 | 9,643 | 3,764 | 27,575 | 689 | 72.986초 |

usage가 없으면 `unavailable_from_cli`/`null`을 보존한다. 기존 익산 pair는 parser 보완 전 실행돼 usage가 null이고 재생성하지 않았다.

