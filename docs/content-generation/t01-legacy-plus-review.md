# T01 Legacy Plus review 정책

## 데이터 흐름

`DrivingPlus API → academies.review_json → academy-review-evidence → T01 typed candidate → selectEligibleReviewsByAcademy() → Legacy Plus prompt/gate`

`buildT01LegacyPlusContext()`는 같은 후보 snapshot과 slot seed에서 각 후보 학원의 적격 review를 결정적으로 최대 하나씩 고른다. review가 없는 학원에는 review를 만들지 않는다.

## 사용 조건

각 학원 review는 다음 조건을 만족해야 한다.

- 최종 후보 학원에 연결됨
- review text와 source label이 존재함
- 개인정보·내부 식별자가 없음
- 원천 review를 과도하게 광고하거나 사실과 충돌하지 않음

source label이 없거나 적격 review가 없으면 review section을 만들지 않는다.

## 독자용 출력

본문에는 연결 학원 설명 직후의 짧은 원문 인용과 정확한 `출처: DrivingPlus 수강생 리뷰`만 출력한다. 원문이 100자 이상이면 앞 99자 뒤에 `…`을 붙여 100자로 제한한다. 작성자, 닉네임, 작성일, 평점, URL, 내부 review ID, 동기화 시각은 prompt와 본문 모두에서 제외한다.

Gate는 한 학원에 review 2개 이상, 선택되지 않은 review 노출, source 누락·변조, 다른 학원 연결, metadata 노출, 전체 수강생 평가·합격률 일반화를 hard failure로 처리한다. 글 전체 review 수는 적격 후보 학원 수를 넘을 수 없다.
