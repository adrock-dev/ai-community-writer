// LLM CLI 러너 — codex/claude 서브프로세스를 spawn 해 stream JSON 을 파싱한다.
// worker(콘텐츠 생성)와 admin(축 값 제안 등)이 공유. Claude 경로는 OAuth 강제를 위해 env 의 API 키를 삭제한다.
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const PROJECT_DIR = resolve(new URL("../../..", import.meta.url).pathname);

export type LlmResult = { ok: boolean; summary: string; provider: string; model: string; duration_sec: number; cost_usd?: number; input_tokens?: number; output_tokens?: number; session_id?: string; error?: string };

export async function runLlm(prompt: string, opts: { provider: string; model?: string; timeoutSec: number }): Promise<LlmResult> {
  const started = Date.now();
  if (opts.provider === "codex") {
    const args = ["exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only", "-c", 'approval_policy="never"'];
    if (opts.model) args.push("--model", opts.model);
    args.push("-");
    const out = await spawnText("codex", args, prompt, opts.timeoutSec);
    const parsed = parseCodex(out.stdout);
    return { ok: out.code === 0 && Boolean(parsed.summary.trim()), summary: parsed.summary, provider: "codex", model: parsed.model || opts.model || "", duration_sec: (Date.now() - started) / 1000, error: out.code === 0 ? undefined : out.stderr };
  }
  const args = ["--print", "-", "--output-format", "stream-json", "--verbose"];
  if (opts.model) args.push("--model", opts.model);
  const out = await spawnText("claude", args, prompt, opts.timeoutSec, { ANTHROPIC_API_KEY: undefined, ANTHROPIC_AUTH_TOKEN: undefined });
  const parsed = parseClaude(out.stdout);
  return { ok: out.code === 0 && Boolean(parsed.summary.trim()), summary: parsed.summary, provider: "claude", model: parsed.model || opts.model || "", duration_sec: (Date.now() - started) / 1000, cost_usd: parsed.cost_usd, session_id: parsed.session_id, error: out.code === 0 ? undefined : out.stderr };
}

function spawnText(cmd: string, args: string[], input: string, timeoutSec: number, envPatch: Record<string, string | undefined> = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const [k, v] of Object.entries(envPatch)) { if (v === undefined) delete env[k]; else env[k] = v; }
    const child = spawn(cmd, args, { env, cwd: PROJECT_DIR, stdio: ["pipe", "pipe", "pipe"] });
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
function parseCodex(stdout: string) {
  let summary = "", model = "";
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const obj = JSON.parse(line);
      model ||= obj.model || obj.turn?.model || "";
      if (typeof obj.item?.text === "string") summary = obj.item.text;
      if (typeof obj.output === "string") summary = obj.output;
      if (typeof obj.message?.content === "string") summary = obj.message.content;
    } catch { /* ignore */ }
  }
  return { summary, model };
}
