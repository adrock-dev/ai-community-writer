import { describe, expect, it } from "vitest";
import { STUDENT_REVIEW_SOURCE, selectedStudentReviewForAcademy, studentReviewFactLines, studentReviewsForAcademy } from "../src/academy-review-evidence.js";

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
      .toBe("수강생 리뷰: “강사님 설명이 자세해서 긴장이 많이 풀렸습니다.” (출처: DrivingPlus 수강생 리뷰)");
  });

  it("review_json이 없을 때만 기존 review 줄을 별도 원문으로 사용하고 중복은 제거한다", () => {
    expect(studentReviewsForAcademy({ review: "같은 후기\n같은 후기\n다른 후기" }).map((review) => review.quote)).toEqual(["같은 후기", "다른 후기"]);
  });

  it("슬롯 seed별로 학원 리뷰 한 건만 재현 가능하게 선택한다", () => {
    const row = { id: 1, review_json: JSON.stringify([{ content: "첫 번째" }, { content: "두 번째" }, { content: "세 번째" }]) };
    const first = selectedStudentReviewForAcademy(row, "slot-a");
    expect(selectedStudentReviewForAcademy(row, "slot-a")).toEqual(first);
    expect(studentReviewFactLines(row, "slot-a")).toHaveLength(1);
  });
});
