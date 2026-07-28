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
  courses?: Array<{ course_name?: string; price?: string; exam_fee_included?: string; extra_costs?: string; note?: string; source_url?: string }>;
  shuttle_routes?: Array<{ route_name?: string; waypoints?: unknown; coverage?: unknown; interval_text?: string; source_url?: string }>;
  sources?: Record<string, string>;
}

// CLI 존재 여부 감지(claude 우선). PATH에서 확인.
export async function detectResearchProvider(): Promise<ResearchProvider | null> {
  return (await detectResearchProviders())[0] ?? null;
}

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

export function buildResearchPrompt(base: ResearchBaseRef): string {
  const ref = [
    base.name ? `- 이름: ${base.name}` : null,
    base.address ? `- 주소(참고): ${base.address}` : null,
    base.phone ? `- 전화(참고): ${base.phone}` : null,
    base.vphone ? `- 대표번호(참고): ${base.vphone}` : null,
    base.region ? `- 지역: ${base.region}` : null,
  ].filter(Boolean).join("\n");

  return `당신은 자동차운전전문학원을 조사하는 정확성 최우선 리서처입니다.

[대상 학원 — 확실한 참고 정보]
${ref}

[중요] 학원명이 동일한 학원이 여러 곳 있을 수 있습니다. 위 주소·전화와 **일치하는 바로 그 학원**만 조사하세요. 다른 지점/동명 학원 정보를 섞지 마세요.

[조사 방법]
- 공식 홈페이지 / 네이버플레이스 / 카카오맵 / 공공데이터를 웹에서 교차 확인하세요.
- 절대 추측하거나 지어내지 마세요. 특히 주소·전화·가격·합격률은 확인된 값만.
- 확인 안 된 항목은 반드시 null 로 두세요. 애매하면 null.
- 참고 정보(주소·전화)도 웹에서 다시 확인해 *_researched 필드에 넣으세요(참고값과 다르면 확인된 값 우선).

[출력 형식 — 매우 중요]
- 오직 **JSON 하나**만 출력하세요. 설명·마크다운·코드펜스 없이 순수 JSON.
- 스키마(모든 필드 선택, 모르면 null):
{
  "name_researched": string|null, "address_researched": string|null, "phone_researched": string|null,
  "gu": string|null, "dong": string|null, "jibun_address": string|null,
  "hours": string|null, "night_class": string|null, "weekend": string|null, "closed_days": string|null,
  "shuttle_available": "yes"|"no"|"unknown"|null, "shuttle_summary": string|null,
  "licenses": string|null, "self_test": string|null, "facilities": string|null,
  "fee_summary": string|null, "price_disclosed": "yes"|"no"|null,
  "pass_rate": string|null, "pass_rate_scope": "official"|"self_claim"|null,
  "established_year": string|null, "scale": string|null,
  "homepage_url": string|null, "naver_place_url": string|null, "kakao_url": string|null,
  "courses": [{"course_name": string, "price": string|null, "exam_fee_included": "yes"|"no"|"partial"|null, "extra_costs": string|null, "note": string|null, "source_url": string|null}],
  "shuttle_routes": [{"route_name": string, "waypoints": string|null, "coverage": string|null, "interval_text": string|null, "source_url": string|null}],
  "sources": { "<field_key>": "<확인한 출처 URL>" }
}
- courses/shuttle_routes 는 확인된 것만. 없으면 빈 배열.
- sources 에는 값을 채운 필드의 출처 URL을 최대한 넣으세요.`;
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
      if (obj && typeof obj === "object") return obj as ResearchResult;
    } catch { /* try next */ }
  }
  return null;
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
