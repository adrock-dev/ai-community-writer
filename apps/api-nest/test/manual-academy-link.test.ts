import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "manual-flow-"));
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
  db.createDomain({ domain: "manual.test", vertical: "driving", display_name: "테스트" });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

it("수동 등록분은 원천 동기화가 비활성으로 내리지 않는다", () => {
  rdb.upsertBase({ external_id: "src-1", name: "원천학원", address: "대구광역시 달서구 1", raw_json: { id: "src-1", title: "원천학원", roadAddress: "대구광역시 달서구 1" } });
  const manualId = rdb.createManualBase({ name: "직접등록학원", region: "대구", address: "대구광역시 북구 2", price: "65만원", pass_rate: "82%", source_name: "학원 홈페이지" });
  expect(manualId.startsWith("manual-")).toBe(true);

  // 원천 동기화가 src-1 만 들고 왔다 → 수동분은 살아남아야 한다
  rdb.setActiveByExternalIds(["src-1"]);
  const active = rdb.listBase({ limit: 100 }).map((r: any) => r.external_id);
  expect(active).toContain("src-1");
  expect(active).toContain(manualId);
  expect(rdb.countInactive()).toBe(0);
});

it("도메인 연결에 수동 등록분이 사람이 적은 값 그대로 실린다", () => {
  const res = link.linkToDomain("manual.test");
  expect(res.linked).toBe(2);
  const rows = db.listAcademies("manual.test", { limit: 10 });
  const manual = rows.find((r: any) => r.name === "직접등록학원");
  expect(manual.price).toBe("65만원");
  expect(manual.pass_rate).toBe("82%");
  expect(manual.source_name).toBe("학원 홈페이지");
  expect(manual.region).toBeTruthy();
  // 원천분은 출처 표기가 그대로여야 한다
  expect(rows.find((r: any) => r.name === "원천학원").source_name).toBe("DrivingPlus");
});

it("수동 등록분만 삭제할 수 있다", () => {
  const manualId = rdb.listBase({ limit: 100 }).find((r: any) => r.source === "manual").external_id;
  expect(rdb.deleteManualBase("src-1")).toBe(false);
  expect(rdb.deleteManualBase(manualId)).toBe(true);
  expect(rdb.listBase({ limit: 100 }).length).toBe(1);
});

it("제외한 학원은 다시 연결해도 돌아오지 않는다", () => {
  rdb.upsertBase({ external_id: "src-2", name: "뺄학원", address: "대구광역시 수성구 3", raw_json: { id: "src-2", title: "뺄학원", roadAddress: "대구광역시 수성구 3" } });
  link.linkToDomain("manual.test");
  const target = db.listAcademies("manual.test", { limit: 10 }).find((r: any) => r.name === "뺄학원");
  expect(target).toBeTruthy();

  const res = db.excludeAcademy("manual.test", target.id);
  expect(res).toEqual({ deleted: 1, excluded: true });

  const relinked = link.linkToDomain("manual.test");
  expect(relinked.excluded).toBe(1);
  expect(db.listAcademies("manual.test", { limit: 10 }).some((r: any) => r.name === "뺄학원")).toBe(false);

  // 조사 DB 원본은 남아 있어야 한다 — 제외는 도메인별 결정이다
  expect(rdb.getBase("src-2")).toBeTruthy();

  // 해제하면 다음 연결에 돌아온다
  expect(db.unexcludeAcademy("manual.test", "src-2")).toBe(1);
  link.linkToDomain("manual.test");
  expect(db.listAcademies("manual.test", { limit: 10 }).some((r: any) => r.name === "뺄학원")).toBe(true);
});
