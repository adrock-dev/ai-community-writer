# T01 neutral quality evaluator

구현은 `apps/api-nest/src/neutral-quality-evaluator.ts`, 실행기는 `apps/api-nest/src/scripts/analyze-neutral-t01-quality.ts`다. legacy/v2에 동일한 `v2TypedFacts` snapshot을 적용하고, 수정·repair·재생성을 하지 않는다.

공통 hard rule은 후보/비교표 누락, supplement/far 후보의 실제 region 또는 확장 사유 미고지, 직선거리의 도로거리·이동시간·접근성 단정, 모든 tuition missing 상태의 구체 금액, 모든 shuttle/passRate missing 상태의 긍정 단정이다. “셔틀 운행 여부 확인”, “합격률은 확인되지 않음”, 상담 질문은 긍정 주장으로 세지 않는다. 내부 fact label 노출과 과도한 질문형은 warning이다.

각 failure는 ruleId, severity, outputLocation, 짧은 quotedEvidence, candidateId, supportingFact, classification, explanation을 보존한다. Native taxonomy는 `true_content_error`, `legacy_gate_gap`, `v2_prompt_induced`, `v2_gate_improvement`, `false_positive`, `ambiguous`, `not_applicable`을 별도로 기록한다.

현재 typed candidate는 후보별 면허 과정·자체시험·review 원문을 보존하지 않아 그 세부 일치를 hard failure로 억지 판정하지 않는다. 이 한계는 전체 A/B 이전의 검증 공백이다.

