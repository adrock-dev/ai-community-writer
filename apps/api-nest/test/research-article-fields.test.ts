import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARTICLE_RESEARCH_FIELDS, CROSS_CHECK_ONLY, NEVER_IN_ARTICLE, usableInArticle } from "../src/academy-research-article-fields.js";

const dir = mkdtempSync(join(tmpdir(), "research-fields-"));
process.env.SEO_DB_PATH = join(dir, "admin.db");
process.env.ACADEMY_RESEARCH_DB_PATH = join(dir, "research.db");

const { DbService } = await import("../src/db.service.js");
const { AcademyResearchDbService } = await import("../src/academy-research-db.service.js");
const { AcademyLinkService } = await import("../src/academy-link.service.js");

let db: any, rdb: any, link: any;
beforeAll(async () => {
  db = new DbService(); await db.onModuleInit();
  rdb = new AcademyResearchDbService(); await rdb.onModuleInit();
  link = new AcademyLinkService(db, rdb);
  db.createDomain({ domain: "fields.test", display_name: "t", vertical: "driving" });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

it("허용 목록 방식이다 — 목록에 없는 필드는 모두 막힌다", () => {
  expect(usableInArticle("facilities")).toBe(true);
  for (const key of [...NEVER_IN_ARTICLE, ...CROSS_CHECK_ONLY]) expect(usableInArticle(key)).toBe(false);
  // 스키마에 새 컬럼이 생겨도 목록에 넣기 전까지는 글에 못 나간다
  expect(usableInArticle("research_engine")).toBe(false);
  expect(usableInArticle("무엇이든")).toBe(false);
});

it("합격률은 승인해도(verified) 도메인으로 나가지 않는다", () => {
  rdb.upsertBase({
    external_id: "9", name: "테스트학원", address: "대구광역시 중구 1",
    raw_json: { id: "9", title: "테스트학원", roadAddress: "대구광역시 중구 1" },
  });
  rdb.setActiveByExternalIds(["9"]);
  rdb.upsertResearch("9", {
    pass_rate: "수도권 최고 합격률이라고 주장",
    name_researched: "테스트운전전문학원",
    facilities: "휴게실, 주차장",
  }, { research_engine: "test", researched_at: new Date().toISOString() });
  // 가장 느슨한 조건: 셋 다 사람이 승인한 상태 + 도메인은 검증완료만
  for (const key of ["pass_rate", "name_researched", "facilities"]) {
    rdb.setFieldMeta("9", key, { status: "verified" });
  }
  db.updateDomain("fields.test", { research_usage: "verified" });

  link.linkToDomain("fields.test");
  const row = db.listAcademies("fields.test", { limit: 5 })[0];
  const research = JSON.parse(row.extra).research ?? {};
  expect(Object.keys(research)).toEqual(["facilities"]);
  expect(row.pass_rate).toBeNull();
});

it("글에 쓰는 필드는 라벨로 원천 사실과 구분된다", () => {
  for (const f of ARTICLE_RESEARCH_FIELDS) expect(f.label).toContain("(조사)");
});
