import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 단건 동기화가 블로그리뷰 수집 스위치를 따르는지.
 *
 * 전에는 이 경로만 스위치를 건너뛰었다. 화면에는 부를 길이 없어 묻혀 있다가, 학원 상세에
 * 「원천에서 다시 받기」가 붙으면서 한 번 클릭이면 닿게 됐다. 스위치를 끈 이유는 원천이
 * 학원명을 느슨하게 매칭해 다른 학원 글이 섞이기 때문이고(오배정 10%), 저장이 전량교체라
 * 빈 응답 한 번이면 멀쩡한 후기가 지워진다.
 */
const dir = mkdtempSync(join(tmpdir(), "sync-one-blog-"));
process.env.SEO_DB_PATH = join(dir, "admin.db");
process.env.ACADEMY_RESEARCH_DB_PATH = join(dir, "research.db");

const { AcademyResearchDbService } = await import("../src/academy-research-db.service.js");
const { AcademyResearchService } = await import("../src/academy-research.service.js");
const { DbService } = await import("../src/db.service.js");
const { registerSettingsReader } = await import("../src/runtime-config.js");

const ACADEMY = { id: 7, title: "스위치학원", roadAddress: "대구광역시 중구 1", phone: "053-000-0000" };

let db: any, adminDb: any, service: any, blogCalls: number;
beforeAll(async () => {
  adminDb = new DbService(); await adminDb.onModuleInit();
  // 스위치는 DB 에 저장되지만 runtime-config 는 DB 를 모른다 — 읽기 함수만 등록받는다.
  registerSettingsReader((key: string) => adminDb.getSetting(key));
  db = new AcademyResearchDbService(); await db.onModuleInit();
  const api: any = {
    fetchAcademies: async () => [ACADEMY],
    fetchReviews: async () => ({ reviews: [{ id: 1, content: "자체 후기", point: 5 }] }),
    fetchBlogReviewsResilient: async () => { blogCalls += 1; return { reviews: [{ title: "블로그", content: "블로그 본문", link: "https://b.test" }] }; },
  };
  service = new AcademyResearchService(db, api);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const blogCount = () => db.all("SELECT id FROM academy_reviews WHERE platform='drivingplus_blog'").length;

it("스위치가 켜져 있으면 블로그리뷰까지 받는다", async () => {
  adminDb.setSetting("blog_review_sync", "1");
  blogCalls = 0;
  const res = await service.syncOne("7");
  expect(res.found).toBe(true);
  expect(blogCalls).toBe(1);
  expect(res.blog_reviews).toBe(1);
  expect(blogCount()).toBe(1);
});

it("꺼져 있으면 원천을 부르지도 않고, 기존 블로그리뷰도 지우지 않는다", async () => {
  adminDb.setSetting("blog_review_sync", "0");
  blogCalls = 0;
  const res = await service.syncOne("7");
  expect(blogCalls).toBe(0);
  expect(res.blog_reviews).toBe(0);
  // 전량교체라, 0건으로 덮으면 앞 테스트에서 받아 둔 1건이 사라진다.
  expect(blogCount()).toBe(1);
  // 자체 후기는 스위치와 무관하게 계속 받는다.
  expect(res.student_reviews).toBe(1);
});
