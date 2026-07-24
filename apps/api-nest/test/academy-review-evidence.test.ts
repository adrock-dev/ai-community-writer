import { describe, expect, it } from "vitest";
import { STUDENT_REVIEW_SOURCE, selectedStudentReviewForAcademy, studentReviewFactLines, studentReviewsForAcademy, truncateReviewQuote } from "../src/academy-review-evidence.js";

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
    expect(lines[1]).toContain("수강생 반응 근거(분위기 판단용, 본문 인용 금지): ");
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

  it("studentReviewFactLines 가 말줄임된 인용을 낸다", () => {
    const row = { name: "x", external_id: "id-1", review: "다".repeat(140) };
    const line = studentReviewFactLines(row, "seed")[0];
    if (line) {
      const quote = line.match(/“([^”]*)”/)?.[1] ?? "";
      expect(Array.from(quote).length).toBeLessThanOrEqual(100);
    }
  });
});
