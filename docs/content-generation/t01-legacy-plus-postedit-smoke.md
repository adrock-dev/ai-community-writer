# Post-edit smoke

결과 경로: `data/content-generation-evaluation/t01-legacy-plus-postedit-smoke-20260721-1005/`.

익산시와 원주시의 고정 snapshot을 사용했다. 기존 Legacy/Legacy Plus 파일은 별도 final 경로에 복사해 보존했고 post-edit는 새 파일만 만들었다.

| 지역 | post-edit 시간 | hard failure | neutral hard |
| --- | ---: | ---: | ---: |
| 익산시 | 63.549초 | 0 | 0 |
| 원주시 | 31.478초 | 0 | 0 |

두 표본 모두 후보 ID·순서·slot seed는 source snapshot과 동일하며 provider/model은 `codex` / `gpt-5.6-luna`, timeout은 600초다. repair·fallback·운영 DB 저장은 비활성이다.
