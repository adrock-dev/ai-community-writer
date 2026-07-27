# 원천 학원 필드 사용 현황

DrivingPlus 원천 API가 주는 필드가 **어디에 저장되고, 실제로 어디에 쓰이는지** 한 장으로 보는 대조표다.

저장돼 있지만 안 쓰이는 값이 여럿이고, 그중 상당수는 **의도적으로 안 쓰는 것**이다. 근거를 남겨두지 않으면 다음 사람이 "이건 왜 안 쓰지?" 하며 같은 조사를 반복하게 되므로 판단 근거까지 적는다.

확인 시점: 2026-07-27(endpoint 차이) / 2026-07-22(필드별 사용 추적) / 방법: dev·prod endpoint 전수 조회 후 코드 참조 추적.

## 1. 원천 endpoint 차이 — 2026-07-27 기준 **차이 없음**

| endpoint | 학원 수 | 비고 |
| --- | --- | --- |
| dev `api-dev.drivingplus.me:18104` | 386 | 운영에 없는 6곳은 테스트 데이터로 보인다 |
| prod `api.drivingplus.me` | 380 | **전 필드 제공**(키 존재 380/380) |

2026-07-27 실측 결과 **prod 도 전 필드를 내려준다.** 값이 있는 학원 수(prod / dev):

| 필드 | prod | dev |
| --- | --- | --- |
| `seoContent` | 380 | 386 |
| `shuttleBuses` | 212 | 212 |
| `operateHour` | 256 | 262 |
| `licenseTypes` | 336 | 336 |
| `educationPerformance` | 331 | 331 |
| `roadCourses` | 275 | 274 |
| `priceObservations` | 208 | 208 |
| `reviews` | 342 | 340 |
| `shuttleBusUrl` / `Detail` / `ImageUrl` | 4 / 5 / 1 | 4 / 5 / 1 |

**이 문서에는 2026-07-22까지 "prod 에는 `seoContent`·`shuttleBuses`·`operateHour`·`shuttleBus*` 키 자체가 없다"고 적혀 있었는데 지금은 사실이 아니다.** 그 서술 때문에 운영 전환이 오래 보류됐고(`.env`·`.env.example`·`db.service.ts` 주석에도 같은 내용이 퍼져 있었다), 실제로 전환해 보니 손실이 없었다. 원천 필드 가정은 **바꾸기 전에 반드시 실측**한다.

예외 하나 — **블로그 리뷰(`/v1/blog-review/list/:id`)는 운영이 대부분 0건을 반환한다**(보유 학원 70곳 → 8곳). 동기화는 받아온 값으로 무조건 덮어쓰므로 기존 블로그 리뷰가 지워진다. 이는 원천이 정상화될 때까지 감수하기로 한 동작이며(2026-07-27 합의), 블로그 리뷰는 본문에서 이미 제외돼 있어 글 품질에는 영향이 없다.

## 2. 필드 → 저장 위치 → 사용 여부

`academies` 테이블 기준. "사용"은 **글 생성 프롬프트(facts)나 공개 API 로 흘러가는지**를 말한다.

### 2.1 컬럼

| 원천 필드 | 컬럼 | 사용 |
| --- | --- | --- |
| `title` | `name` | ✅ facts·공개 |
| `roadAddress` | `address` | ✅ facts·공개 |
| `educationPerformance.fees` | `price`(파생 텍스트) | ✅ facts·공개 |
| `shuttleBuses` | `shuttle`(파생 텍스트) | ✅ facts·공개 |
| `operateHour` | `hours`(파생 텍스트) | ✅ facts·공개 |
| `vphone` | `vphone` | ✅ facts(`전화:`)·공개 |
| `phone` | `phone` | ⛔ **facts 제외** — 안심번호와 함께 보내면 모델이 둘을 병기했다(발행 20편 중 9편). 공개 API 에는 나간다 |
| `reviews` | `review`, `review_json` | ✅ facts(긍정 리뷰만) / ⛔ 공개 제외 |
| `blogReviews` | `blog_reviews` | ✅ facts(참고 링크) / ⛔ 공개 제외 |
| `seoTitle`/`seoKeywords`/`seoDescription` | 동명 컬럼 | ✅ facts(`SEO 설명`·`SEO 키워드`)·공개 |
| `seoContent` | `seo_content` | ⛔ **미사용** → §3.1 |
| `roadLatitude`/`roadLongitude` | `latitude`/`longitude` | ✅ facts(좌표)·후보 거리 계산 |
| `thumbSavePath`/`photos` | `thumb_url`/`photos` | ✅ 이미지 슬롯·공개 |
| `type` | `academy_type` | ✅ facts(`운영 형태`)·후보 필터 |
| (없음) | `pass_rate` | ⛔ **의도적 공란** — 원천에 합격률이 없다. `accidentRate` 는 교통사고율, `graduates` 는 수료생 수다 |
| (내부) | `source_name`/`source_url` | ⛔ 공개 제외(동기화 endpoint 노출 방지) |

### 2.2 `extra` JSON 키

`extra` 는 원천 응답을 손실 없이 보관하는 자리다. **읽히는 키는 `license_types` 하나뿐이다.**

| 키 | 사용 |
| --- | --- |
| `license_types` | ✅ `academy-course-evidence.ts` → facts `운영 과정:` |
| `education_performance` | △ 동기화 시점에 `price` 로 변환. 원본 구조체는 다시 안 읽음 |
| `shuttle_buses` | △ 동기화 시점에 `shuttle` 로 변환 |
| `operate_hour` | △ 동기화 시점에 `hours` 로 변환 |
| `price_observations` | ⛔ 미사용 → §3.2 |
| `road_courses` | ⛔ 미사용 → §3.3 |
| `review_stats` / `blog_review_stats` | ⛔ 미사용 → §3.4 |
| `shuttle_bus_url` / `_detail` / `_image_url` | ⛔ 미사용 → §3.5 |
| `drivingplus_id`, `review_count`, `blog_review_count`, `fetched_*_count` | ⛔ 운영 지표(동기화 결과 확인용) |

## 3. 안 쓰는 이유

### 3.1 `seo_content` — 새 정보가 없다

원천이 학원마다 써 둔 소개문(386/386건, 중앙 344자). 전수 대조 결과:

- 인근 지명 토큰 1,181개(334곳) 중 **100% 가 `seo_description`·`seo_keywords` 에 이미 존재**한다. 그 둘은 이미 facts 로 간다. 중복이다.
- 면허 종별은 `licenseTypes` 와 겹치는데 **29곳에서 불일치**한다(1종 대형 18·특수 9·2종 소형 4·원동기 3). `seo_content` 에만 종별이 있는 학원은 0곳이라 커버리지 이득도 없다.
- 고유 정보가 있는 건 **면허센터 6곳(업무 범위·준비물)과 시험장 27곳(접근 동선·시험 가능 종별)뿐**, 전체의 8.5% 다. 시험장 문장에는 "교통량이 적은 편", "쾌적한 환경" 같은 검증 불가 주관 서술이 섞인다.
- 실내학원 17곳은 "높은 합격률·2주 완성·단기간·최적의 선택" 광고 카피다. 386건 중 위험 표현 20건이 대부분 여기서 나온다(`isRiskyArticlePattern` 차단 대상).

**결론**: 프롬프트에 넣지 않는다. 시험장·면허센터 단독 소개형 글을 만들 때만 33건이 재료가 되며, 그때도 1차 출처(safedriving.or.kr)를 우선한다.

### 3.2 `price_observations` — 신뢰도가 제각각이다

외부 수집 가격 관측치 1,723건(플레이스 출처 26곳 포함). 공시 성격의 `educationPerformance.fees` 와 **금액이 다른 경우가 많고** 수집 시점·신뢰도가 제각각이라 본문에서 단정할 수 없다. 보관만 한다. "홈페이지 고시가 vs 수집가" 비교 재료로는 유효하다.

### 3.3 `road_courses` — 아직 소비처가 없다

도로주행 코스 1,101개(제목·설명·이미지·유튜브 ID). 위험하다기보다 **쓸 자리를 아직 안 만든 것**이다. 코스 이미지·영상을 본문에 붙이려면 이미지 슬롯 정책과 함께 설계해야 한다. `difficulty` 는 원천이 스키마만 두고 전 건 null 이다.

### 3.4 `review_stats` / `blog_review_stats` — 하나는 유용, 하나는 무의미

- `review_stats`(총 리뷰수·평균 평점): 340/386곳에 값이 있고 총 28,492건. 평균 평점은 최저 1.2 / 중앙 3.8 / 최고 5.0 이며 **3점 미만이 90곳**이다. 그런데 `review_json` 에는 긍정 리뷰만 남으므로, 평균 2.5점 학원과 4.9점 학원이 글에서 똑같이 호평으로 서술된다. 후보 선택·정렬의 근거로 쓸 값어치가 있으나 **본문에 점수를 직접 쓰는 것은 별개 판단**이다(근거 없는 신뢰도 주장이 된다).
- `blog_review_stats.searchTotalCount`: 285곳이 0이고 최대 476,578. 학원별 언급량이 아니라 **검색엔진 총 노출 건수**라 지표로 쓸 수 없다.

### 3.5 셔틀 안내 3필드 — 값이 있는 곳이 6곳뿐

`shuttleBusUrl`(4곳)·`shuttleBusDetail`(5곳)·`shuttleBusImageUrl`(1곳). 실제 정보인 건 2곳뿐이고("당진/예산/아산 전 지역 집 앞 셔틀", "매일 6회 운행"), 나머지는 "위 URL 을 클릭하시면 확인 가능합니다" 같은 **원천 화면용 안내 문구**다. URL 도 외부 링크라 공개 글에 넣기 부적절하다.

## 4. 새 필드를 흘려보내려면

파이프라인이 세 번 좁아진다. **한쪽만 고치면 "가져오는데 저장은 안 되는" 상태가 된다.**

1. `drivingplus-api.service.ts` — 인터페이스 + `normalizeAcademy`. 여기서 빠뜨리면 DB 까지 못 간다.
2. `db.service.ts` `upsertDrivingplusAcademies` — 컬럼 또는 `extra` 키.
3. 소비처 — facts 는 `worker.service.ts` 의 학원별 `parts` 조립, 공개 API 는 `public.controller.ts` 의 `publicAcademy()` 화이트리스트.

가드 테스트:

- `test/drivingplus-source-fields.test.ts` — 원천 키가 1·2 단계에서 사라지지 않는지
- `test/public-academy-payload.test.ts` — 새 컬럼이 공개 응답으로 자동 노출되지 않는지
