import { Injectable } from "@nestjs/common";
import crypto from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import { basename, dirname, resolve } from "node:path";

type Row = Record<string, any>;
type GenerateImageResult = { images: Record<string, string>; warnings: string[] };
type GenerateImageOptions = {
  enabled: boolean;
  required: boolean;
  count: number;
  size: string;
  model?: string;
  provider?: string;
};

const PROJECT_DIR = resolve(new URL("../../..", import.meta.url).pathname);
export const GENERATED_IMAGE_ROOT = resolve(PROJECT_DIR, "data/generated-images");
const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
const SUPPORTED_IMAGE_SIZES = new Set(["auto", "1024x1024", "1536x1024", "1024x1536", "2048x2048", "2048x1152", "3840x2160", "2160x3840"]);

@Injectable()
export class ImageGenerationService {
  async generateForSlot(domain: string, slot: Row, facts: string, options: GenerateImageOptions): Promise<GenerateImageResult> {
    if (!options.enabled) return { images: {}, warnings: [] };
    const images: Record<string, string> = {};
    const warnings: string[] = [];
    try {
      const provider = resolveImageProvider(options.provider);
      const count = clampInt(options.count, 1, 1, 3);
      for (let i = 0; i < count; i++) {
        const key = count === 1 ? "generated_hero" : `generated_${i + 1}`;
        const filename = safeImageFilename(`${String(slot.slot_id || "slot")}-${key}.png`);
        const outputPath = generatedImageFilePath(domain, filename);
        mkdirSync(dirname(outputPath), { recursive: true });
        await generateImage(provider, {
          prompt: buildSeoImagePrompt(domain, slot, facts, i),
          model: options.model,
          outputPath,
          size: options.size || "1024x1024",
        });
        if (existsSync(outputPath)) images[key] = publicGeneratedImageUrl(domain, filename);
      }
    } catch (error: any) {
      const message = `codex image generation failed: ${error?.message || String(error)}`;
      if (options.required) throw new Error(message);
      warnings.push(message);
    }
    return { images, warnings };
  }

  // 글 작성 후, LLM이 실제 배치한 생성 슬롯을 그 섹션 내용에 맞춰 1장씩 만든다(내용 기반 이미지).
  async generateContextual(
    domain: string,
    slot: Row,
    key: string,
    sectionHeading: string,
    options: { size: string; provider?: string; required: boolean; index: number; sectionText?: string },
  ): Promise<{ url: string | null; warning?: string }> {
    try {
      const provider = resolveImageProvider(options.provider);
      const filename = safeImageFilename(`${String(slot.slot_id || "slot")}-${key}.png`);
      const outputPath = generatedImageFilePath(domain, filename);
      mkdirSync(dirname(outputPath), { recursive: true });
      await generateImage(provider, {
        prompt: buildSectionImagePrompt(domain, slot, sectionHeading, options.index, options.sectionText || ""),
        outputPath,
        size: options.size || "1024x1024",
      });
      if (existsSync(outputPath)) return { url: publicGeneratedImageUrl(domain, filename) };
      return { url: null };
    } catch (error: any) {
      const message = `image generation failed: ${error?.message || String(error)}`;
      if (options.required) throw new Error(message);
      return { url: null, warning: message };
    }
  }
}

// 섹션(H2/H3) 내용에 맞고, index 로 구도를 분산해 글마다·이미지마다 겹치지 않게 한다.
function buildSectionImagePrompt(domain: string, slot: Row, sectionHeading: string, index: number, sectionText: string): string {
  const region = String(slot.region || "").trim();
  const keyword = String(slot.primary_keyword || "").trim();
  const persona = String(slot.persona || "").trim();
  const topic = String(sectionHeading || "").replace(/[#*_`>]/g, "").trim();
  const detail = String(sectionText || "").replace(/[#*_`>]/g, "").trim();
  const audience = persona ? `${persona} audience` : "local search audience";
  const compositions = [
    "wide establishing editorial shot",
    "mid-shot focused on the activity or subject",
    "closer detail-oriented supporting shot",
  ];
  const composition = compositions[index % compositions.length];
  return [
    "Create a realistic editorial photo for a Korean SEO article.",
    `Article topic: ${[region, keyword].filter(Boolean).join(" ") || domain}. Audience: ${audience}.`,
    topic ? `This image illustrates the section titled "${topic}". Depict a scene that specifically matches this section's content.` : "",
    detail ? `Section summary (interpret as a single realistic scene; never render any of this wording as visible text): ${detail}` : "",
    `Composition: ${composition}.`,
    "Choose the setting that fits the section: e.g., written-exam study, driving test course, on-road practice, license test center, or consultation — Korean driving-education context.",
    "Natural daylight, trustworthy editorial style, looks like a usable article photo, not an advertisement.",
    "No readable text, no logos, no brand marks, no license plate numbers, no UI mockups.",
  ].filter(Boolean).join("\n");
}

type ImageProvider = "openai" | "codex";

// provider 선택: 명시값(openai/codex) → 환경변수 SEO_IMAGE_PROVIDER → OPENAI_API_KEY 존재 시 openai → 기본 codex.
// 프론트가 보내는 "private-codex" 같은 값은 openai/codex 가 아니므로 자동 해석으로 넘어간다(키 넣으면 자동 이관).
function resolveImageProvider(requested?: string): ImageProvider {
  const explicit = String(requested || "").toLowerCase();
  if (explicit === "openai") return "openai";
  if (explicit === "codex") return "codex";
  const envProvider = String(process.env.SEO_IMAGE_PROVIDER || "").toLowerCase();
  if (envProvider === "openai") return "openai";
  if (envProvider === "codex") return "codex";
  return process.env.OPENAI_API_KEY ? "openai" : "codex";
}

async function generateImage(provider: ImageProvider, options: { prompt: string; model?: string; outputPath: string; size: string }): Promise<void> {
  if (provider === "openai") {
    return generateOpenAiImage({
      prompt: options.prompt,
      model: process.env.SEO_IMAGE_MODEL || "gpt-image-1",
      outputPath: options.outputPath,
      size: options.size,
    });
  }
  return generateCodexImage({
    prompt: options.prompt,
    model: options.model || process.env.CODEX_IMAGEGEN_MODEL || "gpt-5.4",
    outputPath: options.outputPath,
    size: options.size,
  });
}

const OPENAI_IMAGE_SIZES = new Set(["auto", "1024x1024", "1536x1024", "1024x1536"]);

// 공식 OpenAI 이미지 API(gpt-image-1). API 키 종량 과금이라 대량 생성에 적합하고, 인증이 안정적이다.
async function generateOpenAiImage(options: { prompt: string; model: string; outputPath: string; size: string }): Promise<void> {
  const apiKey = normalizeRequiredString(process.env.OPENAI_API_KEY, "missing OPENAI_API_KEY for OpenAI image provider");
  const baseUrl = String(process.env.OPENAI_API_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const size = OPENAI_IMAGE_SIZES.has(options.size) ? options.size : "1024x1024";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.SEO_IMAGEGEN_TIMEOUT_MS || process.env.CODEX_IMAGEGEN_TIMEOUT_MS || 300_000));
  try {
    const response = await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: options.model, prompt: options.prompt, size, n: 1 }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      const hint = response.status === 401 ? "OpenAI auth failed (check OPENAI_API_KEY)" : `OpenAI image API HTTP ${response.status}`;
      throw new Error(`${hint}: ${text.slice(0, 300)}`);
    }
    const parsed = JSON.parse(text);
    const b64 = parsed?.data?.[0]?.b64_json;
    if (!b64) throw new Error("OpenAI image response missing b64_json data");
    await saveBase64Png(b64, options.outputPath);
  } finally {
    clearTimeout(timeout);
  }
}

async function generateCodexImage(options: { prompt: string; model: string; outputPath: string; size: string }): Promise<void> {
  const session = await loadCodexSession();
  const request = buildCodexResponsesRequest({ ...options, session });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.CODEX_IMAGEGEN_TIMEOUT_MS || 300_000));
  try {
    const response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      const hint = response.status === 401 ? "Codex/ChatGPT auth expired or unauthorized" : `Codex image backend HTTP ${response.status}`;
      throw new Error(`${hint}: ${text.slice(0, 300)}`);
    }
    const parsed = parseCodexResponse(text, response.headers.get("content-type") || "");
    const resultBase64 = extractImageBase64(parsed);
    await saveBase64Png(resultBase64, options.outputPath);
  } finally {
    clearTimeout(timeout);
  }
}

async function loadCodexSession(): Promise<{ accessToken: string; accountId: string; installationId: string | null }> {
  const codexHome = process.env.CODEX_HOME || resolve(os.homedir(), ".codex");
  const authPath = process.env.CODEX_AUTH_FILE || resolve(codexHome, "auth.json");
  const installationPath = process.env.CODEX_INSTALLATION_ID_FILE || resolve(codexHome, "installation_id");
  const raw = JSON.parse(await fs.readFile(authPath, "utf8"));
  const tokens = raw?.tokens || {};
  const accessToken = normalizeRequiredString(tokens.access_token, "missing Codex access_token in auth.json");
  const accountId = normalizeRequiredString(tokens.account_id, "missing Codex account_id in auth.json");
  let installationId: string | null = null;
  try {
    installationId = normalizeString(await fs.readFile(installationPath, "utf8"));
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
  return { accessToken, accountId, installationId };
}

function buildCodexResponsesRequest(options: { prompt: string; model: string; outputPath: string; size: string; session: { accessToken: string; accountId: string; installationId: string | null } }) {
  if (!SUPPORTED_IMAGE_SIZES.has(options.size)) throw new Error(`unsupported image size: ${options.size}`);
  const baseUrl = process.env.CODEX_IMAGEGEN_BASE_URL || DEFAULT_CODEX_BASE_URL;
  const url = new URL("responses", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
  const sessionId = crypto.randomUUID();
  const content = [{ type: "input_text", text: options.prompt }];
  const body: Record<string, any> = {
    model: options.model,
    instructions: "",
    input: [{ type: "message", role: "user", content }],
    tools: [{ type: "image_generation", output_format: "png", size: options.size }],
    tool_choice: "auto",
    parallel_tool_calls: false,
    reasoning: null,
    store: false,
    stream: true,
    include: ["reasoning.encrypted_content"],
  };
  if (options.session.installationId) body.client_metadata = { "x-codex-installation-id": options.session.installationId };
  return {
    url,
    sessionId,
    headers: {
      Authorization: `Bearer ${options.session.accessToken}`,
      "ChatGPT-Account-ID": options.session.accountId,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      originator: process.env.CODEX_IMAGEGEN_ORIGINATOR || "codex_cli_rs",
      session_id: sessionId,
    },
    body,
  };
}

function parseCodexResponse(text: string, contentType: string): { events: Array<{ event: string; data: any }>; items: any[]; responseId: string | null } {
  const trimmed = text.trimStart();
  if (contentType.includes("text/event-stream") || trimmed.startsWith("event:") || trimmed.startsWith("data:")) {
    const events = trimmed
      .replace(/\r\n/g, "\n")
      .split(/\n\n+/)
      .map((block) => parseSseBlock(block.trim()))
      .filter(Boolean) as Array<{ event: string; data: any }>;
    const items: any[] = [];
    let responseId: string | null = null;
    for (const event of events) {
      const type = event.data?.type;
      if (type === "response.created") responseId = event.data?.response?.id ?? responseId;
      if (type === "response.output_item.done" && event.data?.item) items.push(event.data.item);
      if (type === "response.completed") responseId = event.data?.response?.id ?? responseId;
    }
    return { events, items, responseId };
  }
  const payload = JSON.parse(text);
  return { events: [], items: Array.isArray(payload?.output) ? payload.output : [], responseId: payload?.id ?? null };
}

function parseSseBlock(block: string): { event: string; data: any } | null {
  if (!block) return null;
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split(/\n/)) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  const dataText = dataLines.join("\n");
  return { event, data: dataText ? JSON.parse(dataText) : null };
}

function extractImageBase64(parsed: { events: Array<{ data: any }>; items: any[] }): string {
  const imageItem = [...parsed.items].reverse().find((item) => item?.type === "image_generation_call" && item?.result);
  if (imageItem?.result) return imageItem.result;
  const partial = [...parsed.events].reverse().find((event) => event?.data?.type === "response.image_generation_call.partial_image" && event?.data?.partial_image_b64);
  if (partial?.data?.partial_image_b64) return partial.data.partial_image_b64;
  throw new Error("Codex response completed without image_generation_call result");
}

async function saveBase64Png(resultBase64: string, outputPath: string): Promise<void> {
  if (/^data:/i.test(resultBase64)) throw new Error("Codex image result was a data URL, expected raw base64");
  if (!/^[A-Za-z0-9+/=\s]+$/.test(resultBase64)) throw new Error("Codex image result is not valid base64");
  const bytes = Buffer.from(resultBase64.trim(), "base64");
  if (!bytes.length) throw new Error("Codex image result decoded to empty bytes");
  await fs.mkdir(dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, bytes);
}

export function generatedImageFilePath(domain: string, file: string): string {
  const safeDomain = String(domain || "domain").toLowerCase().replace(/[^a-z0-9.-]/g, "-");
  return resolve(GENERATED_IMAGE_ROOT, safeDomain, safeImageFilename(file));
}

export function publicGeneratedImageUrl(domain: string, file: string): string {
  const base = String(process.env.SEO_PUBLIC_ASSET_BASE_URL || process.env.SEO_API_BASE_URL || `http://127.0.0.1:${process.env.ADMIN_PORT || 8765}`).replace(/\/$/, "");
  return `${base}/api/v1/${encodeURIComponent(domain)}/generated-images/${encodeURIComponent(safeImageFilename(file))}`;
}

export function safeImageFilename(file: string): string {
  const name = basename(String(file || "image.png")).replace(/[^a-zA-Z0-9._-]/g, "-");
  return name.endsWith(".png") ? name : `${name}.png`;
}

function buildSeoImagePrompt(domain: string, slot: Row, facts: string, index: number): string {
  const region = String(slot.region || "").trim();
  const keyword = String(slot.primary_keyword || "").trim();
  const intent = String(slot.intent || "").trim();
  const persona = String(slot.persona || "").trim();
  const academyNames = Array.from(facts.matchAll(/\[\d+\]\s*([^/\n]+)/g)).map((m) => m[1]?.trim()).filter(Boolean).slice(0, 3);
  const subject = [region, keyword, intent].filter(Boolean).join(" ");
  const audience = persona ? `${persona} audience` : "local search audience";
  const candidateText = academyNames.length ? `Inspired by local driving academy context: ${academyNames.join(", ")}.` : "";
  const variant = index === 0 ? "wide editorial hero image" : "supporting editorial image";
  return [
    `Create a realistic ${variant} for a Korean SEO article.`,
    `Topic: ${subject || domain}. Audience: ${audience}.`,
    candidateText,
    "Scene: clean Korean urban driving academy / learner driver context, natural daylight, useful and trustworthy editorial style.",
    "No readable text, no logos, no brand marks, no license plate numbers, no UI mockups, no exaggerated illustration.",
    "The image should look like a usable article photo, not an advertisement.",
  ].filter(Boolean).join("\n");
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeRequiredString(value: unknown, message: string): string {
  const normalized = normalizeString(value);
  if (!normalized) throw new Error(message);
  return normalized;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? Math.trunc(n) : fallback));
}
