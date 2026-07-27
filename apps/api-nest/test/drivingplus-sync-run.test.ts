import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 학원 동기화를 백그라운드 run 으로 돌리는 동작을 잠그는 테스트.
 *
 * 왜 백그라운드인가: 블로그리뷰를 포함하면 380곳에 12분 넘게 걸리는데 Node fetch 는 헤더를
 * 300초 안에 못 받으면 UND_ERR_HEADERS_TIMEOUT 으로 끊는다(실측 301초). 응답을 기다리는
 * 구조로는 관리자 UI 에서 완주가 불가능하다.
 *
 * 특히 취소 경로가 중요하다. 절반만 받은 목록으로 upsert 하면 아직 조회하지 않은 학원의
 * 후기가 "0건"으로 판단돼 지워진다. 그래서 취소는 저장을 아예 건너뛰어야 한다.
 */

const domain = "sync-run.test";

describe("DrivingplusSyncService 백그라운드 실행", () => {
  let tmp: string;
  let db: import("../src/db.service.js").DbService;
  let service: import("../src/drivingplus-sync.service.js").DrivingplusSyncService;
  const originalFetch = globalThis.fetch;

  const academies = Array.from({ length: 6 }, (_, i) => ({
    id: i + 1, title: `학원${i + 1}`, roadAddress: `서울특별시 강남구 테헤란로 ${i + 1}`,
  }));

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), "sync-run-"));
    process.env.SEO_DB_PATH = join(tmp, "test.db");
    process.env.DRIVINGPLUS_BLOG_REVIEW_RETRY_DELAY_MS = "0";
    process.env.DRIVINGPLUS_BLOG_REVIEW_ATTEMPTS = "1";
    const { DbService } = await import("../src/db.service.js");
    const { DrivingplusApiService } = await import("../src/drivingplus-api.service.js");
    const { DrivingplusSyncService } = await import("../src/drivingplus-sync.service.js");
    const { RegionDirectoryService } = await import("../src/region-directory.service.js");
    db = new DbService();
    db.init();
    db.createDomain({ domain, display_name: "sync run", vertical: "driving" });
    const api = new DrivingplusApiService();
    // 지역 사전은 이 테스트의 관심사가 아니다. 실패해도 동기화가 계속되는 경로를 그대로 쓴다.
    service = new DrivingplusSyncService(db, api, new RegionDirectoryService(db, api));
  });

  afterEach(() => { globalThis.fetch = originalFetch; });

  afterAll(() => {
    delete process.env.DRIVINGPLUS_BLOG_REVIEW_RETRY_DELAY_MS;
    delete process.env.DRIVINGPLUS_BLOG_REVIEW_ATTEMPTS;
    rmSync(tmp, { recursive: true, force: true });
  });

  function mockSource(opts: { blogDelayMs?: number } = {}) {
    globalThis.fetch = (async (input: any) => {
      const url = String(input);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      if (url.includes("get-all-academy")) return json({ code: 200, data: academies });
      if (url.includes("/blog-review/list/")) {
        if (opts.blogDelayMs) await new Promise((r) => setTimeout(r, opts.blogDelayMs));
        return json({ code: 200, data: { totalCount: 9, reviews: [{ title: "다녀온 후기", content: "코스가 넓어 연습하기 좋았습니다.", link: `https://blog.example.test/${url.slice(-1)}`, postdate: "20260102", images: [] }] } });
      }
      if (url.includes("/review/list/")) return json({ code: 200, data: { totalCount: 3, point: 4.5, reviews: [{ id: 1, point: 5, author: "익명", date: "2026-01-02", content: "강사님이 친절했습니다.", images: [] }] } });
      return json({ code: 200, data: [] });
    }) as typeof fetch;
  }

  async function waitForRun(runId: string, timeoutMs = 10_000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const run = db.getSyncRun(runId)!;
      if (run.status !== "running") return run;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("동기화가 제한시간 안에 끝나지 않았습니다.");
  }

  it("시작 즉시 run_id 를 돌려주고 결과는 기다리지 않는다", async () => {
    mockSource();
    const started = service.startAcademySync(domain, { includeReviews: true, includeBlogReviews: true });
    expect(started.ok).toBe(true);
    const runId = started.ok ? started.run_id : "";
    // 아직 끝나지 않았는데도 호출은 이미 반환됐다 — 이것이 백그라운드 실행의 요점이다.
    expect(db.getSyncRun(runId)?.status).toBe("running");

    const run = await waitForRun(runId);
    expect(run.status).toBe("done");
    expect(JSON.parse(String(run.result)).upserted).toBe(academies.length);
    expect(db.listAcademies(domain).length).toBe(academies.length);
  });

  it("이미 도는 동기화가 있으면 새로 시작하지 않는다", async () => {
    mockSource({ blogDelayMs: 30 });
    const first = service.startAcademySync(domain, { includeReviews: false, includeBlogReviews: true });
    expect(first.ok).toBe(true);
    const second = service.startAcademySync(domain, { includeReviews: false, includeBlogReviews: true });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toContain("이미 진행 중인 동기화");
    if (first.ok) await waitForRun(first.run_id);
  });

  it("취소하면 저장을 건너뛰어 기존 자료가 그대로 남는다", async () => {
    const before = db.listAcademies(domain).length;
    expect(before).toBeGreaterThan(0);
    // 원천이 학원 목록을 "새 학원 1곳"으로 바꿔 응답하게 한다. 저장까지 갔다면 목록이 갈아엎어진다.
    globalThis.fetch = (async (input: any) => {
      const url = String(input);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      if (url.includes("get-all-academy")) return json({ code: 200, data: [{ id: 999, title: "새학원", roadAddress: "서울특별시 강남구 테헤란로 999" }] });
      await new Promise((r) => setTimeout(r, 50));
      return json({ code: 200, data: { totalCount: 0, reviews: [] } });
    }) as typeof fetch;

    const started = service.startAcademySync(domain, { includeReviews: false, includeBlogReviews: true });
    expect(started.ok).toBe(true);
    const runId = started.ok ? started.run_id : "";
    expect(db.requestSyncCancel(runId)).toBe(true);

    const run = await waitForRun(runId);
    expect(run.status).toBe("cancelled");
    // 저장 단계에 도달하지 않았으므로 새 학원이 들어오지도, 기존 학원이 사라지지도 않았다.
    expect(db.listAcademies(domain).length).toBe(before);
  });

  it("재시작으로 남은 유령 run 을 init 이 정리한다", async () => {
    const ghostId = db.createSyncRun(domain, "academies");
    expect(db.findRunningSyncRun()).toBeTruthy();
    const { DbService } = await import("../src/db.service.js");
    const reopened = new DbService();
    reopened.init();
    // 유령이 남아 있으면 동기화 버튼이 영원히 잠긴다.
    expect(reopened.getSyncRun(ghostId)?.status).toBe("error");
    expect(reopened.findRunningSyncRun()).toBeUndefined();
  });
});
