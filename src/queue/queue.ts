import type { Database } from "../db/database.ts";

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface Job {
  id: number;
  kind: string;
  status: JobStatus;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  waitReason: string;
  error: string | null;
}

interface JobRow {
  id: number;
  kind: string;
  status: JobStatus;
  payload: string;
  attempts: number;
  max_attempts: number;
  run_after: string;
  wait_reason: string;
  error: string | null;
}

const toJob = (r: JobRow): Job => ({
  id: r.id,
  kind: r.kind,
  status: r.status,
  payload: JSON.parse(r.payload),
  attempts: r.attempts,
  maxAttempts: r.max_attempts,
  runAfter: r.run_after,
  waitReason: r.wait_reason,
  error: r.error,
});

/** SQLite jobs 테이블 기반 작업 큐. 워커 하나가 한 번에 한 작업씩 처리한다. */
export class JobQueue {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  enqueue(
    kind: string,
    payload: unknown = {},
    opts: { runAfter?: Date; maxAttempts?: number; now?: Date } = {},
  ): number {
    const now = opts.now ?? new Date();
    return this.db.run(
      "INSERT INTO jobs (kind, payload, max_attempts, run_after, created_at) VALUES (?, ?, ?, ?, ?)",
      [
        kind,
        JSON.stringify(payload),
        opts.maxAttempts ?? 3,
        (opts.runAfter ?? now).toISOString(),
        now.toISOString(),
      ],
    ).lastInsertRowid;
  }

  get(id: number): Job | undefined {
    const row = this.db.get<JobRow>("SELECT * FROM jobs WHERE id = ?", [id]);
    return row && toJob(row);
  }

  /** 실행 시각이 된 대기 작업 하나를 running으로 가져온다. kinds를 주면 그 종류만. */
  claimNext(now: Date, kinds?: readonly string[]): Job | undefined {
    if (kinds && !kinds.length) return undefined;
    return this.db.transaction(() => {
      const filter = kinds ? `AND kind IN (${kinds.map(() => "?").join(", ")})` : "";
      const row = this.db.get<JobRow>(
        `SELECT * FROM jobs WHERE status = 'queued' AND run_after <= ? ${filter} ORDER BY run_after, id LIMIT 1`,
        [now.toISOString(), ...(kinds ?? [])],
      );
      if (!row) return undefined;
      this.db.run(
        "UPDATE jobs SET status = 'running', attempts = attempts + 1, started_at = ?, wait_reason = '' WHERE id = ?",
        [now.toISOString(), row.id],
      );
      return toJob({ ...row, status: "running", attempts: row.attempts + 1, wait_reason: "" });
    });
  }

  complete(id: number, result: unknown, now: Date = new Date()): void {
    this.db.run(
      "UPDATE jobs SET status = 'done', result = ?, error = NULL, finished_at = ? WHERE id = ?",
      [JSON.stringify(result ?? null), now.toISOString(), id],
    );
  }

  /** 실패 처리. 시도 횟수가 남았으면 지수 백오프 후 다시 대기열로. */
  fail(id: number, error: string, now: Date = new Date()): JobStatus {
    const job = this.get(id);
    if (!job) return "failed";
    if (job.attempts < job.maxAttempts) {
      const delayMs = 60_000 * 2 ** (job.attempts - 1);
      this.db.run(
        "UPDATE jobs SET status = 'queued', error = ?, run_after = ?, wait_reason = ? WHERE id = ?",
        [error, new Date(now.getTime() + delayMs).toISOString(), "오류 후 재시도 대기", id],
      );
      return "queued";
    }
    this.db.run("UPDATE jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?", [
      error,
      now.toISOString(),
      id,
    ]);
    return "failed";
  }

  /** 작업 탓이 아닌 이유(LLM 한도 등)로 미룬다. 시도 횟수는 차감하지 않는다. */
  defer(id: number, until: Date, reason: string): void {
    this.db.run(
      "UPDATE jobs SET status = 'queued', attempts = MAX(attempts - 1, 0), run_after = ?, wait_reason = ? WHERE id = ?",
      [until.toISOString(), reason, id],
    );
  }

  cancel(id: number, now: Date = new Date()): boolean {
    return (
      this.db.run(
        "UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE id = ? AND status = 'queued'",
        [now.toISOString(), id],
      ).changes > 0
    );
  }

  /** 앱이 비정상 종료돼 running으로 남은 작업을 다시 대기열에 넣는다. */
  recoverRunning(): number {
    return this.db.run(
      "UPDATE jobs SET status = 'queued', attempts = MAX(attempts - 1, 0), wait_reason = '재시작 후 복구' WHERE status = 'running'",
    ).changes;
  }

  countDone(kind: string, since: Date): number {
    return (
      this.db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM jobs WHERE kind = ? AND status = 'done' AND finished_at >= ?",
        [kind, since.toISOString()],
      )?.n ?? 0
    );
  }

  counts(): Record<JobStatus, number> {
    const counts: Record<JobStatus, number> = {
      queued: 0,
      running: 0,
      done: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const r of this.db.all<{ status: JobStatus; n: number }>(
      "SELECT status, COUNT(*) AS n FROM jobs GROUP BY status",
    )) {
      counts[r.status] = r.n;
    }
    return counts;
  }
}
