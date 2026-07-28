import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "relink-"));
process.env.SEO_DB_PATH = join(dir, "admin.db");
process.env.ACADEMY_RESEARCH_DB_PATH = join(dir, "research.db");

const { DbService } = await import("../src/db.service.js");
const { AcademyResearchDbService } = await import("../src/academy-research-db.service.js");
const { AcademyLinkService } = await import("../src/academy-link.service.js");
// 「학원자료 연결」은 upsert 다 — 더하기만 하면 폐업한 학원이 영원히 글 후보로 남는다.
// 이 파일은 연결이 "원천 목록과 맞추기"로 동작하는지, 그리고 원천 장애 때 대량 증발을
// 막는 안전장치가 살아 있는지 고정한다.

let db: any, rdb: any, link: any;
const base = (id: string, name: string, extra: any = {}) => ({
  external_id: id, name, address: `대구광역시 중구 ${id}`,
  raw_json: { id, title: name, roadAddress: `대구광역시 중구 ${id}`, ...extra },
});
beforeAll(async () => {
  db = new DbService(); await db.onModuleInit();
  rdb = new AcademyResearchDbService(); await rdb.onModuleInit();
  link = new AcademyLinkService(db, rdb);
  db.createDomain({ domain: "relink.test", display_name: "t", vertical: "driving" });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

it("원천 목록에서 내려간 학원은 다음 연결에서 정리된다", () => {
  rdb.upsertBase(base("1", "A학원"));
  rdb.upsertBase(base("2", "B학원"));
  rdb.setActiveByExternalIds(["1", "2"]);
  expect(link.linkToDomain("relink.test").linked).toBe(2);

  // 원천이 다음 동기화에서 B학원을 빼면 active=0 이 된다
  rdb.setActiveByExternalIds(["1"]);
  expect(rdb.listBase({ limit: 10 }).length).toBe(1);

  const res = link.linkToDomain("relink.test");
  const names = db.listAcademies("relink.test", { limit: 10 }).map((r: any) => r.name).sort();
  expect(res.removed).toBe(1);
  expect(names).toEqual(["A학원"]);
});

it("값이 바뀐 학원은 덮어쓰고, 값이 사라진 필드는 비워진다", () => {
  rdb.upsertBase(base("3", "C학원", { phone: "053-111-1111", educationPerformance: { year: 2026, quarter: 1, priceType1Auto: 700000 } }));
  rdb.setActiveByExternalIds(["1", "3"]);
  link.linkToDomain("relink.test");
  const before = db.listAcademies("relink.test", { limit: 10 }).find((r: any) => r.name === "C학원");

  // 원천이 전화번호를 아예 뺐다 → 비워져야 한다(옛 값이 남으면 없는 번호를 글에 싣는다)
  rdb.upsertBase(base("3", "C학원", {}));
  link.linkToDomain("relink.test");
  const after = db.listAcademies("relink.test", { limit: 10 }).find((r: any) => r.name === "C학원");
  expect(after.phone).toBeNull();
  expect(after.id).toBe(before.id); // 같은 행을 갱신(새로 만들지 않음)
});

it("한 번에 많이 사라지면 지우지 않고 경고만 남긴다", () => {
  // 원천이 부실한 목록을 준 상황: 20곳 중 19곳이 빠졌다
  const ids = Array.from({ length: 20 }, (_, i) => `s${i}`);
  for (const id of ids) rdb.upsertBase(base(id, `S${id}학원`));
  rdb.setActiveByExternalIds(ids);
  db.deleteAcademies("relink.test");
  expect(link.linkToDomain("relink.test").linked).toBe(20);

  rdb.setActiveByExternalIds(["s0"]);
  const res = link.linkToDomain("relink.test");
  expect(res.removed).toBe(0);
  expect(res.warnings[0]).toContain("자동 삭제하지 않았습니다");
  expect(db.listAcademies("relink.test", { limit: 50 }).length).toBe(20);
});
