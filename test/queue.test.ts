import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.ts";
import { Database } from "../src/db/database.ts";
import { LlmClient, LlmUnavailableError } from "../src/llm/client.ts";
import { Pacer } from "../src/queue/pacer.ts";
import { JobQueue } from "../src/queue/queue.ts";
import { Worker } from "../src/queue/worker.ts";

const T0 = new Date(2026, 8, 28, 10, 0, 0);
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

function setup(pacing: object = {}) {
  const db = new Database(":memory:");
  const queue = new JobQueue(db);
  const config = parseConfig({ pacing });
  const pacer = new Pacer(db, queue, config.pacing, "generate", () => 0.5);
  const llm = new LlmClient(db, config.llm, async () => ({ kind: "error", message: "unused" }));
  return { db, queue, pacer, llm };
}

describe("JobQueue", () => {
  it("실행 시각이 된 작업만 순서대로 가져온다", () => {
    const { queue } = setup();
    const later = queue.enqueue("a", {}, { runAfter: at(10), now: T0 });
    const first = queue.enqueue("a", { n: 1 }, { now: T0 });
    expect(queue.claimNext(T0)?.id).toBe(first);
    expect(queue.claimNext(T0)).toBeUndefined();
    expect(queue.claimNext(at(10))?.id).toBe(later);
  });

  it("실패하면 백오프 후 재시도하고, 횟수를 다 쓰면 failed", () => {
    const { queue } = setup();
    const id = queue.enqueue("a", {}, { maxAttempts: 2, now: T0 });
    queue.claimNext(T0);
    expect(queue.fail(id, "x", T0)).toBe("queued");
    expect(queue.get(id)?.runAfter).toBe(at(1).toISOString());
    queue.claimNext(at(1));
    expect(queue.fail(id, "y", at(1))).toBe("failed");
  });

  it("defer는 시도 횟수를 쓰지 않는다", () => {
    const { queue } = setup();
    const id = queue.enqueue("a", {}, { now: T0 });
    queue.claimNext(T0);
    queue.defer(id, at(30), "한도");
    expect(queue.get(id)).toMatchObject({ status: "queued", attempts: 0, waitReason: "한도" });
  });

  it("재시작 시 running 작업을 복구한다", () => {
    const { queue } = setup();
    queue.enqueue("a", {}, { now: T0 });
    queue.claimNext(T0);
    expect(queue.recoverRunning()).toBe(1);
    expect(queue.counts().queued).toBe(1);
  });
});

describe("Pacer", () => {
  it("생성 뒤 min~max 사이 간격을 둔다", () => {
    const { pacer } = setup({ minIntervalSec: 60, maxIntervalSec: 180 });
    expect(pacer.blockedUntil(T0)).toBeUndefined();
    expect(pacer.recordRun(T0)).toEqual(at(2)); // random 0.5 → 120초
    expect(pacer.blockedUntil(at(1))?.reason).toBe("생성 간격 대기");
    expect(pacer.blockedUntil(at(2))).toBeUndefined();
  });

  it("하루 한도에 닿으면 다음 날 자정까지 막는다", () => {
    const { queue, pacer } = setup({ dailyLimit: 1, minIntervalSec: 0, maxIntervalSec: 0 });
    const id = queue.enqueue("generate", {}, { now: T0 });
    queue.claimNext(T0);
    queue.complete(id, {}, T0);
    expect(pacer.blockedUntil(at(1))?.until).toEqual(new Date(2026, 8, 29, 0, 0, 0));
  });
});

describe("Worker", () => {
  it("LLM 작업은 생성 간격 동안 가져오지 않고, 다른 작업은 처리한다", async () => {
    const { queue, pacer, llm } = setup({ minIntervalSec: 600, maxIntervalSec: 600 });
    const done: string[] = [];
    const worker = new Worker({
      queue,
      pacer,
      llm,
      pollMs: 1000,
      log: () => {},
      handlers: {
        generate: { usesLlm: true, run: async () => done.push("generate") },
        sync: { usesLlm: false, run: async () => done.push("sync") },
      },
    });
    pacer.recordRun(new Date());
    queue.enqueue("generate");
    queue.enqueue("sync");
    expect(await worker.tick()).toBe(true);
    expect(await worker.tick()).toBe(false);
    expect(done).toEqual(["sync"]);
  });

  it("LLM 한도 오류는 실패가 아니라 보류로 처리한다", async () => {
    const { queue, pacer, llm } = setup();
    const until = new Date(Date.now() + 3_600_000);
    const worker = new Worker({
      queue,
      pacer,
      llm,
      pollMs: 1000,
      log: () => {},
      handlers: {
        generate: {
          usesLlm: true,
          run: async () => {
            throw new LlmUnavailableError(until, "codex: 한도");
          },
        },
      },
    });
    const id = queue.enqueue("generate");
    await worker.tick();
    expect(queue.get(id)).toMatchObject({
      status: "queued",
      attempts: 0,
      runAfter: until.toISOString(),
      waitReason: "LLM 사용량 한도 대기",
    });
  });
});
