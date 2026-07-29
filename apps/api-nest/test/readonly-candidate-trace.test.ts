import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runReadonlyCandidateTrace } from "../src/academy-candidate-trace.js";

let db: import("../src/db.service.js").DbService;
let scratch = "";
let dbPath = "";

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), "readonly-academy-trace-"));
  dbPath = join(scratch, "admin.db");
  process.env.SEO_DB_PATH = dbPath;
  const { DbService } = await import("../src/db.service.js");
  db = new DbService();
  db.init();
  db.createDomain({ domain: "trace.test", display_name: "trace", vertical: "driving" });
  db.run("INSERT INTO seo_regions (domain, level, region, latitude, longitude, source_name) VALUES (?, ?, ?, ?, ?, ?)", ["trace.test", 2, "추적시", 37, 127, "fixture"]);
  db.upsertAcademies("trace.test", [
    { external_id: "direct", name: "직접학원", region: "추적시", address: "추적시 중심로", phone: "031-000-0000", academy_type: "academy" },
    { external_id: "near", name: "거리학원", region: "다른시", address: "다른시 도로", latitude: 37.1, longitude: 127, phone: "031-000-0000", academy_type: "academy" },
  ]);
  db.createDomain({ domain: "far-trace.test", display_name: "far trace", vertical: "driving" });
  db.run("INSERT INTO seo_regions (domain, level, region, latitude, longitude, source_name) VALUES (?, ?, ?, ?, ?, ?)", ["far-trace.test", 2, "추적시", 37, 127, "fixture"]);
  db.upsertAcademies("far-trace.test", [
    { external_id: "far-a", name: "보장학원A", region: "먼시", address: "먼시 A로", latitude: 37.3, longitude: 127, phone: "031-000-0000", academy_type: "academy" },
    { external_id: "far-b", name: "보장학원B", region: "먼시", address: "먼시 B로", latitude: 37.4, longitude: 127, phone: "031-000-0000", academy_type: "academy" },
  ]);
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("read-only academy candidate trace", () => {
  it("기존 DB를 readOnly로 열어 실제 선택 모듈의 direct/supplement와 본문 표본을 출력한다", async () => {
    const before = db.all("SELECT COUNT(*) AS count FROM academies")[0]?.count;
    const trace = await runReadonlyCandidateTrace({ dbPath, domain: "trace.test", targetRegion: "추적시", slotSeed: "trace-slot" });
    const after = db.all("SELECT COUNT(*) AS count FROM academies")[0]?.count;
    expect(after).toBe(before);
    expect(trace.regionLikeCandidates.map((candidate) => candidate.academyId)).toEqual(["direct"]);
    expect(trace.supplementCandidates.map((candidate) => candidate.academyId)).toEqual(["near"]);
    expect(trace.farCandidates).toEqual([]);
    expect(trace.finalBodyCandidates.map((candidate) => candidate.academyId)).toEqual(["direct", "near"]);
  });

  it("readOnly trace는 20km 보충 뒤에도 최소치가 부족한 경우 far guarantee를 분리해 기록한다", async () => {
    const trace = await runReadonlyCandidateTrace({ dbPath, domain: "far-trace.test", targetRegion: "추적시", slotSeed: "far-slot" });
    expect(trace.regionLikeCandidates).toEqual([]);
    expect(trace.supplementCandidates).toEqual([]);
    expect(trace.farCandidates.map((candidate) => candidate.academyId)).toEqual(["far-a", "far-b"]);
    expect(trace.finalBodyCandidates.map((candidate) => candidate.academyId)).toEqual(["far-a", "far-b"]);
  });
});
