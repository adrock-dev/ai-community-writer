import type { AppConfig } from "../config.ts";
import type { Database } from "../db/database.ts";
import type { JobQueue } from "./queue.ts";

const NEXT_AT_KEY = "pacer.next_generate_at";

export interface PaceBlock {
  until: Date;
  reason: string;
}

/**
 * 글 생성 속도 조절. LLM 사용량과 별개로
 *   - 생성 사이에 min~max 사이 무작위 간격을 두고
 *   - 하루(로컬 자정 기준) 생성 편수를 제한한다.
 */
export class Pacer {
  private readonly db: Database;
  private readonly queue: JobQueue;
  private readonly pacing: AppConfig["pacing"];
  private readonly kind: string;
  private readonly random: () => number;

  constructor(
    db: Database,
    queue: JobQueue,
    pacing: AppConfig["pacing"],
    kind: string,
    random: () => number = Math.random,
  ) {
    this.db = db;
    this.queue = queue;
    this.pacing = pacing;
    this.kind = kind;
    this.random = random;
  }

  /** 지금 생성할 수 없으면 그 이유와 가능해지는 시각. 가능하면 undefined. */
  blockedUntil(now: Date = new Date()): PaceBlock | undefined {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    if (this.queue.countDone(this.kind, midnight) >= this.pacing.dailyLimit) {
      const tomorrow = new Date(midnight);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return { until: tomorrow, reason: `오늘 생성 한도 ${this.pacing.dailyLimit}편 도달` };
    }
    const next = this.db.getState(NEXT_AT_KEY);
    if (next && new Date(next) > now) return { until: new Date(next), reason: "생성 간격 대기" };
    return undefined;
  }

  /** 생성 1편을 마친 뒤 호출해 다음 생성 가능 시각을 정한다. */
  recordRun(now: Date = new Date()): Date {
    const { minIntervalSec: min, maxIntervalSec: max } = this.pacing;
    const waitSec = min + Math.round(this.random() * (max - min));
    const next = new Date(now.getTime() + waitSec * 1000);
    this.db.setState(NEXT_AT_KEY, next.toISOString());
    return next;
  }
}
