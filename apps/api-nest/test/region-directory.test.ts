import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// region_directory 는 seo_regions 와 의도적으로 분리한 전역 참조 표다.
// seo_regions 소비처 두 곳이 "level 2 만 있다"고 암묵적으로 가정하므로(bestRegionForAddress 는
// 가장 긴 매칭, buildRegionCoords 는 높은 level 우선), 읍·면·동이 그쪽에 섞이면 학원 지역 배정과
// 슬롯 좌표가 조용히 뒤집힌다. 이 테스트는 그 분리와 파싱 계약을 잠근다.

let db: import("../src/db.service.js").DbService;
let tmp: string;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "region-dir-"));
  process.env.SEO_DB_PATH = join(tmp, "test.db");
  const { DbService } = await import("../src/db.service.js");
  db = new DbService();
  db.init();
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const rows = [
  { level: 2, region: "경기도 남양주시", latitude: 37.63, longitude: 127.21 },
  { level: 3, region: "경기도 남양주시 화도읍", latitude: 37.65, longitude: 127.31 },
  { level: 2, region: "경기도 고양시 덕양구", latitude: 37.63, longitude: 126.83 },
];

describe("region_directory 적재", () => {
  it("전체 경로를 시도·시군구·읍면동으로 분해해 저장한다", () => {
    db.upsertRegionDirectory(rows);
    const all = db.listRegionDirectory();
    const emd = all.find((r) => r.region === "경기도 남양주시 화도읍");
    expect(emd).toMatchObject({ level: 3, sido: "경기도", sigungu: "남양주시", submunicipal: "화도읍" });
    const sgg = all.find((r) => r.region === "경기도 남양주시");
    expect(sgg).toMatchObject({ level: 2, sido: "경기도", sigungu: "남양주시", submunicipal: null });
    // 일반구(고양시 덕양구)는 level 2 이면서 세 토큰이다.
    expect(all.find((r) => r.region === "경기도 고양시 덕양구")).toMatchObject({ sigungu: "고양시", submunicipal: "덕양구" });
  });

  it("시·도만 있는 행은 매칭 토큰이 없어 건너뛴다", () => {
    const result = db.upsertRegionDirectory([{ level: 1, region: "경기도", latitude: 37.4, longitude: 127.5 }]);
    expect(result.skipped).toBe(1);
    expect(result.upserted).toBe(0);
  });

  it("같은 지역을 다시 받아도 중복되지 않는다(좌표는 갱신)", () => {
    const before = db.listRegionDirectory().length;
    db.upsertRegionDirectory([{ level: 3, region: "경기도 남양주시 화도읍", latitude: 1, longitude: 2 }]);
    expect(db.listRegionDirectory().length).toBe(before);
    expect(db.listRegionDirectory().find((r) => r.region === "경기도 남양주시 화도읍")?.latitude).toBe(1);
  });

  it("상태 요약이 레벨별 건수와 동기화 시각을 돌려준다", () => {
    const status = db.regionDirectoryStatus();
    expect(status.total).toBe(3);
    expect(status.by_level).toEqual({ "2": 2, "3": 1 });
    expect(status.synced_at).toBeTruthy();
  });

  it("seo_regions 를 오염시키지 않는다(분리 보장)", () => {
    db.createDomain({ domain: "t", display_name: "t", vertical: "driving" });
    db.upsertSeoRegions("t", [{ level: 2, region: "경기도 남양주시", latitude: 37.63, longitude: 127.21 }]);
    db.upsertRegionDirectory(rows);
    const seo = db.listSeoRegions("t");
    expect(seo).toHaveLength(1);
    expect(seo.every((r) => Number(r.level) === 2)).toBe(true);
  });
});
