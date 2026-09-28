import type { AppConfig, LlmProvider } from "../config.ts";
import type { Database } from "../db/database.ts";
import { pauseUntilForUsage, type UsageWindow } from "./limits.ts";
import { type ProviderOutcome, type ProviderRunner, runProvider } from "./providers.ts";

export interface LlmResult {
  text: string;
  provider: LlmProvider;
  model: string;
  durationMs: number;
}

/** 모든 프로바이더가 한도로 쉬는 중. until까지 기다렸다가 다시 시도해야 한다. */
export class LlmUnavailableError extends Error {
  readonly until: Date;
  constructor(until: Date, detail: string) {
    super(`모든 LLM 프로바이더가 사용량 한도로 대기 중 (${until.toISOString()}까지): ${detail}`);
    this.name = "LlmUnavailableError";
    this.until = until;
  }
}

export interface ProviderStatus {
  provider: LlmProvider;
  blockedUntil?: string;
  reason: string;
  usage: UsageWindow[];
}

/**
 * config.llm.order 순서대로 CLI를 호출한다.
 * - 한도에 걸렸거나 사용률이 기준 이상이면 그 프로바이더는 리셋 시각까지 건너뛴다.
 * - 실행 파일이 없거나 오류가 나면 다음 프로바이더로 넘어간다.
 */
export class LlmClient {
  private readonly db: Database;
  private readonly config: AppConfig["llm"];
  private readonly runner: ProviderRunner;

  constructor(db: Database, config: AppConfig["llm"], runner: ProviderRunner = runProvider) {
    this.db = db;
    this.config = config;
    this.runner = runner;
  }

  status(now: Date = new Date()): ProviderStatus[] {
    return this.config.order.map((provider) => {
      const row = this.db.get<{ blocked_until: string | null; reason: string; usage: string }>(
        "SELECT blocked_until, reason, usage FROM provider_state WHERE provider = ?",
        [provider],
      );
      const blocked = row?.blocked_until && new Date(row.blocked_until) > now;
      return {
        provider,
        blockedUntil: blocked ? (row.blocked_until ?? undefined) : undefined,
        reason: blocked ? (row?.reason ?? "") : "",
        usage: row ? (JSON.parse(row.usage) as UsageWindow[]) : [],
      };
    });
  }

  /** 지금 호출 가능한 프로바이더가 없으면 가장 먼저 풀리는 시각, 있으면 undefined. */
  nextAvailableAt(now: Date = new Date()): Date | undefined {
    const statuses = this.status(now);
    if (statuses.some((s) => !s.blockedUntil)) return undefined;
    return statuses.map((s) => new Date(s.blockedUntil!)).reduce((a, b) => (a < b ? a : b));
  }

  async generate(prompt: string, opts: { timeoutSec?: number } = {}): Promise<LlmResult> {
    const failures: string[] = [];
    let attempted = 0;
    for (const status of this.status()) {
      if (status.blockedUntil) {
        failures.push(`${status.provider}: ${status.reason}`);
        continue;
      }
      attempted++;
      const provider = status.provider;
      const started = new Date();
      const outcome = await this.runner(provider, prompt, {
        command: this.config[provider].command,
        model: this.config[provider].model,
        timeoutSec: opts.timeoutSec ?? this.config.timeoutSec,
      });
      const durationMs = Date.now() - started.getTime();
      this.record(provider, started, durationMs, outcome);

      if (outcome.kind === "ok") {
        return { text: outcome.text, provider, model: outcome.model, durationMs };
      }
      failures.push(`${provider}: ${outcome.message.split("\n")[0]}`);
    }

    const until = this.nextAvailableAt();
    if (until) throw new LlmUnavailableError(until, failures.join(" / "));
    if (!attempted) throw new Error("설정된 LLM 프로바이더가 없습니다");
    throw new Error(`LLM 생성 실패 — ${failures.join(" / ")}`);
  }

  private record(
    provider: LlmProvider,
    started: Date,
    durationMs: number,
    outcome: ProviderOutcome,
  ) {
    const now = new Date();
    const usage = "usage" in outcome ? outcome.usage : [];
    const cooldown = new Date(now.getTime() + this.config.limitCooldownMin * 60_000);
    let blockedUntil: Date | undefined;
    let reason = "";
    if (outcome.kind === "rate_limited") {
      blockedUntil = outcome.until && outcome.until > now ? outcome.until : cooldown;
      reason = "사용량 한도 도달";
    } else if (outcome.kind === "ok") {
      blockedUntil = pauseUntilForUsage(usage, this.config.pauseAtUsagePercent, cooldown);
      if (blockedUntil) reason = `사용률 ${this.config.pauseAtUsagePercent}% 이상`;
    }

    this.db.run(
      "INSERT INTO llm_calls (provider, model, started_at, duration_ms, outcome, error, usage) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        provider,
        outcome.kind === "ok" ? outcome.model : "",
        started.toISOString(),
        durationMs,
        outcome.kind,
        outcome.kind === "ok" ? "" : outcome.message.slice(0, 4000),
        JSON.stringify(usage),
      ],
    );
    // 사용률 정보가 없는 응답(오류 등)이면 직전 사용률을 유지한다.
    this.db.run(
      `INSERT INTO provider_state (provider, blocked_until, reason, usage, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET blocked_until = excluded.blocked_until, reason = excluded.reason,
         usage = CASE WHEN excluded.usage = '[]' THEN provider_state.usage ELSE excluded.usage END,
         updated_at = excluded.updated_at`,
      [
        provider,
        blockedUntil?.toISOString() ?? null,
        reason,
        JSON.stringify(usage),
        now.toISOString(),
      ],
    );
  }
}
