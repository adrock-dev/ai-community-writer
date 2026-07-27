import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 블로그리뷰 "수집" 스위치가 기본 꺼짐인지, 그리고 꺼져 있을 때 어떻게 동작하는지 잠근다.
 *
 * 원천은 네이버 블로그 검색으로 학원명을 느슨하게 매칭해 다른 학원 글이 섞인다
 * (2026-07-27 실측 539건 중 55건은 학원 고유명이 글 어디에도 없고, 같은 글 18건이 이름이
 * 비슷한 학원 2~3곳에 중복 배정). 글 생성에서는 이미 뺐고, 수집도 멈춰 낡은 자료가 더
 * 쌓이지 않게 한다. 지우지 않고 스위치로 둔 이유는 블로그 글 검증 방식이 정해지면 다시 켜기 위함이다.
 *
 * 특히 중요한 두 가지:
 * - 꺼져 있어도 **이미 저장된 블로그리뷰는 지워지지 않는다**(전량교체 정책의 사고를 막는다).
 * - 안 가져온 것을 "못 가져왔다" 로 세지 않는다. 안 그러면 전 학원이 미조회 경고로 뜬다.
 */

const domain = "blog-sync-switch.test";

describe("블로그리뷰 수집 스위치", () => {
  let db: import("../src/db.service.js").DbService;
  let blogReviewSyncEnabled: typeof import("../src/runtime-config.js").blogReviewSyncEnabled;

  beforeAll(async () => {
    process.env.SEO_DB_PATH = join(mkdtempSync(join(tmpdir(), "blog-switch-")), "admin.db");
    delete process.env.DRIVINGPLUS_BLOG_REVIEW_SYNC;
    const { DbService } = await import("../src/db.service.js");
    ({ blogReviewSyncEnabled } = await import("../src/runtime-config.js"));
    db = new DbService();
    db.init();
    db.createDomain({ domain, display_name: "switch", vertical: "driving" });
  });

  afterEach(() => { delete process.env.DRIVINGPLUS_BLOG_REVIEW_SYNC; });

  it("환경변수가 없으면 꺼져 있다", () => {
    expect(blogReviewSyncEnabled()).toBe(false);
  });

  it("DRIVINGPLUS_BLOG_REVIEW_SYNC 로만 켜진다", () => {
    for (const on of ["1", "true", "on"]) {
      process.env.DRIVINGPLUS_BLOG_REVIEW_SYNC = on;
      expect(blogReviewSyncEnabled(), `"${on}" 은 켜져야 한다`).toBe(true);
    }
    for (const off of ["0", "false", "", "yes"]) {
      process.env.DRIVINGPLUS_BLOG_REVIEW_SYNC = off;
      expect(blogReviewSyncEnabled(), `"${off}" 는 꺼져 있어야 한다`).toBe(false);
    }
  });

  it("수집을 안 해도 이미 저장된 블로그리뷰는 지우지 않고, 미조회로 세지도 않는다", () => {
    const row = (extra: Record<string, unknown>) => ({ id: 7, title: "테스트학원", roadAddress: "서울특별시 강남구 테헤란로 1", ...extra });
    // 1) 예전에 수집해 둔 상태를 만든다.
    db.upsertDrivingplusAcademies(domain, [row({
      blogReviews: [{ title: "후기", content: "강사님이 친절했습니다.", link: "https://blog.example.test/1", postdate: "20260102", images: [] }],
      blogReviewStats: { searchTotalCount: 9, sourceCount: 1 },
    })] as never, { blogReviewsAttempted: true });
    const stored = () => JSON.parse(String(db.get("SELECT blog_reviews FROM academies WHERE domain=? AND external_id=?", [domain, "7"])!.blog_reviews || "[]"));
    expect(stored()).toHaveLength(1);

    // 2) 수집을 끈 동기화(블로그리뷰 없이 학원만 갱신).
    const summary = db.upsertDrivingplusAcademies(domain, [row({})] as never, { blogReviewsAttempted: false });
    expect(stored(), "기존 블로그리뷰가 남아 있어야 한다").toHaveLength(1);
    expect(summary.blog_review_preserved, "안 가져온 것은 미조회로 세지 않는다").toBe(0);
    expect(summary.warnings.join(" ")).not.toContain("가져오지 못한");
  });

  it("수집을 시도했는데 못 가져온 경우는 종전대로 미조회로 센다", () => {
    const summary = db.upsertDrivingplusAcademies(domain, [{ id: 7, title: "테스트학원", roadAddress: "서울특별시 강남구 테헤란로 1" }] as never, { blogReviewsAttempted: true });
    expect(summary.blog_review_preserved).toBe(1);
    expect(summary.warnings.join(" ")).toContain("가져오지 못한");
  });
});

describe("학원·시험장 DB 의 블로그리뷰 동기화", () => {
  it("스위치가 꺼져 있으면 시작 자체를 거부한다(화면을 우회한 직접 호출 대비)", async () => {
    delete process.env.DRIVINGPLUS_BLOG_REVIEW_SYNC;
    process.env.ACADEMY_RESEARCH_DB_PATH = join(mkdtempSync(join(tmpdir(), "blog-switch-research-")), "research.db");
    const { AcademyResearchDbService } = await import("../src/academy-research-db.service.js");
    const { AcademyResearchService } = await import("../src/academy-research.service.js");
    const { DrivingplusApiService } = await import("../src/drivingplus-api.service.js");
    const researchDb = new AcademyResearchDbService();
    researchDb.init();
    const service = new AcademyResearchService(researchDb, new DrivingplusApiService());

    const res = service.startBlogSync();
    expect(res.ok).toBe(false);
    expect(res.error).toContain("꺼져 있습니다");
    delete process.env.ACADEMY_RESEARCH_DB_PATH;
  });
});
