# OpenAI Responses provider 보안 검토

기준일: 2026-07-20

## 적용한 보호

* `OPENAI_API_KEY`가 없으면 API 호출 전 `missing_api_key`로 끝낸다.
* 요청은 `store: false`를 명시한다.
* key와 `Bearer` 형태는 provider 오류 문자열에서 redaction한다.
* 결과 계약에는 request headers나 request body를 저장하지 않는다.
* smoke script는 모델별 성공 여부·usage·응답 ID만 출력하며 생성 텍스트와 key는 출력하지 않는다.
* 2026-07-20 smoke에는 학원 데이터, candidate snapshot, 운영 prompt를 사용하지 않았다. credential 부재로 실제 호출도 하지 않았다.

## 운영 시 주의점

* `OPENAI_API_BASE_URL`은 환경 변수이므로 잘못된 또는 내부 endpoint로 향할 수 있다. adapter는 HTTP(S) URL만 허용하지만 host allowlist는 구현하지 않았다. 운영 환경에서는 trusted deployment configuration으로만 이 값을 설정해야 한다.
* 콘텐츠 prompt에는 학원 DB facts가 포함될 수 있다. provider를 운영에 활성화하기 전 데이터 전송 범위와 prompt/result 저장 경로의 접근 제어를 별도로 검토해야 한다.
* 429, timeout, 5xx retry는 adapter가 수행하지 않는다. 상위 retry가 추후 추가되면 중복 과금, request ID, retry 이력을 함께 관리해야 한다.
* model alias는 공급자 측에서 변경될 수 있다. 평가에는 requested/resolved model을 함께 저장하고, 운영 전환 전 snapshot model 지원 여부를 확인해야 한다.
