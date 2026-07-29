import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 블로그리뷰 "못 가져옴"과 "진짜 0건"을 구분해 저장하는지 잠그는 테스트.
 *
 * 배경: 원천 `/v1/blog-review/list` 는 처리 한계를 넘으면 예외가 아니라 code:200 + 빈 배열로
 * 응답한다. 후기는 원천 기준 전량 교체 정책이라, 이 빈 응답을 그대로 반영하면 멀쩡한 후기가
 * 삭제된다(실제로 453 → 342건으로 줄어든 적이 있다).
 *
 * 그래서 계약을 이렇게 잡았다:
 *   - blogReviews 가 undefined  → 조회 실패. 기존 blog_reviews 를 유지한다.
 *   - blogReviews 가 []         → 원천이 확인해준 0건. 의도대로 삭제한다.
 * 두 경우가 같아지면 "삭제되지 않아야 할 후기가 사라지거나, 사라져야 할 후기가 남는다".
 */

const domain = "blog-review-preserve.test";

const BLOG_REVIEW = {
  title: "○○운전전문학원 다녀온 후기",
  content: "강사님이 친절해서 편하게 배웠고 코스도 넓었습니다.",
  link: "https://blog.example.test/1",
  postdate: "20260102",
  images: [] as string[],
};

function sourceRow(overrides: Record<string, unknown>) {
  return {
    id: 4242,
    title: "테스트자동차운전전문학원",
    roadAddress: "서울특별시 강남구 테헤란로 1",
    ...overrides,
  };
}

describe("블로그리뷰 조회 실패 시 기존 후기 보존", () => {
  let db: import("../src/db.service.js").DbService;
  let tmp: string;

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), "blog-review-preserve-"));
    process.env.SEO_DB_PATH = join(tmp, "test.db");
    const { DbService } = await import("../src/db.service.js");
    db = new DbService();
    db.init();
    db.createDomain({ domain, display_name: "blog review preserve", vertical: "driving" });
  });

  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  function storedBlogReviews(): unknown[] {
    const row = db.get("SELECT blog_reviews FROM academies WHERE domain=? AND external_id=?", [domain, "4242"])!;
    return JSON.parse(String(row.blog_reviews || "[]"));
  }

  it("정상 동기화는 블로그리뷰를 저장한다", () => {
    const summary = db.upsertDrivingplusAcademies(domain, [sourceRow({
      blogReviews: [BLOG_REVIEW],
      blogReviewStats: { searchTotalCount: 1297, sourceCount: 3 },
    })] as never);
    expect(storedBlogReviews()).toHaveLength(1);
    expect(summary.blog_review_preserved).toBe(0);
  });

  it("blogReviews 가 undefined 면(조회 실패) 기존 후기를 지우지 않는다", () => {
    const summary = db.upsertDrivingplusAcademies(domain, [sourceRow({})] as never);
    expect(storedBlogReviews()).toHaveLength(1);
    expect(summary.blog_review_preserved).toBe(1);
    expect(summary.blog_review_count).toBe(1);
    expect(summary.warnings.join(" ")).toContain("기존 후기를 유지");
  });

  it("조회 실패 시 통계도 기존 값을 유지한다", () => {
    db.upsertDrivingplusAcademies(domain, [sourceRow({})] as never);
    const row = db.get("SELECT extra FROM academies WHERE domain=? AND external_id=?", [domain, "4242"])!;
    const extra = JSON.parse(String(row.extra || "{}"));
    expect(extra.blog_review_stats).toMatchObject({ searchTotalCount: 1297 });
    expect(extra.blog_review_count).toBe(1);
  });

  it("blogReviews 가 빈 배열이면(원천이 확인한 0건) 삭제한다", () => {
    const summary = db.upsertDrivingplusAcademies(domain, [sourceRow({
      blogReviews: [],
      blogReviewStats: { searchTotalCount: 0, sourceCount: 0 },
    })] as never);
    expect(storedBlogReviews()).toHaveLength(0);
    expect(summary.blog_review_preserved).toBe(0);
  });
});

/**
 * 원천 과부하는 예외가 아니라 "느린 0건"(code:200 + 빈 배열, 10초)으로 나타난다.
 * 반대로 진짜 후기가 없는 학원은 "빠른 0건"이다. 이 둘을 시간으로 가른다.
 */
describe("fetchAcademies 블로그리뷰 실패 방어", () => {
  // 중단 임계(실패 10곳 이상 + 20% 이상)를 넘기는 최소 규모. 순차 조회라 개수가 곧 실행 시간이다.
  const academies = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, title: `학원${i + 1}` }));

  async function runWithEmptyBlogReviews(delayMs: number) {
    // 실측 임계(8초)를 테스트에서 40ms 로 낮춰 대기 시간을 줄인다. 판정 로직은 그대로다.
    process.env.DRIVINGPLUS_BLOG_REVIEW_SLOW_EMPTY_MS = "40";
    process.env.DRIVINGPLUS_BLOG_REVIEW_RETRY_DELAY_MS = "0";
    process.env.DRIVINGPLUS_BLOG_REVIEW_ATTEMPTS = "2";
    const { DrivingplusApiService } = await import("../src/drivingplus-api.service.js");
    const api = new DrivingplusApiService();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any) => {
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      if (String(input).includes("get-all-academy")) return json({ code: 200, data: academies });
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      return json({ code: 200, data: { reviews: [], totalCount: 0 } });
    }) as typeof fetch;
    try {
      return await api.fetchAcademies({ includeReviews: false, includeBlogReviews: true });
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.DRIVINGPLUS_BLOG_REVIEW_SLOW_EMPTY_MS;
      delete process.env.DRIVINGPLUS_BLOG_REVIEW_RETRY_DELAY_MS;
      delete process.env.DRIVINGPLUS_BLOG_REVIEW_ATTEMPTS;
    }
  }

  it("느린 0건이 임계를 넘으면 부분 반영 없이 동기화를 중단한다", async () => {
    await expect(runWithEmptyBlogReviews(80)).rejects.toThrow(/동기화를 중단/);
  });

  it("빠른 0건은 진짜 0건으로 보고 그대로 반영한다", async () => {
    const rows = await runWithEmptyBlogReviews(0);
    expect(rows).toHaveLength(academies.length);
    // blogReviews 가 배열로 채워져야 upsert 가 삭제를 수행한다(undefined 면 보존된다).
    expect(rows.every((row) => Array.isArray(row.blogReviews) && row.blogReviews.length === 0)).toBe(true);
  });
});
