import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { LlmProvider } from "../config.ts";
import { resolveCommand } from "./command.ts";
import { looksRateLimited, parseResetTime, type UsageWindow } from "./limits.ts";
import { runProcess } from "./process.ts";

export type ProviderOutcome =
  | { kind: "ok"; text: string; model: string; usage: UsageWindow[] }
  | { kind: "rate_limited"; message: string; until?: Date; usage: UsageWindow[] }
  | { kind: "error" | "timeout" | "not_found"; message: string };

export interface RunOptions {
  command: string;
  model: string;
  timeoutSec: number;
}

export type ProviderRunner = (
  provider: LlmProvider,
  prompt: string,
  opts: RunOptions,
) => Promise<ProviderOutcome>;

/**
 * CLI 작업 폴더. 저장소 안에서 실행하면 CLI가 이 저장소의 CLAUDE.md/AGENTS.md를 읽어
 * 글 작성에 개발 지침이 섞이므로, 저장소 밖의 빈 폴더에서 실행한다.
 */
export const LLM_WORK_DIR = join(tmpdir(), "ai-community-writer-llm");

const epochToIso = (sec: unknown) =>
  typeof sec === "number" && sec > 0 ? new Date(sec * 1000).toISOString() : undefined;

// ── Claude ──────────────────────────────────────────────────────────────

export function claudeArgs(model: string): string[] {
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    // 글만 쓰게 한다: 도구·MCP·세션 저장 끔
    "--tools",
    "",
    "--strict-mcp-config",
    "--no-session-persistence",
  ];
  if (model) args.push("--model", model);
  return args;
}

export interface ClaudeParsed {
  text: string;
  model: string;
  isError: boolean;
  errorText: string;
  rejected: boolean;
  usage: UsageWindow[];
  resetsAt?: string;
}

export function parseClaudeStream(stdout: string): ClaudeParsed {
  const out: ClaudeParsed = {
    text: "",
    model: "",
    isError: false,
    errorText: "",
    rejected: false,
    usage: [],
  };
  const chunks: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith("{")) continue;
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type === "assistant") {
      out.model ||= obj.message?.model ?? "";
      for (const block of obj.message?.content ?? []) {
        if (block?.type === "text" && block.text) chunks.push(block.text);
      }
    } else if (obj.type === "result") {
      if (typeof obj.result === "string") out.text = obj.result;
      if (obj.is_error) {
        out.isError = true;
        out.errorText = String(obj.result ?? obj.subtype ?? "error");
      }
    } else if (obj.type === "rate_limit_event") {
      const info = obj.rate_limit_info ?? {};
      if (info.status === "rejected") out.rejected = true;
      out.resetsAt = epochToIso(info.resetsAt) ?? out.resetsAt;
      const windows = info.unifiedWindows ?? {};
      out.usage = Object.entries(windows).map(([name, w]: [string, any]) => ({
        name,
        usedPercent: Math.round(Number(w?.utilization ?? 0) * 1000) / 10,
        resetsAt: epochToIso(w?.resetsAt),
      }));
    }
  }
  if (!out.text) out.text = chunks.join("\n").trim();
  return out;
}

// ── Codex ───────────────────────────────────────────────────────────────

export function codexArgs(model: string, lastMessageFile: string): string[] {
  const args = [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "-c",
    'approval_policy="never"',
    "--color",
    "never",
    "--output-last-message",
    lastMessageFile,
  ];
  if (model) args.push("--model", model);
  args.push("-");
  return args;
}

export interface CodexParsed {
  text: string;
  threadId: string;
  errorText: string;
}

export function parseCodexStream(stdout: string): CodexParsed {
  const out: CodexParsed = { text: "", threadId: "", errorText: "" };
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith("{")) continue;
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type === "thread.started") out.threadId = String(obj.thread_id ?? "");
    else if (obj.type === "item.completed" && obj.item?.type === "agent_message") {
      out.text = String(obj.item.text ?? "");
    } else if (obj.type === "error") out.errorText = String(obj.message ?? "error");
    else if (obj.type === "turn.failed")
      out.errorText = String(obj.error?.message ?? "turn failed");
  }
  return out;
}

/** Codex 세션 로그 한 줄에서 rate_limits를 뽑는다. */
export function codexUsageFromRateLimits(rl: any): UsageWindow[] {
  const windows: UsageWindow[] = [];
  for (const key of ["primary", "secondary"]) {
    const w = rl?.[key];
    if (!w || typeof w.used_percent !== "number") continue;
    windows.push({
      name: w.window_minutes ? `${key}(${w.window_minutes}m)` : key,
      usedPercent: w.used_percent,
      resetsAt: epochToIso(w.resets_at),
    });
  }
  return windows;
}

/** 방금 실행한 스레드의 세션 로그(~/.codex/sessions/YYYY/MM/DD/rollout-*-<id>.jsonl)에서 마지막 사용률을 읽는다. */
export function readCodexUsage(threadId: string, now: Date = new Date()): UsageWindow[] {
  if (!threadId) return [];
  const root = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "sessions");
  for (const offset of [0, -1]) {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    const dir = join(
      root,
      String(d.getFullYear()),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0"),
    );
    if (!existsSync(dir)) continue;
    const file = readdirSync(dir).find((f) => f.endsWith(`${threadId}.jsonl`));
    if (!file) continue;
    const lines = readFileSync(join(dir, file), "utf8").split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i] ?? "";
      if (!line.includes('"rate_limits"')) continue;
      try {
        const obj = JSON.parse(line);
        const rl = obj.payload?.rate_limits ?? obj.rate_limits;
        if (rl) return codexUsageFromRateLimits(rl);
      } catch {
        /* 다음 줄 */
      }
    }
  }
  return [];
}

// ── 실행 ────────────────────────────────────────────────────────────────

export function childEnv(provider: LlmProvider): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // 구독(OAuth) 인증을 강제한다. API 키가 있으면 CLI가 키 과금으로 넘어간다.
  if (provider === "claude") {
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
  } else {
    delete env.OPENAI_API_KEY;
  }
  return env;
}

export const runProvider: ProviderRunner = async (provider, prompt, opts) => {
  mkdirSync(LLM_WORK_DIR, { recursive: true });
  const lastFile = join(LLM_WORK_DIR, `codex-last-${process.pid}-${Date.now()}.txt`);
  const args = provider === "claude" ? claudeArgs(opts.model) : codexArgs(opts.model, lastFile);
  const spec = resolveCommand(opts.command, args);
  if (!spec)
    return { kind: "not_found", message: `${opts.command} 실행 파일을 PATH에서 찾지 못했습니다` };

  const result = await runProcess(spec, prompt, {
    timeoutMs: opts.timeoutSec * 1000,
    cwd: LLM_WORK_DIR,
    env: childEnv(provider),
  });
  if (result.spawnError) {
    const notFound = /ENOENT/.test(result.spawnError);
    return { kind: notFound ? "not_found" : "error", message: result.spawnError };
  }
  const tail = (s: string) => s.trim().slice(-2000);

  if (provider === "claude") {
    const parsed = parseClaudeStream(result.stdout);
    if (result.timedOut) return { kind: "timeout", message: `${opts.timeoutSec}초 초과` };
    const failText = `${parsed.errorText}\n${result.stderr}`;
    if (parsed.rejected || ((parsed.isError || result.code !== 0) && looksRateLimited(failText))) {
      const until = parsed.resetsAt ? new Date(parsed.resetsAt) : parseResetTime(failText);
      return { kind: "rate_limited", message: tail(failText), until, usage: parsed.usage };
    }
    if (parsed.isError || result.code !== 0 || !parsed.text.trim()) {
      return { kind: "error", message: tail(failText) || `종료 코드 ${result.code}` };
    }
    return { kind: "ok", text: parsed.text, model: parsed.model, usage: parsed.usage };
  }

  const parsed = parseCodexStream(result.stdout);
  let text = parsed.text;
  if (existsSync(lastFile)) {
    text = readFileSync(lastFile, "utf8") || text;
    rmSync(lastFile, { force: true });
  }
  const usage = readCodexUsage(parsed.threadId);
  if (result.timedOut) return { kind: "timeout", message: `${opts.timeoutSec}초 초과` };
  const failText = `${parsed.errorText}\n${result.stderr}`;
  if ((result.code !== 0 || parsed.errorText) && looksRateLimited(failText)) {
    return {
      kind: "rate_limited",
      message: tail(failText),
      until: parseResetTime(failText),
      usage,
    };
  }
  if (result.code !== 0 || !text.trim()) {
    return { kind: "error", message: tail(failText) || `종료 코드 ${result.code}` };
  }
  return { kind: "ok", text, model: opts.model, usage };
};
