import { type LlmClient, LlmUnavailableError } from "../llm/client.ts";
import type { Pacer } from "./pacer.ts";
import type { Job, JobQueue } from "./queue.ts";

export type JobHandler = (job: Job) => Promise<unknown>;

export interface HandlerDef {
  run: JobHandler;
  /** LLM을 쓰는 작업. 생성 간격·일일 한도·LLM 한도가 걸리면 가져오지 않는다. */
  usesLlm: boolean;
}

export interface WorkerDeps {
  queue: JobQueue;
  pacer: Pacer;
  llm: LlmClient;
  handlers: Record<string, HandlerDef>;
  pollMs: number;
  log?: (message: string) => void;
}

/** 단일 폴링 루프. 한 번에 한 작업만 처리한다. */
export class Worker {
  private readonly deps: WorkerDeps;
  private timer: NodeJS.Timeout | undefined;
  private busy = false;
  private stopped = true;

  constructor(deps: WorkerDeps) {
    this.deps = deps;
  }

  start(): void {
    const recovered = this.deps.queue.recoverRunning();
    if (recovered) this.log(`중단됐던 작업 ${recovered}건을 대기열로 되돌림`);
    this.stopped = false;
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** 처리할 수 있는 작업 하나를 실행한다. 실행했으면 true. */
  async tick(now: Date = new Date()): Promise<boolean> {
    const { queue, pacer, llm, handlers } = this.deps;
    const llmBlocked = pacer.blockedUntil(now) ?? llm.nextAvailableAt(now);
    const kinds = Object.entries(handlers)
      .filter(([, h]) => !(h.usesLlm && llmBlocked))
      .map(([kind]) => kind);
    const job = queue.claimNext(now, kinds);
    if (!job) return false;

    const handler = handlers[job.kind]!;
    this.log(`작업 #${job.id} ${job.kind} 시작 (${job.attempts}/${job.maxAttempts})`);
    try {
      const result = await handler.run(job);
      queue.complete(job.id, result);
      if (handler.usesLlm) pacer.recordRun();
      this.log(`작업 #${job.id} 완료`);
    } catch (error) {
      if (error instanceof LlmUnavailableError) {
        queue.defer(job.id, error.until, "LLM 사용량 한도 대기");
        this.log(`작업 #${job.id} 보류: ${error.message}`);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        const status = queue.fail(job.id, message);
        this.log(
          `작업 #${job.id} 실패 (${status === "queued" ? "재시도 예정" : "최종 실패"}): ${message}`,
        );
      }
    }
    return true;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.loop(), delayMs);
  }

  private async loop(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    let worked = false;
    try {
      worked = await this.tick();
    } catch (error) {
      this.log(`워커 오류: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.busy = false;
      // 방금 작업을 처리했으면 바로 다음 작업을 확인한다.
      this.schedule(worked ? 0 : this.deps.pollMs);
    }
  }

  private log(message: string): void {
    (this.deps.log ?? console.log)(`[worker] ${message}`);
  }
}
