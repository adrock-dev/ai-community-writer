# T01 v2 롤백 계획

즉시 롤백은 생성 job에서 `generation_mode`를 생략하거나 `legacy`로 보내는 것이다. 기본값도 `legacy`이므로 DB migration이나 데이터 되돌리기는 필요 없다.

롤백 단위는 다음과 같다.

1. 운영 호출에서 `t01_data_gated_v2` opt-in을 중단한다.
2. 이미 생성된 글은 기존 post 데이터와 독립적이므로 자동 변경되지 않는다.
3. 코드 롤백이 필요하면 T01 v2 호출 경로(`t01-data-gated.ts`와 worker의 opt-in branch)를 되돌리고, shared candidate selection extraction은 fixture parity를 통과한 독립 변경으로 유지하거나 함께 되돌릴 수 있다.

비T01에는 v2 데이터가 전달되지 않으므로 별도 비T01 데이터 복구 절차는 없다.
