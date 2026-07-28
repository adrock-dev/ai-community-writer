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

describe("AcademyResearchDbService 조사 시도 상태", () => {
  let tmp: string;
  let db: AcademyResearchDbService;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "research-attempt-state-"));
    process.env.ACADEMY_RESEARCH_DB_PATH = join(tmp, "research.db");
    db = new AcademyResearchDbService();
    db.init();
    for (const externalId of ["never", "no-source", "failed", "saved"]) {
      db.upsertBase({ external_id: externalId, name: externalId, address: "서울특별시 테스트구 1" });
    }
  });

  afterEach(() => {
    delete process.env.ACADEMY_RESEARCH_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("근거 없음은 미시도와 구분하고 기본 배치 대상에서 제외한다", () => {
    db.recordResearchAttempt("no-source", "no_sources", "공개 소스를 찾지 못했습니다.");
    db.recordResearchAttempt("failed", "failed", "CLI 실행 실패");
    db.upsertResearch("saved", { name_researched: "saved" }, { engine: "codex" });

    const retryTargets = db.listBase({ onlyUnresearched: true, limit: 10 })
      .map((row) => String(row.external_id)).sort();
    const noSource = db.listBase({ q: "no-source", limit: 1 })[0];

    expect(retryTargets).toEqual(["failed", "never"]);
    expect(noSource).toMatchObject({
      researched_at: null,
      last_attempt_outcome: "no_sources",
      last_attempt_error: "공개 소스를 찾지 못했습니다.",
    });
  });
});
