import { describe, expect, it } from "vitest";
import { STUDENT_REVIEW_SOURCE, isReviewAboutOtherReviews, selectedStudentReviewForAcademy, studentReviewFactLines, studentReviewsForAcademy, truncateReviewQuote } from "../src/academy-review-evidence.js";
import { truncateLegacyPlusReview } from "../src/t01-legacy-plus.js";

describe("academy student review evidence", () => {
  it("원문 리뷰를 테마로 축약하지 않고 출처·평점·작성일과 함께 보존한다", () => {
    const reviews = studentReviewsForAcademy({
      review_json: JSON.stringify([
        { author: "홍길동", point: 5, date: "2026-07-01", content: "강사님 설명이 자세해서 긴장이 많이 풀렸습니다." },
        { author: "김", point: 4, date: "2026/07/02", content: "상담부터 수업 일정 안내까지 이해하기 쉬웠어요." },
      ]),
    });

    expect(reviews).toEqual([
      { quote: "강사님 설명이 자세해서 긴장이 많이 풀렸습니다.", source: STUDENT_REVIEW_SOURCE, rating: 5, postedAt: "2026-07-01", authorMasked: "홍**" },
      { quote: "상담부터 수업 일정 안내까지 이해하기 쉬웠어요.", source: STUDENT_REVIEW_SOURCE, rating: 4, postedAt: "2026/07/02", authorMasked: "김*" },
    ]);
    expect(studentReviewFactLines({ review_json: JSON.stringify([{ author: "홍길동", point: 5, date: "2026-07-01", content: "강사님 설명이 자세해서 긴장이 많이 풀렸습니다." }]) }, "slot-a")[0])
      .toBe("수강생 리뷰: “강사님 설명이 자세해서 긴장이 많이 풀렸습니다.” (출처: 운전면허PLUS 실제 수강생 리뷰)");
  });

  it("review_json이 없을 때만 기존 review 줄을 별도 원문으로 사용하고 중복은 제거한다", () => {
    expect(studentReviewsForAcademy({ review: "같은 후기\n같은 후기\n다른 후기" }).map((review) => review.quote)).toEqual(["같은 후기", "다른 후기"]);
  });

  it("슬롯 seed별로 학원 리뷰 한 건만 재현 가능하게 선택한다", () => {
    // 적격 길이(12자 이상)를 만족하는 픽스처를 쓴다 — 이 테스트가 보는 것은 재현성이다.
    const row = { id: 1, review_json: JSON.stringify([
      { content: "첫 번째 리뷰입니다 강사님 설명이 좋았어요" },
      { content: "두 번째 리뷰입니다 차량 상태가 깔끔했어요" },
      { content: "세 번째 리뷰입니다 수업 일정이 유연했어요" },
    ]) };
    const first = selectedStudentReviewForAcademy(row, "slot-a");
    expect(selectedStudentReviewForAcademy(row, "slot-a")).toEqual(first);
    // 인용용 1건 + 나머지 적격 후기(분위기 판단 근거, 인용 금지) 1줄.
    const lines = studentReviewFactLines(row, "slot-a");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("수강생 리뷰: ");
    expect(lines[1]).toContain("추가 후기(내부 판단용 · 본문에 인용·언급 금지): ");
    // 근거 줄에는 인용으로 뽑힌 그 후기가 중복되지 않는다.
    expect(lines[1]).not.toContain(first!.quote);
  });
});

// 적격 검사를 뽑은 뒤에 하면, 뽑힌 하나가 탈락할 때 다른 적격 리뷰가 있어도 그 학원은
// 리뷰를 통째로 잃는다. 반드시 적격 리뷰 중에서 뽑아야 한다.
describe("리뷰는 적격한 것 중에서 고른다", () => {
  const row = (quotes: string[]) => ({
    external_id: "1", name: "가나다학원",
    review_json: JSON.stringify(quotes.map((content) => ({ content, point: 5 }))),
  });

  it("부적격 리뷰가 섞여 있어도 적격 리뷰를 고른다", () => {
    // 첫 번째는 너무 짧아 부적격, 두 번째는 적격.
    const picked = selectedStudentReviewForAcademy(row(["짧음", "강사님이 차분하게 설명해 주셔서 도로주행이 수월했습니다"]), "seed");
    expect(picked?.quote).toContain("도로주행이 수월했습니다");
  });

  it("적격 리뷰가 하나도 없으면 null 이다(억지로 싣지 않는다)", () => {
    expect(selectedStudentReviewForAcademy(row(["짧음", "굿"]), "seed")).toBeNull();
  });

  it("전화번호가 든 리뷰는 고르지 않는다", () => {
    const picked = selectedStudentReviewForAcademy(row(["문의는 031-595-2900 으로 하세요", "수업 일정이 유연해서 평일 저녁에도 들을 수 있었습니다"]), "seed");
    expect(picked?.quote).not.toContain("031-595-2900");
  });

  it("같은 시드면 같은 리뷰가 나온다(재현성)", () => {
    const quotes = ["강사님 설명이 자세해서 좋았습니다 정말로", "차량 상태가 깔끔하고 예약도 편했습니다 추천"];
    expect(selectedStudentReviewForAcademy(row(quotes), "a")?.quote).toBe(selectedStudentReviewForAcademy(row(quotes), "a")?.quote);
  });
});

describe("리뷰 100자 말줄임", () => {
  it("100자 미만은 그대로 둔다", () => {
    const short = "가".repeat(80);
    expect(truncateReviewQuote(short)).toBe(short);
    expect(truncateReviewQuote(short)).not.toContain("…");
  });

  it("100자 이상이면 100자(99자+…)로 줄인다", () => {
    const long = "가".repeat(150);
    const out = truncateReviewQuote(long);
    expect(Array.from(out).length).toBe(100);
    expect(out.endsWith("…")).toBe(true);
  });

  it("경계값 100자는 줄인다(100자 '이상' 기준)", () => {
    const exact = "나".repeat(100);
    const out = truncateReviewQuote(exact);
    expect(Array.from(out).length).toBe(100);
    expect(out.endsWith("…")).toBe(true);
  });

  it("자른 자리 가까이에 문장 경계가 있으면 거기까지 물린다", () => {
    // 실제 사례: "…일정 잡기도 수월했어요 연세대 …" — 93자에 경계가 있는데 99자에서 끊겼다.
    const text = `${"가".repeat(80)} 정말 좋았어요 그리고 다음 문장이 길게 이어집니다만 여기는 잘립니다`;
    const out = truncateReviewQuote(text);
    expect(out).toBe(`${"가".repeat(80)} 정말 좋았어요…`);
  });

  it("경계가 한도의 80%보다 앞이면 그대로 끊는다", () => {
    // 경계까지 물리면 버리는 양이 너무 커진다.
    const text = `짧게 끝나요 ${"가".repeat(140)}`;
    const out = truncateReviewQuote(text);
    expect(Array.from(out).length).toBe(100);
    expect(out.endsWith("가…")).toBe(true);
  });

  it("마침표로 끝나는 문장도 경계로 인정한다", () => {
    const text = `${"나".repeat(78)} 아주 만족합니다. 그리고 이어지는 다른 이야기가 계속됩니다`;
    expect(truncateReviewQuote(text)).toBe(`${"나".repeat(78)} 아주 만족합니다.…`);
  });

  it("두 쌍둥이 함수가 같은 결과를 낸다", () => {
    // t01-legacy-plus-postedit 이 이 값으로 인용을 매칭해, 어긋나면 매칭이 깨진다.
    for (const text of ["짧은 후기", "가".repeat(100), `${"다".repeat(85)} 좋았어요 뒤에 더 있습니다만`]) {
      expect(truncateReviewQuote(text)).toBe(truncateLegacyPlusReview(text));
    }
  });

  it("studentReviewFactLines 가 말줄임된 인용을 낸다", () => {
    const row = { name: "x", external_id: "id-1", review: "다".repeat(140) };
    const line = studentReviewFactLines(row, "seed")[0];
    if (line) {
      const quote = line.match(/“([^”]*)”/)?.[1] ?? "";
      expect(Array.from(quote).length).toBeLessThanOrEqual(100);
    }
  });
});

describe("평판이 나쁘다고 알리는 후기는 인용에서 뺀다", () => {
  // 발행 글 실측(홍천, 평균 3.3점). 5점 호평인데 첫 문장이 "이 학원 후기가 나쁘다"를 알렸다.
  it("'후기를 봤을 때는 걱정' 처럼 후기를 부정적 반응과 함께 말하면 걸러낸다", () => {
    expect(isReviewAboutOtherReviews("솔직히 처음에 후기를 봤을 때는 조금 걱정되고 망설여졌어요. 그런데 합격했어요.")).toBe(true);
    expect(isReviewAboutOtherReviews("후기가 낮아서 처음에는 걱정했습니다만 친절하셔서 한 번에 합격했습니다")).toBe(true);
    expect(isReviewAboutOtherReviews("리뷰땜에 걱정했는데 다들 친절하고 설명 잘해주셨어요")).toBe(true);
    expect(isReviewAboutOtherReviews("별점이 낮아서 조금 고민했지만 집이랑 가까워서 선택했는데 좋았어요")).toBe(true);
  });

  it("자기 글을 '후기'라 부르는 표현은 걸러내지 않는다", () => {
    expect(isReviewAboutOtherReviews("이번에 2종 보통 면허 딴 후기 남깁니다! 강사님이 친절하게 알려주셨어요")).toBe(false);
    expect(isReviewAboutOtherReviews("오늘 도로주행 합격해서 후기 올려봅니다. 시설도 깨끗했어요")).toBe(false);
  });

  it("학원과 무관한 걱정(시험·긴장)은 걸러내지 않는다", () => {
    expect(isReviewAboutOtherReviews("처음엔 한번에 붙을까 걱정이 많았는데 강사님이 잘 알려주셔서 편하게 배웠어요")).toBe(false);
    expect(isReviewAboutOtherReviews("기능시험 보기 전까지는 긴장 때문에 걱정이 많았는데 자신감이 생겼어요")).toBe(false);
  });

  it("기존 규칙(다른 리뷰 직접 논평)도 그대로 잡는다", () => {
    expect(isReviewAboutOtherReviews("리뷰보고 쫄았는데 강사분들까지 다 친절하고 좋았어요")).toBe(true);
    expect(isReviewAboutOtherReviews("여기 리뷰 악의적 조작일 가능성이 높음")).toBe(true);
  });
});
