import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AcademyResearchDbService } from "../src/academy-research-db.service.js";
import { AcademyResearchService } from "../src/academy-research.service.js";

describe("재조사에서 비워진 필드의 검증 상태", () => {
  let tmp: string;
  let db: AcademyResearchDbService;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "research-empty-field-"));
    process.env.ACADEMY_RESEARCH_DB_PATH = join(tmp, "research.db");
    db = new AcademyResearchDbService();
    db.init();
    db.upsertBase({ external_id: "academy-1", name: "테스트운전학원" });
    db.upsertResearch("academy-1", { closed_days: "일요일 휴무" }, { engine: "codex" });
    db.setFieldMeta("academy-1", "closed_days", {
      status: "needs_review",
      note: "수집 소스에 closed_days 근거가 없음",
    });
  });

  afterEach(() => {
    delete process.env.ACADEMY_RESEARCH_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("최신 조사에서 값이 null이면 남아 있던 검토 필요 상태를 미확인으로 되돌린다", () => {
    const service = new AcademyResearchService(db, {} as never);

    (service as any).persistResearch("academy-1", { closed_days: null }, { engine: "codex", method: "test" });

    expect(db.getResearch("academy-1")?.closed_days).toBeNull();
    expect(db.listFieldMeta("academy-1").find((row) => row.field_key === "closed_days")).toMatchObject({
      status: "unverified",
      note: "",
    });
  });
});
