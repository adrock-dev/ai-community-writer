import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 조사에 쓴 소스 보관.
 *
 * 이게 없던 동안 검사 규칙을 고쳐도 이미 저장된 값을 다시 판정할 수 없었다 —
 * 2026-07-28 에 needs_review 22건 중 17건이 그래서 재조사(9분 + LLM)로만 해결됐다.
 */
const dir = mkdtempSync(join(tmpdir(), "research-sources-"));
process.env.ACADEMY_RESEARCH_DB_PATH = join(dir, "research.db");
const { AcademyResearchDbService } = await import("../src/academy-research-db.service.js");

let db: any;
beforeAll(async () => {
  db = new AcademyResearchDbService();
  await db.onModuleInit();
  db.upsertBase({ external_id: "s1", name: "표본학원" });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

it("소스를 본문째 남기고, 어느 필드의 근거였는지 함께 적는다", () => {
  db.replaceSources("s1", [
    { url: "https://a.test", title: "A", text: "셔틀버스 운행 · 휴게실 완비" },
    { url: "https://b.test", title: "B", text: "야간반 18:10~20:00" },
  ], new Map([["https://a.test", ["shuttle_summary", "facilities"]]]));

  const rows = db.listSources("s1");
  expect(rows.map((r: any) => r.url)).toEqual(["https://a.test", "https://b.test"]);
  expect(JSON.parse(rows[0].used_for)).toEqual(["shuttle_summary", "facilities"]);
  // 본문을 버리면 소용이 없다 — 같은 URL 도 다시 받으면 내용이 달라진다.
  expect(rows[0].text).toContain("셔틀버스");
  expect(db.sourceTextFor("s1")).toContain("야간반");
});

it("조사 1회 = 소스 1벌. 누적하지 않는다", () => {
  db.replaceSources("s1", [{ url: "https://c.test", text: "새로 받은 본문" }]);
  const rows = db.listSources("s1");
  expect(rows).toHaveLength(1);
  expect(rows[0].url).toBe("https://c.test");
});

it("본문이나 URL 이 비면 넣지 않는다", () => {
  db.replaceSources("s1", [
    { url: "", text: "본문만 있음" },
    { url: "https://d.test", text: "" },
    { url: "https://e.test", text: "정상" },
  ]);
  expect(db.listSources("s1").map((r: any) => r.url)).toEqual(["https://e.test"]);
});

it("소스가 없는 학원은 빈 문자열 — 근거 검사를 소급할 수 없다는 뜻", () => {
  expect(db.sourceTextFor("없는학원")).toBe("");
});
