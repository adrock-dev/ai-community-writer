// LLM CLI 러너 — codex/claude 서브프로세스를 spawn 해 stream JSON 을 파싱한다.
// worker(콘텐츠 생성)와 admin(축 값 제안 등)이 공유. Claude 경로는 OAuth 강제를 위해 env 의 API 키를 삭제한다.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { join } from "node:path";
import { runOpenAiResponses } from "./openai-responses-provider.js";

const PROJECT_DIR = resolve(new URL("../../..", import.meta.url).pathname);

export type LlmResult = {
  ok: boolean; summary: string; provider: string; model: string; duration_sec: number;
  cost_usd?: number; input_tokens?: number; output_tokens?: number; session_id?: string; error?: string;
  requested_model?: string; resolved_model?: string; duration_ms?: number;
  total_tokens?: number; cached_input_tokens?: number; reasoning_tokens?: number;
  usage?: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; cachedInputTokens?: number | null; reasoningTokens?: number | null };
  response_id?: string; response_status?: string; finish_reason?: string;
  warnings?: string[]; error_code?: string; error_type?: string; provider_error_code?: string;
  http_status?: number; request_id?: string; retry_count?: number;
};

export type LlmRunOptions = { provider?: string; model?: string; timeoutSec: number; maxOutputTokens?: number; reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh"; signal?: AbortSignal; executionProfile?: "content_generation" };

export async function runLlm(prompt: string, opts: LlmRunOptions): Promise<LlmResult> {
  const started = Date.now();
  const provider = resolveLlmProvider(opts.provider);
  if (provider === "openai_responses") return runOpenAiResponses(prompt, opts);
  if (provider === "unknown") {
    return { ok: false, summary: "", provider: String(opts.provider || ""), model: opts.model || "", requested_model: opts.model || undefined, duration_sec: (Date.now() - started) / 1000, duration_ms: Date.now() - started, retry_count: 0, error_code: "unknown_provider", error: `Unknown LLM provider: ${String(opts.provider || "")}.` };
  }
  if (provider === "codex") {
    const contentWorkdir = opts.executionProfile === "content_generation" ? await mkdtemp(join(tmpdir(), "adrock-codex-content-")) : undefined;
    try {
      const args = codexCommandArgs(opts.model, contentWorkdir);
      const out = await spawnText("codex", args, prompt, opts.timeoutSec, {}, contentWorkdir || PROJECT_DIR);
      const parsed = parseCodex(out.stdout);
      const ok = out.code === 0 && Boolean(parsed.summary.trim());
      return {
        ok, summary: parsed.summary, provider: "codex", model: parsed.model || opts.model || "", duration_sec: (Date.now() - started) / 1000,
        input_tokens: parsed.inputTokens, output_tokens: parsed.outputTokens, total_tokens: parsed.totalTokens, cached_input_tokens: parsed.cachedInputTokens, reasoning_tokens: parsed.reasoningTokens,
        usage: parsed.hasUsage ? { inputTokens: parsed.inputTokens ?? null, outputTokens: parsed.outputTokens ?? null, totalTokens: parsed.totalTokens ?? null, cachedInputTokens: parsed.cachedInputTokens ?? null, reasoningTokens: parsed.reasoningTokens ?? null } : undefined,
        error: ok ? undefined : parsed.error || out.stderr || "empty_output",
      };
    } finally {
      if (contentWorkdir) await rm(contentWorkdir, { recursive: true, force: true });
    }
  }
  const args = claudeCommandArgs(opts.model);
  const out = await spawnText("claude", args, prompt, opts.timeoutSec, { ANTHROPIC_API_KEY: undefined, ANTHROPIC_AUTH_TOKEN: undefined });
  const parsed = parseClaude(out.stdout);
  return { ok: out.code === 0 && Boolean(parsed.summary.trim()), summary: parsed.summary, provider: "claude", model: parsed.model || opts.model || "", duration_sec: (Date.now() - started) / 1000, cost_usd: parsed.cost_usd, session_id: parsed.session_id, error: out.code === 0 ? undefined : out.stderr };
}

export function resolveLlmProvider(provider: string | undefined): "codex" | "claude" | "openai_responses" | "unknown" {
  const normalized = String(provider || "codex").trim();
  if (normalized === "codex" || normalized === "claude" || normalized === "openai_responses") return normalized;
  return "unknown";
}

export function codexCommandArgs(model?: string, contentWorkdir?: string): string[] {
  const args = ["exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only", "-c", 'approval_policy="never"'];
  if (contentWorkdir) args.push("--ephemeral", "--ignore-rules", "-C", contentWorkdir);
  if (model) args.push("--model", model);
  args.push("-");
  return args;
}

export function claudeCommandArgs(model?: string): string[] {
  const args = ["--print", "-", "--output-format", "stream-json", "--verbose"];
  if (model) args.push("--model", model);
  return args;
}

function spawnText(cmd: string, args: string[], input: string, timeoutSec: number, envPatch: Record<string, string | undefined> = {}, cwd = PROJECT_DIR): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const [k, v] of Object.entries(envPatch)) { if (v === undefined) delete env[k]; else env[k] = v; }
    const child = spawn(cmd, args, { env, cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutSec * 1000);
    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    child.on("error", (e) => { clearTimeout(timer); resolvePromise({ code: 127, stdout, stderr: e.message }); });
    child.on("close", (code) => { clearTimeout(timer); resolvePromise({ code, stdout, stderr }); });
    child.stdin.end(input);
  });
}

function parseClaude(stdout: string) {
  let summary = "", model = "", session_id = "", cost_usd = 0; const chunks: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === "assistant") {
        model ||= obj.message?.model || ""; session_id ||= obj.session_id || obj.message?.session_id || "";
        for (const blk of obj.message?.content || []) if (blk?.type === "text" && blk.text) chunks.push(blk.text);
      } else if (obj.type === "result") { summary = obj.result || summary; cost_usd = Number(obj.total_cost_usd || 0); session_id ||= obj.session_id || ""; }
    } catch { /* ignore */ }
  }
  return { summary: summary || chunks.join("\n").trim(), model, session_id, cost_usd };
}
export function parseCodex(stdout: string) {
  let summary = "", model = "", error = "";
  let inputTokens: number | undefined, outputTokens: number | undefined, cachedInputTokens: number | undefined, reasoningTokens: number | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const obj = JSON.parse(line);
      model ||= obj.model || obj.turn?.model || "";
      if (typeof obj.item?.text === "string") summary = obj.item.text;
      if (typeof obj.output === "string") summary = obj.output;
      if (typeof obj.message?.content === "string") summary = obj.message.content;
      if (obj.type === "error" && typeof obj.message === "string") error ||= obj.message;
      if (obj.type === "turn.failed" && typeof obj.error?.message === "string") error ||= obj.error.message;
      if (obj.type === "turn.completed" && obj.usage && typeof obj.usage === "object") {
        inputTokens = finiteNumber(obj.usage.input_tokens) ?? inputTokens;
        outputTokens = finiteNumber(obj.usage.output_tokens) ?? outputTokens;
        cachedInputTokens = finiteNumber(obj.usage.cached_input_tokens) ?? cachedInputTokens;
        reasoningTokens = finiteNumber(obj.usage.reasoning_output_tokens) ?? reasoningTokens;
      }
    } catch { /* ignore */ }
  }
  const totalTokens = inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined;
  return { summary, model, error, inputTokens, outputTokens, totalTokens, cachedInputTokens, reasoningTokens, hasUsage: inputTokens !== undefined || outputTokens !== undefined || cachedInputTokens !== undefined || reasoningTokens !== undefined };
}

function finiteNumber(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
