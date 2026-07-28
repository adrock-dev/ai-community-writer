import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AcademyResearchDbService } from "../src/academy-research-db.service.js";

describe("AcademyResearchDbService listReviewQueue", () => {
  let tmp: string;
  let db: AcademyResearchDbService;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "research-review-queue-"));
    process.env.ACADEMY_RESEARCH_DB_PATH = join(tmp, "research.db");
    db = new AcademyResearchDbService();
    db.init();
  });

  afterEach(() => {
    delete process.env.ACADEMY_RESEARCH_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("includes academy address so duplicate academy names can be distinguished", () => {
    db.upsertBase({
      external_id: "academy-a",
      name: "동양자동차운전전문학원",
      address: "충청남도 보령시 대천동 1",
    });
    db.upsertBase({
      external_id: "academy-b",
      name: "동양자동차운전전문학원",
      address: "전라북도 익산시 모현동 2",
    });
    db.setFieldMeta("academy-a", "homepage_url", { status: "needs_review" });
    db.setFieldMeta("academy-b", "homepage_url", { status: "needs_review" });

    const result = db.listReviewQueue({ statuses: ["needs_review"] });

    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        external_id: "academy-a",
        name: "동양자동차운전전문학원",
        address: "충청남도 보령시 대천동 1",
      }),
      expect.objectContaining({
        external_id: "academy-b",
        name: "동양자동차운전전문학원",
        address: "전라북도 익산시 모현동 2",
      }),
    ]));
  });
});

describe("AcademyResearchDbService listRuns", () => {
  let tmp: string;
  let db: AcademyResearchDbService;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "research-run-recovery-"));
    process.env.ACADEMY_RESEARCH_DB_PATH = join(tmp, "research.db");
    db = new AcademyResearchDbService();
    db.init();
  });

  afterEach(() => {
    delete process.env.ACADEMY_RESEARCH_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("clears a stale running run when the UI polls the run list", () => {
    const runId = db.createRun({ scope: "all", count_total: 30 });
    db.run("UPDATE research_runs SET heartbeat_at=? WHERE id=?", ["2026-01-01T00:00:00.000Z", runId]);

    const run = db.listRuns().find((item) => item.id === runId);

    expect(run).toMatchObject({
      id: runId,
      status: "error",
      error: "응답이 끊겨 중단 처리됨(프로세스 종료 추정)",
    });
    expect(run?.finished_at).toBeTruthy();
  });
});
