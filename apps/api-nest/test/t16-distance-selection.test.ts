import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACADEMY_NEARBY_MAX_KM, ACADEMY_MIN_GUARANTEE_MAX_KM } from "../src/constants.js";
import { selectAcademiesByDistance } from "../src/academy-candidate-selection.js";

/**
 * T16 거리 선택 회귀 가드.
 *
 * 2026-07-22 초기 구현에 두 결함이 있었다(실측 영월군: 2.5km 학원을 빼고 24~45km 5곳을 씀):
 *  (1) buildFacts 가 거리순 풀을 seededCandidateSample 로 무작위 축소해 최근접이 탈락했다.
 *  (2) 보장 반경 확장이 20km 결과를 버리고 50km 로 새로 채웠다(T01 은 부족분만 채운다).
 *
 * 이 테스트는 selectAcademiesByDistance 가 (a) 거리순이고 (b) 20km 결과를 유지한 채
 * 부족분만 50km 에서 채우는지 잠근다. buildFacts 의 거리순 상위 N 결정성은
 * t16-axis-comparison.test / probe-t16-sampling 이 함께 지킨다.
 */

type Db = import("../src/db.service.js").DbService;
let db: Db;
let scratch = "";
const types = ["exam_academy", "academy"];
// 목표 지역 좌표를 기준으로 동/서로 벌려 거리를 통제한다. 위도 1도 ≈ 111km.
const TARGET_LAT = 37;
const TARGET_LNG = 127;

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), "t16-distance-"));
  process.env.SEO_DB_PATH = join(scratch, "admin.db");
  const { DbService } = await import("../src/db.service.js");
  db = new DbService();
  db.init();
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// km 만큼 동쪽으로 떨어진 경도. cos(37°) ≈ 0.7986.
function lngAtKm(km: number): number {
  return TARGET_LNG + km / (111 * 0.7986);
}

function academyAtKm(name: string, km: number, region = "먼시"): Record<string, unknown> {
  return {
    external_id: `id-${name}`, name, region, address: `${region} 테스트로 1`,
    latitude: TARGET_LAT, longitude: lngAtKm(km), academy_type: "academy", phone: "031-000-0000",
  };
}

function setup(name: string, rows: Array<Record<string, unknown>>): string {
  const domain = `t16-${name}.test`;
  db.createDomain({ domain, display_name: name, vertical: "driving" });
  db.run("INSERT INTO seo_regions (domain, level, region, latitude, longitude, source_name) VALUES (?, ?, ?, ?, ?, ?)",
    [domain, 2, "목표시", TARGET_LAT, TARGET_LNG, "fixture"]);
  db.upsertAcademies(domain, rows);
  return domain;
}

const names = (r: { candidates: Array<Record<string, unknown>> }) => r.candidates.map((c) => String(c.name));

describe("T16 거리 단일 선택", () => {
  it("거리순으로 정렬한다 — 지역 문자열 매칭을 거리보다 우선하지 않는다", () => {
    const domain = setup("order", [
      academyAtKm("가10km", 10), academyAtKm("나3km", 3), academyAtKm("다7km", 7),
    ]);
    expect(names(selectAcademiesByDistance(db, domain, "목표시", 7, types, 2))).toEqual(["나3km", "다7km", "가10km"]);
  });

  it("20km 밖 학원은 최소 개수를 채운 뒤에는 넣지 않는다", () => {
    const domain = setup("within", [
      academyAtKm("가2km", 2), academyAtKm("나5km", 5), academyAtKm("다8km", 8),
      academyAtKm("먼30km", 30), academyAtKm("먼40km", 40),
    ]);
    const picked = names(selectAcademiesByDistance(db, domain, "목표시", 7, types, 2));
    expect(picked).toContain("가2km");
    expect(picked).not.toContain("먼30km");
    expect(picked).not.toContain("먼40km");
  });

  it("20km 안이 최소 개수 미만이면 그 결과를 유지한 채 부족분만 50km 에서 채운다", () => {
    // 결함(2) 재현 지역: 20km 안 1곳뿐. 그 1곳을 버리면 안 된다.
    const domain = setup("guarantee", [
      academyAtKm("가까운2km", 2), academyAtKm("먼25km", 25), academyAtKm("먼35km", 35),
    ]);
    const picked = names(selectAcademiesByDistance(db, domain, "목표시", 7, types, 2));
    expect(picked[0]).toBe("가까운2km");          // 최근접이 살아 있다
    expect(picked).toContain("먼25km");            // 부족분 1곳만
    expect(picked).not.toContain("먼35km");        // 최소 개수를 넘겨 채우지 않는다
    expect(picked.length).toBe(2);
  });

  it("50km 밖은 보장 반경에서도 넣지 않는다(전국 아무거나 방지)", () => {
    const domain = setup("far", [academyAtKm("가까운2km", 2), academyAtKm("초원거리60km", 60)]);
    const picked = names(selectAcademiesByDistance(db, domain, "목표시", 7, types, 2));
    expect(picked).toEqual(["가까운2km"]);
  });

  it("반경 상수는 T01 과 같은 값을 쓴다", () => {
    expect(ACADEMY_NEARBY_MAX_KM).toBe(20);
    expect(ACADEMY_MIN_GUARANTEE_MAX_KM).toBe(50);
  });
});
