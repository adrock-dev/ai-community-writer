import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * academy_research.db 의 블로그리뷰 동기화(`syncBlogReviews`)가 원천 과부하를 후기 삭제로
 * 번역하지 않는지 잠그는 테스트.
 *
 * 여기가 블로그리뷰의 실제 보관처다(admin.db 의 academies.blog_reviews 가 아니라).
 * `replaceReviews` 는 플랫폼별 전량 교체라, 빈 목록을 넘기면 그 학원의 후기가 사라진다.
 * 원천은 처리 한계를 넘으면 예외가 아니라 10초 뒤 code:200 + 빈 배열로 응답하므로,
 * "느린 0건"을 실패로 판정하지 못하면 정상 후기가 통째로 지워진다.
 */

const ACADEMY_ID = 4242;

describe("syncBlogReviews 원천 과부하 방어", () => {
  let tmp: string;
  let db: import("../src/academy-research-db.service.js").AcademyResearchDbService;
  let service: import("../src/academy-research.service.js").AcademyResearchService;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), "research-blog-sync-"));
    process.env.ACADEMY_RESEARCH_DB_PATH = join(tmp, "research.db");
    // 실측 임계(8초)를 테스트에서 40ms 로 낮춰 대기 시간을 줄인다. 판정 로직은 그대로다.
    process.env.DRIVINGPLUS_BLOG_REVIEW_SLOW_EMPTY_MS = "40";
    process.env.DRIVINGPLUS_BLOG_REVIEW_RETRY_DELAY_MS = "0";
    process.env.DRIVINGPLUS_BLOG_REVIEW_ATTEMPTS = "2";

    const { AcademyResearchDbService } = await import("../src/academy-research-db.service.js");
    const { AcademyResearchService } = await import("../src/academy-research.service.js");
    const { DrivingplusApiService } = await import("../src/drivingplus-api.service.js");
    db = new AcademyResearchDbService();
    db.init();
    service = new AcademyResearchService(db, new DrivingplusApiService());

    db.upsertBase({ external_id: String(ACADEMY_ID), name: "테스트자동차운전전문학원", address: "서울특별시 강남구 테헤란로 1" } as never);
    db.replaceReviews(String(ACADEMY_ID), "drivingplus_blog", [{
      external_id: String(ACADEMY_ID),
      platform: "drivingplus_blog",
      source_key: "https://blog.example.test/1",
      title: "○○운전전문학원 후기",
      quote_text: "강사님이 친절해서 편하게 배웠습니다.",
      source_url: "https://blog.example.test/1",
      posted_at: "20260102",
      images: null,
      collect_method: "drivingplus_api",
    }] as never);
  });

  afterEach(() => { globalThis.fetch = originalFetch; });

  afterAll(() => {
    delete process.env.ACADEMY_RESEARCH_DB_PATH;
    delete process.env.DRIVINGPLUS_BLOG_REVIEW_SLOW_EMPTY_MS;
    delete process.env.DRIVINGPLUS_BLOG_REVIEW_RETRY_DELAY_MS;
    delete process.env.DRIVINGPLUS_BLOG_REVIEW_ATTEMPTS;
    rmSync(tmp, { recursive: true, force: true });
  });

  function storedBlogReviews(): unknown[] {
    return db.listReviews(String(ACADEMY_ID)).filter((row) => row.platform === "drivingplus_blog");
  }

  function mockBlogReview(body: unknown, delayMs = 0) {
    globalThis.fetch = (async () => {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  }

  it("느린 0건(원천 과부하)은 실패로 보고 기존 후기를 지우지 않는다", async () => {
    mockBlogReview({ code: 200, data: { reviews: [], totalCount: 0 } }, 80);
    const res = await service.syncBlogReviews();
    expect(res.failed).toBe(1);
    expect(res.empty).toBe(0);
    expect(storedBlogReviews()).toHaveLength(1);
  });

  it("네트워크 예외도 실패로 보고 기존 후기를 지킨다", async () => {
    globalThis.fetch = (async () => { throw new Error("ECONNRESET"); }) as typeof fetch;
    const res = await service.syncBlogReviews();
    expect(res.failed).toBe(1);
    expect(storedBlogReviews()).toHaveLength(1);
  });

  it("빠른 0건(원천이 확인한 0건)은 기존 후기를 지운다", async () => {
    mockBlogReview({ code: 200, data: { reviews: [], totalCount: 0 } }, 0);
    const res = await service.syncBlogReviews();
    expect(res.failed).toBe(0);
    expect(res.empty).toBe(1);
    expect(storedBlogReviews()).toHaveLength(0);
  });

  it("정상 응답은 후기를 저장한다", async () => {
    mockBlogReview({
      code: 200,
      data: {
        totalCount: 1297,
        reviews: [{ title: "○○운전전문학원 다녀왔습니다", content: "코스가 넓어 연습하기 좋았습니다.", link: "https://blog.example.test/2", postdate: "20260301", images: [] }],
      },
    });
    const res = await service.syncBlogReviews();
    expect(res.failed).toBe(0);
    expect(res.with_data).toBe(1);
    expect(storedBlogReviews()).toHaveLength(1);
  });
});
