# T01 Hybrid 대표 리뷰 Selector

`selectHybridReview()`는 v2 typed candidate의 `studentReviews`에서 글 전체 대표 리뷰를 최대 1개만 결정적으로 고른다.

선정 조건:

- 최종 본문 후보 학원에 연결됨
- 비어 있지 않고 12자 이상
- source label 존재
- 전화번호·이메일 같은 개인정보가 없음
- 짧은 광고성 표현만으로 구성되지 않음

점수는 길이와 구체적 경험 단어를 반영하고, 동점은 slot seed·academy ID·review text의 stable rank로 해결한다. 같은 snapshot과 seed에서는 같은 리뷰가 선택된다. 후보 review가 없어도 새 review를 만들지 않는다.

