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

  /*
    학원의 지역 배정(bestRegionForAddress)과 셔틀 운행 지역(formatShuttleFact)은 둘 다
    upsertDrivingplusAcademies, 즉 「학원자료 연결」 시점에 계산돼 academies 에 박힌다.
    그래서 사전·지역 목록만 새로 받으면 학원 행은 옛 값으로 남는데, 화면에 표시가 없으면
    운영자는 반영된 줄 안다. 그 경고를 띄우는 판정이라 여기서 잠근다.
  */
  const seedAcademy = (domain: string, syncedAt: string) => {
    db.run("DELETE FROM academies WHERE domain=?", [domain]);
    db.run("INSERT INTO academies (id, domain, region, name, synced_at) VALUES (?, ?, ?, ?, ?)",
      [`a-${domain}`, domain, "경기도 남양주시", "테스트학원", syncedAt]);
  };

  it("학원을 아직 연결하지 않았으면 어긋남이 아니다", () => {
    db.createDomain({ domain: "f0", display_name: "f0", vertical: "driving" });
    const fresh = db.sourceFreshness("f0");
    expect(fresh.academies_synced_at).toBeNull();
    expect(fresh.region_directory_ahead).toBe(false);
    expect(fresh.seo_regions_ahead).toBe(false);
  });

  it("원천 표를 학원 행보다 나중에 받았으면 어긋남으로 본다", () => {
    db.createDomain({ domain: "f1", display_name: "f1", vertical: "driving" });
    db.upsertSeoRegions("f1", [{ level: 2, region: "경기도 남양주시", latitude: 37.63, longitude: 127.21 }]);
    seedAcademy("f1", "2000-01-01 00:00:00");
    const fresh = db.sourceFreshness("f1");
    expect(fresh.seo_regions_ahead).toBe(true);
    expect(fresh.region_directory_ahead).toBe(true);
  });

  it("연결이 더 나중이면 어긋남이 아니다", () => {
    db.createDomain({ domain: "f2", display_name: "f2", vertical: "driving" });
    db.upsertSeoRegions("f2", [{ level: 2, region: "경기도 남양주시", latitude: 37.63, longitude: 127.21 }]);
    seedAcademy("f2", "2999-01-01 00:00:00");
    const fresh = db.sourceFreshness("f2");
    expect(fresh.seo_regions_ahead).toBe(false);
    expect(fresh.region_directory_ahead).toBe(false);
  });

  it("도메인별로 따로 본다(다른 도메인의 연결 시각에 영향받지 않는다)", () => {
    const stale = db.sourceFreshness("f1");
    const fresh = db.sourceFreshness("f2");
    expect(stale.seo_regions_ahead).toBe(true);
    expect(fresh.seo_regions_ahead).toBe(false);
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
