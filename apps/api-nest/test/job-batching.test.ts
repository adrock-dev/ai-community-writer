import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 큰 작성 요청을 여러 잡으로 쪼개는 계약과, 취소를 눌러 둔 잡이 stale 로 정리될 때의 메시지.
//
// 둘 다 2026-07-30 실측에서 나왔다. 1000개 단일 잡이 3분 만에 워커 사망으로 죽어 999개가
// 통째로 버려졌는데, 잡에는 「취소됨」이라고만 남아 있어 워커가 죽은 사실이 취소 뒤에 숨었다.

const REQ = { headers: {} } as any;

let db: any;
let ctl: any;
let tmp: string;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "job-batching-"));
  process.env.SEO_DB_PATH = join(tmp, "admin.db");
  const { DbService } = await import("../src/db.service.js");
  const { AdminController } = await import("../src/admin.controller.js");
  db = new DbService();
  db.init();
  ctl = new AdminController(db, {} as never, {} as never);
  db.run("INSERT INTO domains (domain, display_name, vertical) VALUES ('jb','JB','driving')");
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const slotIds = (n: number) => Array.from({ length: n }, (_, i) => `S${i}`);

describe("작성 잡 쪼개기", () => {
  it("상한 이하 요청은 잡 1건으로 둔다", () => {
    const res = ctl.enqueueGenerate(REQ, {}, "jb", { slot_ids: slotIds(25) }) as any;
    expect(res.job_count).toBe(1);
    expect(res.slot_count).toBe(25);
    expect(res.job_id).toBe(res.job_ids[0]);
  });

  it("상한을 넘으면 여러 잡으로 나누고 슬롯을 하나도 잃지 않는다", () => {
    const res = ctl.enqueueGenerate(REQ, {}, "jb", { slot_ids: slotIds(60) }) as any;
    expect(res.job_count).toBe(3); // 25 + 25 + 10
    expect(res.slot_count).toBe(60);
    const chunks = res.job_ids.map((id: string) => JSON.parse(db.get("SELECT payload FROM jobs WHERE id=?", [id]).payload));
    expect(chunks.map((c: any) => c.slot_ids.length)).toEqual([25, 25, 10]);
    // 쪼갠 뒤에도 원래 순서 그대로 전부 들어 있어야 한다.
    expect(chunks.flatMap((c: any) => c.slot_ids)).toEqual(slotIds(60));
  });

  it("쿨다운은 잡 경계에서 사라지지 않는다 — 마지막 조각만 끝 쿨다운이 없다", () => {
    const res = ctl.enqueueGenerate(REQ, {}, "jb", { slot_ids: slotIds(60) }) as any;
    const flags = res.job_ids.map(
      (id: string) => JSON.parse(db.get("SELECT payload FROM jobs WHERE id=?", [id]).payload).cooldown_after_last ?? false,
    );
    expect(flags).toEqual([true, true, false]);
  });

  it("쪼갠 잡은 전부 queued 다 — 하나가 죽어도 나머지가 큐에 남는 것이 쪼개는 이유다", () => {
    const res = ctl.enqueueGenerate(REQ, {}, "jb", { slot_ids: slotIds(60) }) as any;
    for (const id of res.job_ids) expect(db.get("SELECT status FROM jobs WHERE id=?", [id]).status).toBe("queued");
  });
});

// 쿨다운을 둘지 판정하는 세 갈래. 호출부는 LLM 을 부르는 루프 한복판이라 통째로는 못 떼어내고,
// 판정만 shouldCooldownAfterSlot 으로 빼서 검증한다.
//
// (첫 시도는 존재하지 않는 slot_id 로 processGenerate 를 돌려 검증하려 했으나 **아무것도 잡지
//  못했다** — 슬롯이 없으면 continue 로 빠져 쿨다운 블록에 도달조차 하지 않는다. 조건을 되돌려도
//  그대로 통과하는 것을 보고 알았다.)
describe("쿨다운을 둘지", () => {
  const decide = async (opts: { index: number; total: number; cooldownAfterLast?: unknown; cancelRequested: boolean }) => {
    const { shouldCooldownAfterSlot } = await import("../src/worker.service.js");
    return shouldCooldownAfterSlot(opts);
  };

  it("중간 슬롯 뒤에는 둔다 — 다음 글과의 간격이 필요하다", async () => {
    expect(await decide({ index: 0, total: 3, cancelRequested: false })).toBe(true);
  });

  it("마지막 슬롯 뒤에는 두지 않는다 — 다음 글이 없다", async () => {
    expect(await decide({ index: 2, total: 3, cancelRequested: false })).toBe(false);
  });

  it("쪼개진 조각이면 마지막 슬롯 뒤에도 둔다 — 다음 잡이 이어진다", async () => {
    expect(await decide({ index: 2, total: 3, cooldownAfterLast: true, cancelRequested: false })).toBe(true);
  });

  it("취소가 들어왔으면 어느 경우에도 두지 않는다", async () => {
    expect(await decide({ index: 0, total: 3, cancelRequested: true })).toBe(false);
    expect(await decide({ index: 2, total: 3, cooldownAfterLast: true, cancelRequested: true })).toBe(false);
  });
});

describe("취소 요청된 잡의 stale 정리 메시지", () => {
  // 위 describe 가 남긴 queued 잡이 있으면 claimNextJob 이 그쪽을 집어간다(오래된 순).
  beforeEach(() => db.run("DELETE FROM jobs"));

  const shiftHeartbeat = (jobId: string, secondsAgo: number) => {
    const at = new Date(Date.now() - secondsAgo * 1000).toISOString().replace("T", " ").slice(0, 19);
    db.run("UPDATE jobs SET heartbeat_at=?, started_at=? WHERE id=?", [at, at, jobId]);
  };

  // 취소가 여기까지 왔다는 건 협조적 취소가 반영되지 못했다는 뜻이다(워커가 살아 있었으면
  // 슬롯 경계에서 스스로 멈췄다). 그러니 "취소됨"이 아니라 "응답 없음"이 앞에 와야 한다.
  it("취소를 눌러 둔 잡도 워커 사망이 먼저 드러나야 한다", () => {
    const jobId = db.enqueueJob("jb", "generate", { slot_ids: ["x"], timeout_sec: 600 });
    db.claimNextJob();
    db.cancelJob(jobId);
    shiftHeartbeat(jobId, 1000);
    expect(db.recoverStaleRunningJobs(300)).toBe(1);
    const row = db.get("SELECT status, error, current_step FROM jobs WHERE id=?", [jobId]);
    expect(row.status).toBe("failed");
    expect(row.error.startsWith("작업자 응답 없음")).toBe(true);
    expect(row.error).toContain("취소 요청");
    expect(row.current_step).toContain("응답 없음 복구 처리");
  });

  it("취소가 없었으면 취소를 언급하지 않는다", () => {
    const jobId = db.enqueueJob("jb", "generate", { slot_ids: ["y"], timeout_sec: 600 });
    db.claimNextJob();
    shiftHeartbeat(jobId, 1000);
    expect(db.recoverStaleRunningJobs(300)).toBe(1);
    const row = db.get("SELECT error FROM jobs WHERE id=?", [jobId]);
    expect(row.error).toContain("작업자 응답 없음");
    expect(row.error).not.toContain("취소");
  });
});
