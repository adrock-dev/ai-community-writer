# T01 Hybrid 리뷰 출처 정책

본문 review는 원천 `academies.review_json`에서 adapter가 만든 `DrivingPlus 수강생 리뷰` source label이 있을 때만 사용한다. URL·작성자·닉네임·작성일·평점·내부 ID는 prompt public payload와 본문에서 제외한다.

본문 형식은 짧은 원문 인용과 바로 뒤의 `출처: DrivingPlus 수강생 리뷰`다. gate는 다음을 hard failure로 처리한다.

- 선택되지 않은 review 또는 다른 학원 review 사용
- article-level review 2건 이상
- source 누락·변조·인용과 source의 비인접 배치
- 작성자·날짜·평점·내부 ID 노출
- review를 전체 수강생 평가·합격률로 일반화

source label이 없으면 selector가 해당 review를 제외한다.

