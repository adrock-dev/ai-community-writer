import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 조사 시도 결과(last_attempt_outcome)의 이관·복원 규칙.
 *
 * 복원은 학원을 **개수로만** 대조한다(옛 실행이 학원별 결과를 남기지 않았으므로 그 방법뿐이다).
 * 그래서 이관이 실제로 일어난 기동에서만 돌아야 한다 — 매 기동 돌리면, 이관이 끝난 뒤 원천
 * 동기화로 들어온 새 학원 수가 마지막 배치의 no_sources 수와 우연히 같을 때 **한 번도 조사한
 * 적 없는 학원이 "근거 없음" 으로 찍혀 기본 배치에서 조용히 빠진다.**
 */
const dir = mkdtempSync(join(tmpdir(), "attempt-outcome-"));
process.env.ACADEMY_RESEARCH_DB_PATH = join(dir, "research.db");
const { AcademyResearchDbService } = await import("../src/academy-research-db.service.js");

let db: any;
const reopen = async () => { const next = new AcademyResearchDbService(); await next.onModuleInit(); return next; };

beforeAll(async () => {
  db = new AcademyResearchDbService();
  await db.onModuleInit();
  for (const id of ["a1", "a2", "a3"]) db.upsertBase({ external_id: id, name: `${id}학원` });
  db.setActiveByExternalIds(["a1", "a2", "a3"]);
  db.upsertResearch("a1", { facilities: "주차" }, { engine: "test" });
  db.upsertResearch("a2", { facilities: "휴게실" }, { engine: "test" });
  const runId = db.createRun({ scope: "all", method: "a_batch", count_total: 3 });
  db.updateRun(runId, { status: "done", count_done: 3, result: { done: 3, saved: 2, no_sources: 1, failed: 0 }, finished: true });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

it("저장에 성공하면 시도 결과가 saved 로 남고 기본 배치에서 빠진다", () => {
  expect(db.getResearch("a1")?.last_attempt_outcome).toBe("saved");
  expect(db.listBase({ onlyUnresearched: true, limit: 10 }).map((r: any) => r.external_id)).toEqual(["a3"]);
});

it("근거를 못 찾은 시도도 기록돼 무한 재시도를 막는다", () => {
  db.recordResearchAttempt("a3", "no_sources", "공개 소스를 찾지 못함");
  expect(db.listBase({ onlyUnresearched: true, limit: 10 })).toHaveLength(0);
  // 실행 자체가 실패한 것은 다시 시도해야 한다 — 원인이 일시적일 수 있다.
  db.recordResearchAttempt("a2", "failed", "CLI 실행 실패");
  expect(db.listBase({ onlyUnresearched: true, limit: 10 }).map((r: any) => r.external_id)).toEqual(["a2"]);
  db.upsertResearch("a2", { facilities: "휴게실" }, { engine: "test" });
});

it("옛 DB(시도 결과가 없던 행)는 재기동 때 이관되고, 소스 없던 학원이 복원된다", async () => {
  // 이관 전 상태를 만든다: 시도 결과를 지우고 a3 는 기록 자체를 없앤다.
  db.run("UPDATE academy_research SET last_attempt_outcome=NULL, last_attempted_at=NULL");
  db.run("DELETE FROM academy_research WHERE external_id='a3'");
  expect(db.listBase({ onlyUnresearched: true, limit: 10 })).toHaveLength(3);

  const reopened = await reopen();
  expect(reopened.getResearch("a1")?.last_attempt_outcome).toBe("saved");
  // 마지막 배치가 no_sources 1곳으로 끝났고 미시도도 1곳이라 a3 를 그 1곳으로 복원한다.
  expect(reopened.getResearch("a3")?.last_attempt_outcome).toBe("no_sources");
  expect(reopened.listBase({ onlyUnresearched: true, limit: 10 })).toHaveLength(0);
});

it("이관이 끝난 뒤 들어온 새 학원은 복원 대상이 아니다 — 조사한 적 없으면 배치에 남아야 한다", async () => {
  const before = await reopen();
  before.upsertBase({ external_id: "new1", name: "새로들어온학원" });
  before.setActiveByExternalIds(["a1", "a2", "a3", "new1"]);
  expect(before.listBase({ onlyUnresearched: true, limit: 10 }).map((r: any) => r.external_id)).toEqual(["new1"]);

  // 미시도 1곳 === 마지막 배치의 no_sources 1곳 이라 개수 조건만 보면 복원 대상으로 걸린다.
  // 이관이 일어나지 않은 기동이므로 복원이 돌면 안 된다.
  const after = await reopen();
  expect(after.getResearch("new1")?.last_attempt_outcome).toBeUndefined();
  expect(after.listBase({ onlyUnresearched: true, limit: 10 }).map((r: any) => r.external_id)).toEqual(["new1"]);
});
