import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "job-heartbeat-"));
process.env.SEO_DB_PATH = join(dir, "admin.db");

const { DbService } = await import("../src/db.service.js");

// 진행 보고(updateJobProgress)는 슬롯 경계에서만 불린다. 그 사이 LLM 호출이 몇 분씩
// 걸리는데 heartbeat 가 멈춰 있으면, 워커가 멀쩡히 일하는 중에도 recoverStaleRunningJobs 가
// 잡을 실패로 정리한다(실측 3건 — 한 건은 글이 정상 발행됐는데도 잡만 실패로 남았다).
let db: any;
const shiftHeartbeat = (jobId: string, secondsAgo: number) => {
  const at = new Date(Date.now() - secondsAgo * 1000).toISOString().replace("T", " ").slice(0, 19);
  db.run("UPDATE jobs SET heartbeat_at=?, started_at=? WHERE id=?", [at, at, jobId]);
};

beforeAll(() => {
  db = new DbService();
  db.init();
  db.createDomain({ domain: "hb", display_name: "hb", vertical: "driving" });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("잡 heartbeat 와 stale 판정", () => {
  it("맥이 끊긴 잡만 실패로 정리한다", () => {
    const jobId = db.enqueueJob("hb", "generate", { slot_ids: ["a"], timeout_sec: 600 });
    db.claimNextJob();
    // 제한시간 600 + 여유 300 = 900초. 그보다 오래 조용하면 죽은 것으로 본다.
    shiftHeartbeat(jobId, 1000);
    expect(db.recoverStaleRunningJobs(300)).toBe(1);
    expect(db.get("SELECT status, error FROM jobs WHERE id=?", [jobId]).status).toBe("failed");
  });

  it("맥을 짚어 두면 오래 걸리는 잡이 살아남는다", () => {
    const jobId = db.enqueueJob("hb", "generate", { slot_ids: ["b"], timeout_sec: 600 });
    db.claimNextJob();
    shiftHeartbeat(jobId, 1000);
    // 워커가 LLM 을 기다리는 동안 주기적으로 부르는 것이 이 한 줄이다.
    db.touchJobHeartbeat(jobId);
    expect(db.recoverStaleRunningJobs(300)).toBe(0);
    expect(db.get("SELECT status FROM jobs WHERE id=?", [jobId]).status).toBe("running");
  });

  it("맥은 진행 단계를 덮어쓰지 않는다 — 화면에 '작업자 시작'으로 되돌아가면 안 된다", () => {
    const jobId = db.enqueueJob("hb", "generate", { slot_ids: ["c"], timeout_sec: 600 });
    db.claimNextJob();
    db.updateJobProgress(jobId, { step: "1/3 본문 생성 중", slotId: "c", processed: 0, failed: 0 });
    db.touchJobHeartbeat(jobId);
    const row = db.get("SELECT current_step, current_slot_id FROM jobs WHERE id=?", [jobId]);
    expect(row.current_step).toBe("1/3 본문 생성 중");
    expect(row.current_slot_id).toBe("c");
  });

  it("끝난 잡의 맥은 짚지 않는다 — 완료 시각이 뒤로 밀리면 안 된다", () => {
    const jobId = db.enqueueJob("hb", "generate", { slot_ids: ["d"], timeout_sec: 600 });
    db.claimNextJob();
    db.completeJob(jobId, true, { ok: 1 });
    const before = db.get("SELECT heartbeat_at FROM jobs WHERE id=?", [jobId]).heartbeat_at;
    db.touchJobHeartbeat(jobId);
    expect(db.get("SELECT heartbeat_at FROM jobs WHERE id=?", [jobId]).heartbeat_at).toBe(before);
  });
});
