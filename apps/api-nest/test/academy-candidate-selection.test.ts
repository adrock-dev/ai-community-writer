import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getArchetype, structureGuideForArchetype } from "../src/archetypes.js";
import { ACADEMY_MAX_CANDIDATES, ACADEMY_MIN_FOR_BEST, ACADEMY_MIN_GUARANTEE_MAX_KM, ACADEMY_NEARBY_MAX_KM, ACADEMY_USED_PER_POST } from "../src/constants.js";
import { seededCandidateSample, selectAcademiesForRegion } from "../src/academy-candidate-selection.js";

type Db = import("../src/db.service.js").DbService;
type Worker = import("../src/worker.service.js").WorkerService;

let db: Db;
let WorkerService: typeof import("../src/worker.service.js").WorkerService;
let buildPrompt: typeof import("../src/worker.service.js").buildPrompt;
let scratch = "";
const targetRegion = "테스트시";
const types = ["exam_academy", "academy"];

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), "academy-selection-"));
  process.env.SEO_DB_PATH = join(scratch, "admin.db");
  const dbModule = await import("../src/db.service.js");
  const workerModule = await import("../src/worker.service.js");
  const DbService = dbModule.DbService;
  WorkerService = workerModule.WorkerService;
  buildPrompt = workerModule.buildPrompt;
  db = new DbService();
  db.init();
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function setupDomain(name: string): string {
  const domain = `academy-${name}.test`;
  db.createDomain({ domain, display_name: name, vertical: "driving" });
  db.run("INSERT INTO seo_regions (domain, level, region, latitude, longitude, source_name) VALUES (?, ?, ?, ?, ?, ?)", [domain, 2, targetRegion, 37, 127, "fixture"]);
  return domain;
}

function academy(name: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    external_id: `id-${name}`,
    name,
    region: "다른시",
    address: "다른시 테스트로 1",
    latitude: 37.01,
    longitude: 127,
    academy_type: "academy",
    phone: "031-000-0000",
    ...fields,
  };
}

function insert(domain: string, rows: Array<Record<string, unknown>>): void { db.upsertAcademies(domain, rows); }

function factText(domain: string): string {
  const worker = new WorkerService(db, {} as never) as Worker;
  return (worker as any).buildFacts(domain, {
    slot_id: `T01_${domain}`,
    region: targetRegion,
    primary_keyword: `${targetRegion} 운전면허학원`,
  }, {}, types, getArchetype("local")).text;
}

describe("Phase A: 실제 후보 선택 fixture", () => {
  it("A: region LIKE 후보만으로 풀 7곳을 채우면 supplements/far 없이 이름순 후보와 본문 5곳을 사용한다", () => {
    const domain = setupDomain("direct");
    insert(domain, Array.from({ length: 7 }, (_, index) => academy(`직접${index + 1}`, { region: targetRegion, address: `${targetRegion} 중심로 ${index + 1}` })));

    const result = selectAcademiesForRegion(db, domain, targetRegion, ACADEMY_MAX_CANDIDATES, types, ACADEMY_MIN_FOR_BEST);
    expect(result.candidates.map((candidate) => candidate.name)).toEqual(["직접1", "직접2", "직접3", "직접4", "직접5", "직접6", "직접7"]);
    expect(result.trace.regionLikeCandidates).toHaveLength(7);
    expect(result.trace.supplementCandidates).toEqual([]);
    expect(result.trace.farCandidates).toEqual([]);
    expect((factText(domain).match(/^\[\d+\]/gm) || [])).toHaveLength(ACADEMY_USED_PER_POST);
  });

  it("B: region LIKE 후보가 2곳이어도 목표 풀 7곳 미달이면 20km supplements가 실행된다", () => {
    const domain = setupDomain("pool-short");
    insert(domain, [
      academy("직접A", { region: targetRegion, address: `${targetRegion} 1로`, latitude: null, longitude: null }),
      academy("직접B", { region: targetRegion, address: `${targetRegion} 2로`, latitude: null, longitude: null }),
      academy("근거리1", { latitude: 37.01 }), academy("근거리2", { latitude: 37.02 }), academy("근거리3", { latitude: 37.03 }),
      academy("근거리4", { latitude: 37.04 }), academy("근거리5", { latitude: 37.05 }),
    ]);

    const result = selectAcademiesForRegion(db, domain, targetRegion, 7, types, 2);
    expect(result.trace.regionLikeCandidates).toHaveLength(2);
    expect(result.trace.supplementCandidates.map((candidate) => candidate.academyName)).toEqual(["근거리1", "근거리2", "근거리3", "근거리4", "근거리5"]);
    expect(result.trace.farCandidates).toEqual([]);
    expect(result.candidates).toHaveLength(7);
    expect((factText(domain).match(/^\[\d+\]/gm) || [])).toHaveLength(5);
  });

  it("C: 20km 보충은 타입 필터·중복 제거를 유지하고 좌표 없는 후보는 선택하지 않는다", () => {
    const domain = setupDomain("filters");
    insert(domain, [
      academy("직접", { region: targetRegion, address: `${targetRegion} 1로`, external_id: "shared" }),
      academy("근거리", { external_id: "near", latitude: 37.03 }),
      academy("좌표없음", { external_id: "no-coordinate", latitude: null, longitude: null }),
      academy("다른유형", { external_id: "other-type", academy_type: "license_center", latitude: 37.01 }),
      academy("테스트더미", { external_id: "dummy", region: targetRegion, phone: "031-000-0000" }),
    ]);

    const result = selectAcademiesForRegion(db, domain, targetRegion, 7, types, 2);
    expect(result.candidates.map((candidate) => candidate.external_id)).toEqual(["shared", "near"]);
    expect(result.trace.duplicatesRemoved.map((candidate) => candidate.academyId)).toContain("shared");
    expect(result.trace.excludedCandidates.map((candidate) => candidate.academyId)).toContain("dummy");
    expect(result.trace.supplementCandidates[0]?.straightLineDistanceKm).toBeGreaterThan(0);
  });

  it("D: 20km 안 후보가 없고 최종 수가 2 미만이면 50km far guarantee가 가까운 순으로 채운다", () => {
    const domain = setupDomain("far");
    insert(domain, [
      academy("far30", { latitude: 37.27 }),
      academy("far44", { latitude: 37.4 }),
      academy("far60", { latitude: 37.55 }),
    ]);

    const result = selectAcademiesForRegion(db, domain, targetRegion, 7, types, 2);
    expect(result.trace.supplementCandidates).toEqual([]);
    expect(result.trace.farCandidates.map((candidate) => candidate.academyName)).toEqual(["far30", "far44"]);
    expect(result.trace.farCandidates.every((candidate) => (candidate.straightLineDistanceKm || 0) > ACADEMY_NEARBY_MAX_KM && (candidate.straightLineDistanceKm || Infinity) <= ACADEMY_MIN_GUARANTEE_MAX_KM)).toBe(true);
    expect(result.candidates.map((candidate) => candidate.name)).toEqual(["far30", "far44"]);
  });

  it("E: 50km까지도 유효 후보가 부족하면 후보를 만들거나 중복하지 않는다", () => {
    const domain = setupDomain("short");
    insert(domain, [academy("far60", { latitude: 37.55 })]);

    const result = selectAcademiesForRegion(db, domain, targetRegion, 7, types, 2);
    expect(result.candidates).toEqual([]);
    expect(result.trace.mergedCandidatePool).toEqual([]);
    expect(result.trace.farCandidates).toEqual([]);
    expect(factText(domain)).toContain("소개 가능한 후보 수: 0곳");
  });

  it("G: facts는 현재도 결측 필드를 만들지 않는 평면 문자열이며 정보 불균형이 유지된다", () => {
    const domain = setupDomain("missing");
    insert(domain, [
      academy("정보A", { region: targetRegion, address: `${targetRegion} A로`, price: "500,000원", shuttle: null, hours: null }),
      academy("정보B", { region: targetRegion, address: `${targetRegion} B로`, price: null, shuttle: "역 셔틀", hours: null }),
    ]);

    const facts = factText(domain);
    expect(facts).toContain("[1] 정보A");
    expect(facts).toContain("수강료: 500,000원");
    expect(facts).toContain("[2] 정보B");
    expect(facts).toContain("셔틀: 역 셔틀");
    expect(facts).not.toContain("운영시간:");
  });

  it("후보 출처·외부 ID·stored region은 선택 trace에는 있으나 기존 facts 문자열에는 보존되지 않는다", () => {
    const domain = setupDomain("facts-loss");
    insert(domain, [
      academy("직접", { region: targetRegion, address: `${targetRegion} 직접로`, external_id: "direct-id" }),
      academy("보충", { region: "보관전용지역", address: `${targetRegion} 보충로`, external_id: "supplement-id", latitude: null, longitude: null }),
    ]);

    const selected = selectAcademiesForRegion(db, domain, targetRegion, 7, types, 2);
    const facts = factText(domain);
    expect(selected.trace.supplementCandidates[0]).toMatchObject({ academyId: "supplement-id", storedRegion: "보관전용지역", retrievalSource: "supplement" });
    expect(facts).toContain("[2] 보충");
    expect(facts).not.toContain("supplement-id");
    expect(facts).not.toContain("보관전용지역");
    expect(facts).not.toContain("retrievalSource");
  });

  it("T01 v2 adapter는 legacy와 같은 picker 결과와 slot seed 표본 순서를 사용한다", () => {
    const domain = setupDomain("v2-parity");
    insert(domain, Array.from({ length: 7 }, (_, index) => academy(`후보${index + 1}`, { region: targetRegion, address: `${targetRegion} ${index + 1}로` })));
    const slot = { slot_id: "T01_v2_parity", region: targetRegion, primary_keyword: `${targetRegion} 운전면허학원`, modifier_1: "상담전확인", modifier_2: null };
    const selection = selectAcademiesForRegion(db, domain, targetRegion, 7, types, 2);
    const expected = seededCandidateSample(selection.candidates, 5, slot.slot_id).map((candidate) => candidate.external_id);
    const worker = new WorkerService(db, {} as never) as Worker;
    const context = (worker as any).buildT01DataGatedContext(domain, slot, types, getArchetype("local"));
    expect(context.candidates.map((candidate: any) => candidate.academyId)).toEqual(expected);
  });
});

describe("Phase A: 기존 T01 structure와 modifier contract", () => {
  it("T01 structure variant는 후보 데이터가 아니라 slot seed로 결정된다", () => {
    const archetype = getArchetype("local");
    expect(structureGuideForArchetype(archetype, "same-slot")).toBe(structureGuideForArchetype(archetype, "same-slot"));
    expect(structureGuideForArchetype(archetype, "same-slot")).not.toBe("");
  });

  it("기존 modifier는 prompt에 문자열 한 줄로 삽입된다", () => {
    const prompt = buildPrompt({ display_name: "테스트" }, {
      template_id: "T01", primary_keyword: `${targetRegion} 운전면허학원`, region: targetRegion,
      modifier_1: "가까운", modifier_2: "셔틀편리",
    }, "facts", "comparison", getArchetype("local"), "direction", true);
    expect(prompt).toContain("수식어: 가까운, 셔틀편리");
  });
});
