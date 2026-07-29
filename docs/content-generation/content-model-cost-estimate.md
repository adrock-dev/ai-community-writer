# 콘텐츠 모델 비용 추정

## 전제와 정확도 한계

이 문서는 API를 호출하지 않고 2026-07-20에 저장된 8개 legacy/v2 prompt snapshot의 문자 수로 계산했다.

| 입력 | legacy | v2 |
| --- | ---: | ---: |
| snapshot 수 | 8 | 8 |
| 총 문자 수 | 72,556 | 106,782 |
| 평균 문자 수 | 9,070 | 13,348 |
| 최소~최대 | 7,046~11,012 | 8,972~16,786 |

현재 저장소에는 model-specific tokenizer가 없고, API usage도 0건이다. 따라서 비용 계획에는 한국어/영문 혼합 prompt 1문자 = 1 input token이라는 보수적 proxy를 사용한다. 실제 billed token은 모델 tokenizer, reasoning, cached input, 출력 길이에 따라 달라진다. 구현 후 Responses `usage`로 이 표를 대체해야 한다.

출력은 prompt가 요구하는 4,000~5,200자 Markdown을 4,000~5,200 output tokens으로 가정했다. 이는 품질·길이 보장이 아니라 비용 상한 계획용 proxy다. reasoning tokens와 tools는 사용하지 않는 전제다.

## 공식 단가

| 모델 | input / 1M | cached input / 1M | output / 1M | 출처 |
| --- | ---: | ---: | ---: | --- |
| `gpt-5.6-luna` | $1.00 | $0.10 | $6.00 | [공식 모델 문서](https://developers.openai.com/api/docs/models/gpt-5.6-luna) |
| `gpt-5.4-mini` | $0.75 | $0.075 | $4.50 | [공식 모델 문서](https://developers.openai.com/api/docs/models/gpt-5.4-mini) |
| `gpt-5.6-terra` (fallback 가정) | $2.50 | $0.25 | $15.00 | [공식 모델 카탈로그](https://developers.openai.com/api/docs/models) |

Prompt cache, Batch API, regional endpoint uplift, tools, image generation은 아래 계산에 넣지 않았다.

## 글 1개 예상 비용

`cost = input_tokens × input_rate / 1,000,000 + output_tokens × output_rate / 1,000,000`

| 모델 | legacy 1개 | v2 1개 |
| --- | ---: | ---: |
| Luna | $0.0331 ~ $0.0403 | $0.0373 ~ $0.0445 |
| GPT-5.4 mini | $0.0248 ~ $0.0302 | $0.0280 ~ $0.0334 |

GPT-5.4 mini는 이 전제에서 Luna보다 input/output 모두 25% 낮다. 어느 모델의 한국어 장문 품질이 더 좋은지는 이 비용표로 판단할 수 없다.

## A/B 묶음 비용

legacy 8개 + v2 8개, 총 16개 생성물(모두 실제 생성된다고 가정):

| 모델 | 16개 | 40개 (legacy/v2 반반) |
| --- | ---: | ---: |
| Luna | $0.563 ~ $0.679 | $1.408 ~ $1.696 |
| GPT-5.4 mini | $0.423 ~ $0.509 | $1.056 ~ $1.272 |

실제 live A/B의 pair 06은 T01 최소 후보 규칙으로 사전 skip됐으므로, 동일 표본을 그대로 실행하면 위 16개 상한보다 실제 호출 수가 14개로 줄 수 있다.

## repair 1회 비용

`buildRepairPrompt()`는 facts와 기존 Markdown을 함께 전송한다(`apps/api-nest/src/worker.service.ts:656-715`). 정확한 repair snapshot은 아직 없으므로 아래는 “첫 prompt proxy + 기존 4,000~5,200자 Markdown”을 input으로 더한 계획 추정이다.

| 모델 | legacy repair 1회 | v2 repair 1회 |
| --- | ---: | ---: |
| Luna | $0.0371 ~ $0.0455 | $0.0413 ~ $0.0497 |
| GPT-5.4 mini | $0.0278 ~ $0.0341 | $0.0310 ~ $0.0373 |

실제 repair prompt는 최초 prompt와 문장 구성이 다르므로 이는 exact invoice가 아니다. Responses usage와 repair prompt snapshot을 기록한 뒤 재산정해야 한다.

## Terra fallback 비율

Terra fallback을 평균 입력 11,209 tokens, 평균 출력 4,600 tokens인 별도 재생성 1회로 가정하면 약 **$0.0970/call**이다. 이는 최초 호출 비용이 이미 발생한 뒤 추가되는 비용이다.

| 생성물 수 | fallback 5%의 기대 추가비용 | fallback 10%의 기대 추가비용 |
| --- | ---: | ---: |
| 16개 | $0.078 (0.8 calls 기대값) | $0.155 (1.6 calls 기대값) |
| 40개 | $0.194 (2 calls 기대값) | $0.388 (4 calls 기대값) |

첫 T01 패턴 A/B에서는 fallback을 0%로 고정해야 한다. fallback이 켜지면 모델/repair 정책이 달라져 legacy-v2 품질 비교를 오염시킨다.
