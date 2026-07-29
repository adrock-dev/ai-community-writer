import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 학원 동기화 요청이 블로그리뷰 수집 여부를 어떻게 결정하는지 잠근다.
 *
 * 2026-07-27 회귀: 관리자 화면이 `include_blog_reviews: blogSyncOn` 을 실어 보냈는데, 상태를 아직
 * 못 읽은 첫 화면에서는 그 값이 false 였다. 서버는 그것을 "수집하지 말라" 는 명시적 지시로 받아
 * **스위치가 켜져 있어도 블로그리뷰를 건너뛰었다.** 화면은 필드를 아예 보내지 않도록 고쳤지만
 * (`lib/api.ts` 타입에서도 제거), 서버 쪽 판단이 그 전제를 지키는지는 여기서 지킨다.
 *
 * 계약: 필드가 없으면 스위치가 결정한다. 명시적 false 만 수집을 끈다. 스위치가 꺼져 있으면
 * 요청이 true 를 보내도 켜지지 않는다(낡은 클라이언트·직접 호출 대비).
 */

// checkAuth 는 ADMIN_PASSWORD 미설정 시 no-op — vitest 는 .env 를 로드하지 않는다.
const REQ = { headers: {} } as any;
const DOMAIN = "blog-sync-request.test";

let db: import("../src/db.service.js").DbService;
let ctl: import("../src/admin.controller.js").AdminController;
let tmp: string;
/** startAcademySync 가 실제로 받은 옵션. 원천을 두드리지 않도록 스텁으로 가로챈다. */
let captured: { includeBlogReviews?: boolean } = {};

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "blog-sync-request-"));
  process.env.SEO_DB_PATH = join(tmp, "admin.db");
  delete process.env.DRIVINGPLUS_BLOG_REVIEW_SYNC;
  const { DbService } = await import("../src/db.service.js");
  const { AdminController } = await import("../src/admin.controller.js");
  db = new DbService();
  db.init();
  db.createDomain({ domain: DOMAIN, display_name: "req", vertical: "driving" });
  const syncStub = {
    startAcademySync: (_domain: string, opts: { includeBlogReviews?: boolean }) => {
      captured = opts;
      return { ok: true as const, run_id: "stub-run" };
    },
  };
  ctl = new AdminController(db, {} as never, {} as never, {} as never, syncStub as never, {} as never);
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** 화면이 실제로 보내는 본문(블로그 필드 없음). */
const CLIENT_BODY = { include_reviews: true, review_limit: 5, review_sort: "point", blog_review_limit: 3 };

function start(body: Record<string, unknown>): boolean {
  captured = {};
  ctl.syncDrivingplusAcademies(REQ, {}, DOMAIN, body as never);
  return Boolean(captured.includeBlogReviews);
}

describe("학원 동기화 요청의 블로그리뷰 수집 판단", () => {
  it("스위치가 켜져 있고 요청에 필드가 없으면 수집한다(화면이 상태를 못 읽은 채 눌러도 동일)", () => {
    db.setSetting("blog_review_sync", "1");
    expect(start(CLIENT_BODY), "화면이 보내는 본문 그대로").toBe(true);
    expect(start({}), "빈 본문이어도 스위치가 결정한다").toBe(true);
  });

  it("스위치가 켜져 있어도 명시적 false 는 존중한다", () => {
    db.setSetting("blog_review_sync", "1");
    expect(start({ ...CLIENT_BODY, include_blog_reviews: false })).toBe(false);
  });

  it("스위치가 꺼져 있으면 요청이 true 를 보내도 켜지지 않는다", () => {
    db.setSetting("blog_review_sync", "0");
    expect(start({ ...CLIENT_BODY, include_blog_reviews: true })).toBe(false);
    expect(start(CLIENT_BODY)).toBe(false);
  });
});
