# T01 Legacy Plus review audit

평가 artifact: `data/content-generation-evaluation/t01-legacy-plus-blind-20260721-0940/private/review-source-audit.jsonl`.

| 지역 | 적격·선택 review 수 | quote/source 검증 | metadata 노출 | 결과 |
| --- | ---: | --- | --- | --- |
| 익산시 | 3 | 3 / 3 | 없음 | 통과 |
| 동해시 | 2 | quote 4 / source 2 | 없음 | 실패 |
| 고성군 | 2 | 2 / 2 | 없음 | 통과 |
| 원주시 | 3 | 3 / 3 | 없음 | 통과 |

모든 선택 review는 고정 snapshot의 최종 후보 학원에 연결됐고 source label은 `DrivingPlus 수강생 리뷰`다. 임의 URL·다른 플랫폼명·작성자·작성일·평점·닉네임·내부 ID 노출은 audit에서 발견되지 않았다.

동해시 실패는 원천 review가 없는 문제가 아니다. 생성문이 다음처럼 source와 review 원문을 두 개의 blockquote로 분리했기 때문이다.

> 리뷰 원문 — 출처: DrivingPlus 수강생 리뷰
>
> 필기, 기능, 도로주행 모두 다른 선생님께 수업들었는데 …

현재 Legacy Plus 계약은 동일 줄의 `> 리뷰 원문 — 출처: DrivingPlus 수강생 리뷰` 형식을 요구하므로 native `review_source_missing` 및 `review_count`가 기록됐다. 코드 변경 금지 범위에 따라 수정·재생성하지 않았다.

현재 코드 정책은 후보 학원별 최대 1건·100자 이내 말줄임이며, 글 전체 대표 review 1건 정책이 아니다. 이 정책 차이는 human review 이전에 제품 요구사항과 맞춰야 한다.
