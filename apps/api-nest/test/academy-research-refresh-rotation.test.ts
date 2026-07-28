import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AcademyResearchDbService } from "../src/academy-research-db.service.js";
import { AcademyResearchService } from "../src/academy-research.service.js";

describe("startRegionResearch 재조사 배치 대상 선정", () => {
  let tmp: string;
  let db: AcademyResearchDbService;
  let service: AcademyResearchService;
  let selectedBatches: string[][];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "research-refresh-rotation-"));
    process.env.ACADEMY_RESEARCH_DB_PATH = join(tmp, "research.db");
    db = new AcademyResearchDbService();
    db.init();
    service = new AcademyResearchService(db, {} as never);
    selectedBatches = [];

    (service as any).resolveProviders = async () => ["codex"];
    (service as any).runRegionBatch = (runId: string, externalIds: string[]) => {
      selectedBatches.push(externalIds);
      for (const externalId of externalIds) {
        db.upsertResearch(externalId, { name_researched: `조사완료 ${externalId}` }, { engine: "codex", method: "a_batch" });
      }
      db.updateRun(runId, { status: "done", count_done: externalIds.length, result: { saved: externalIds.length }, finished: true });
      return Promise.resolve();
    };

    for (let i = 1; i <= 60; i += 1) {
      const padded = String(i).padStart(2, "0");
      db.upsertBase({
        external_id: `academy-${padded}`,
        name: `가나다 운전학원 ${padded}`,
        region: "서울",
        address: `서울특별시 테스트구 ${padded}`,
      } as never);
    }
  });

  afterEach(() => {
    delete process.env.ACADEMY_RESEARCH_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("refreshAll 이어도 성공한 직전 배치와 겹치지 않는 다음 묶음을 고른다", async () => {
    const first = await service.startRegionResearch("서울", { refreshAll: true, limit: 30, provider: "codex" });
    const second = await service.startRegionResearch("서울", { refreshAll: true, limit: 30, provider: "codex" });

    expect(first).toMatchObject({ ok: true, count: 30 });
    expect(second).toMatchObject({ ok: true, count: 30 });
    expect(selectedBatches).toHaveLength(2);
    expect(selectedBatches[0]).toHaveLength(30);
    expect(selectedBatches[1]).toHaveLength(30);
    expect(selectedBatches[1]).toEqual([
      "academy-31", "academy-32", "academy-33", "academy-34", "academy-35",
      "academy-36", "academy-37", "academy-38", "academy-39", "academy-40",
      "academy-41", "academy-42", "academy-43", "academy-44", "academy-45",
      "academy-46", "academy-47", "academy-48", "academy-49", "academy-50",
      "academy-51", "academy-52", "academy-53", "academy-54", "academy-55",
      "academy-56", "academy-57", "academy-58", "academy-59", "academy-60",
    ]);
    expect(new Set([...selectedBatches[0], ...selectedBatches[1]]).size).toBe(60);
  });
});
