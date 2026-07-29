# Hybrid 대표 수강생 리뷰 계약안

이 계약은 구현 제안이며 현재 DB/schema 변경을 요구하지 않는다.

```ts
type ArticleReviewSelection = {
  academyId: string;
  academyName: string;
  text: string;
  source: { label: string; url: string | null; identifier: string | null };
  eligibleForContent: boolean;
  exclusionReason: string | null;
  privateMeta?: { reviewId?: string | null; rating?: number | null; postedAt?: string | null };
};
```

정책:

1. 최종 후보와 academy ID가 일치하고, 정리 후 길이가 충분하며, source label 또는 URL이 있는 review만 eligible이다.
2. 글 전체에서 `0..1`건만 선택한다. 후보마다 하나씩 선택하지 않는다.
3. 안정적 slot seed로 eligible pool 중 하나를 고르되, 고평점만 우선하지 않는다. 개인정보/반복/의미 없는 문구/위험한 효능을 제외하고, 본문 facts와 충돌하지 않으며 새 이용자 관점을 주는 것을 우선한다.
4. public body에는 짧은 원문 인용 또는 원문 충실 요약과 `출처: {label}`만 표시한다. 작성자, 날짜, 평점, ID, sync 시각은 절대 표시하지 않는다.
5. source label도 URL도 없으면 본문 review block을 생략한다. 현재 데이터에는 `DrivingPlus 수강생 리뷰` label은 있으나 per-review URL은 확인되지 않았다.
6. review가 셔틀·합격 경험을 말해도 현재 서비스/합격 성과 일반화로 확장하지 않는다.

권장 배치: 선택된 학원의 카드 설명 직후 한 번. 비교표 뒤나 CTA 직전에는 두지 않으며, FAQ/checklist에서 다시 인용하지 않는다. 해당 위치가 본문 사실과 중복되면 “후보 설명 중간”보다 “비교표 직전의 이용 경험 참고”가 차선이다.

검수 후보: fabricated review/source, academy mismatch, 2개 이상, metadata 노출, 원문 의미 변경, review를 전체 품질·합격률로 일반화는 hard failure; 너무 긴 인용·본문 중복·광고성은 warning이다.
