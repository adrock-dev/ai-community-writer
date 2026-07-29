# 수강생 리뷰 데이터 흐름 분석

## 실제 호출 흐름

`DrivingplusApiService.fetchAcademies({ includeReviews: true })` → 학원별 `fetchReviews()` → `DbService.upsertDrivingplusAcademies()` → `academies.review_json` → 후보 선택 → `studentReviewsForAcademy()` → prompt facts 또는 T01 typed candidate.

| 단계 | 구현 | 보존 데이터 | 손실/제약 |
| --- | --- | --- | --- |
| 외부 수집 | [drivingplus-api.service.ts](../../apps/api-nest/src/drivingplus-api.service.ts:53) | `id`, `author`, `point`, `content`, `date` | per-review URL/source URL 없음 |
| 수집 정규화 | [drivingplus-api.service.ts](../../apps/api-nest/src/drivingplus-api.service.ts:151) | content 최대 500자, 점수·작성자·날짜 | 긍정/안전 필터 통과분만 남김 |
| DB 저장 | [db.service.ts](../../apps/api-nest/src/db.service.ts:785), [db.service.ts](../../apps/api-nest/src/db.service.ts:1121) | `review_json`에 id/author/point/content/date, 학원 external ID 연결 | 최대 10개; 음성·위험 review는 upstream/DB 필터에서 제외 |
| legacy facts | [worker.service.ts](../../apps/api-nest/src/worker.service.ts:425) | 현재는 선택 원문 1건과 blog theme | historical 4 pair에서는 review summary/개수/theme만 전달됨 |
| v2 typed candidate | [t01-data-gated.ts](../../apps/api-nest/src/t01-data-gated.ts:311) | `studentReviews: [{ quote, source }]`, `reviewEvidencePresent` | 작성자·날짜·평점은 public candidate에 없음 |

현재 `academy-review-evidence.ts`는 원문을 정리하고 중복을 제거한 뒤([academy-review-evidence.ts](../../apps/api-nest/src/academy-review-evidence.ts:18)) 학원별 seed 고정 1건을 선택한다([academy-review-evidence.ts](../../apps/api-nest/src/academy-review-evidence.ts:40)). 출력용 사실은 `수강생 리뷰: “원문” (출처: DrivingPlus 수강생 리뷰)`이다([academy-review-evidence.ts](../../apps/api-nest/src/academy-review-evidence.ts:46)).

## 현재 hybrid 요구와의 차이

현재 구현은 **학원별** 최대 1건이다. 후보가 5개면 prompt에 최대 5건이 들어갈 수 있으므로, 사용자가 요구한 “지역 비교 글 전체 최대 1개”는 아직 구현되지 않았다. 또한 서비스 label은 `DrivingPlus 수강생 리뷰`로 존재하지만 per-review URL은 API interface와 `review_json`에 없다. 따라서 현 상태에서 가능한 독자용 출처는 서비스명뿐이며, URL을 임의 생성하면 안 된다.

historical 4 pair의 snapshot에는 `reviewEvidencePresent`만 있고 원문 review 배열이 없어, 당시 생성물이 원문 인용을 하지 못한 것이 확인된다. 현재 코드가 과거 산출물을 소급 변경하지는 않는다.
