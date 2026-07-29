import { spawn } from "node:child_process";
import { resolve } from "node:path";

// 학원 심층조사용 LLM CLI 래퍼. worker.service 의 runLlm 패턴을 재사용하되,
// "웹 조사 + 엄격한 JSON 반환"에 특화. claude 우선 → 없으면 codex.
const PROJECT_DIR = resolve(new URL("../../..", import.meta.url).pathname);

export type ResearchProvider = "claude" | "codex";
export type ResearchProviderPreference = ResearchProvider | "auto";

export interface ResearchBaseRef {
  external_id: string;
  name?: string | null;
  address?: string | null;
  phone?: string | null;
  vphone?: string | null;
  region?: string | null;
}

// AI가 채울 조사 스키마(모르면 null. 절대 날조 금지).
export interface ResearchResult {
  name_researched?: string | null;
  address_researched?: string | null;
  phone_researched?: string | null;
  gu?: string | null;
  dong?: string | null;
  jibun_address?: string | null;
  hours?: string | null;
  night_class?: string | null;
  weekend?: string | null;
  closed_days?: string | null;
  shuttle_available?: string | null;
  shuttle_summary?: string | null;
  licenses?: string | null;
  self_test?: string | null;
  facilities?: string | null;
  fee_summary?: string | null;
  price_disclosed?: string | null;
  pass_rate?: string | null;
  pass_rate_scope?: string | null;
  established_year?: string | null;
  scale?: string | null;
  homepage_url?: string | null;
  naver_place_url?: string | null;
  kakao_url?: string | null;
  /** 등록 시 준비물·절차(신분증·사진·수수료 등). 원천에 없고 홈페이지 "입학안내" 에만 있다. */
  enrollment_prep?: string | null;
  /** 온라인 예약·상담 신청 경로가 있는지. */
  booking_channel?: string | null;
  /** 가까운 역·정류장과 노선·도보 시간. 시험장은 공단 페이지가 이걸 상세히 준다. */
  transit_access?: string | null;
  /** 주차 사정(가능·협소·외부 주차장 등). 편의시설 태그의 "주차"와 달리 실제 안내다. */
  parking_note?: string | null;
  courses?: Array<{ course_name?: string; price?: string; exam_fee_included?: string; extra_costs?: string; note?: string; source_url?: string }>;
  shuttle_routes?: Array<{ route_name?: string; waypoints?: unknown; coverage?: unknown; interval_text?: string; source_url?: string }>;
  sources?: Record<string, string>;
}

// CLI 존재 여부 감지(claude 우선). PATH에서 확인.
export async function detectResearchProviders(): Promise<ResearchProvider[]> {
  const providers: ResearchProvider[] = [];
  if (await hasCommand("claude")) providers.push("claude");
  if (await hasCommand("codex")) providers.push("codex");
  return providers;
}

function hasCommand(cmd: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const child = spawn("command", ["-v", cmd], { shell: "/bin/bash", stdio: ["ignore", "ignore", "ignore"] });
    child.on("error", () => resolvePromise(false));
    child.on("close", (code) => resolvePromise(code === 0));
  });
}

export interface ResearchCliOut {
  ok: boolean;
  text: string;
  provider: ResearchProvider;
  error?: string;
  // 웹 검증 여부. webUsed=false 면 웹조사가 실제로 일어나지 않은 것(값 신뢰 불가).
  // codex 등 감지 불가한 경우 undefined.
  webUsed?: boolean;
  webDenied?: number;
}

// CLI 실행. B안(자체 fetch)에서는 웹툴 없이 "제공된 소스 본문 → JSON 추출" 용도로 쓴다.
export async function runResearchCli(prompt: string, opts: { provider: ResearchProvider; timeoutSec?: number; model?: string }): Promise<ResearchCliOut> {
  const timeoutSec = opts.timeoutSec ?? 900;
  if (opts.provider === "codex") {
    const args = ["exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only", "-c", 'approval_policy="never"'];
    if (opts.model) args.push("--model", opts.model);
    args.push("-");
    const out = await spawnText("codex", args, prompt, timeoutSec);
    return { ok: out.code === 0, text: parseCodex(out.stdout), provider: "codex", error: out.code === 0 ? undefined : out.stderr };
  }
  const args = ["--print", "-", "--output-format", "stream-json", "--verbose"];
  if (opts.model) args.push("--model", opts.model);
  const out = await spawnText("claude", args, prompt, timeoutSec, { ANTHROPIC_API_KEY: undefined, ANTHROPIC_AUTH_TOKEN: undefined });
  const parsed = parseClaude(out.stdout);
  return { ok: out.code === 0, text: parsed.text, provider: "claude", error: out.code === 0 ? undefined : out.stderr, webUsed: parsed.webUsed, webDenied: parsed.webDenied };
}

// 응답 텍스트에서 JSON 객체를 추출·파싱.
export function parseResearchJson(text: string): ResearchResult | null {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  const candidates: string[] = [];
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(trimmed.slice(first, last + 1));
  candidates.push(trimmed);
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c);
      if (obj && typeof obj === "object") return normalizeResearchResult(obj as ResearchResult);
    } catch { /* try next */ }
  }
  return null;
}

// "unknown" 같은 자리표시는 근거가 없는 상태이지 조사값이 아니다. 모델이 프롬프트를
// 어겨도 DB에는 null로만 들어가게 경계에서 정규화한다.
function normalizeResearchResult(result: ResearchResult): ResearchResult {
  const normalized = { ...result };
  for (const [key, value] of Object.entries(normalized)) {
    if (typeof value !== "string") continue;
    if (["unknown", "n/a", "na"].includes(value.trim().toLowerCase())) {
      normalized[key as keyof ResearchResult] = null as never;
    }
  }
  return normalized;
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

function parseClaude(stdout: string): { text: string; webUsed?: boolean; webDenied?: number } {
  let summary = ""; const chunks: string[] = [];
  let webUsed: boolean | undefined;
  let webDenied = 0;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === "assistant") {
        for (const blk of obj.message?.content || []) if (blk?.type === "text" && blk.text) chunks.push(blk.text);
      } else if (obj.type === "result") {
        summary = obj.result || summary;
        const st = obj.usage?.server_tool_use;
        if (st) webUsed = Number(st.web_search_requests || 0) + Number(st.web_fetch_requests || 0) > 0;
        const denials = Array.isArray(obj.permission_denials) ? obj.permission_denials : [];
        webDenied = denials.filter((d: any) => d?.tool_name === "WebSearch" || d?.tool_name === "WebFetch").length;
      }
    } catch { /* ignore */ }
  }
  return { text: summary || chunks.join("\n").trim(), webUsed, webDenied };
}

function parseCodex(stdout: string): string {
  let summary = "";
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const obj = JSON.parse(line);
      if (typeof obj.item?.text === "string") summary = obj.item.text;
      if (typeof obj.output === "string") summary = obj.output;
      if (typeof obj.message?.content === "string") summary = obj.message.content;
    } catch { /* ignore */ }
  }
  return summary;
}
