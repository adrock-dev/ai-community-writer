import type { LlmResult } from "./llm-runner.js";

export type OpenAiResponsesOptions = {
  model?: string;
  timeoutSec: number;
  maxOutputTokens?: number;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh";
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

type JsonRecord = Record<string, unknown>;

const DEFAULT_BASE_URL = "https://api.openai.com";

/**
 * Text-only OpenAI Responses API adapter. It intentionally does not retry: the
 * caller owns retry policy so provider-level retries cannot double-charge work.
 */
export async function runOpenAiResponses(prompt: string, options: OpenAiResponsesOptions): Promise<LlmResult> {
  const started = Date.now();
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  const requestedModel = String(options.model || "").trim();
  const base = baseResult(requestedModel, started);

  if (!apiKey) return fail(base, started, "missing_api_key", "OPENAI_API_KEY is required for provider=openai_responses.");
  if (!requestedModel) return fail(base, started, "missing_model", "A model is required for provider=openai_responses.");

  let endpoint: string;
  try {
    endpoint = responsesEndpoint(process.env.OPENAI_API_BASE_URL);
  } catch {
    return fail(base, started, "invalid_base_url", "OPENAI_API_BASE_URL must be an absolute HTTP(S) URL.");
  }

  const controller = new AbortController();
  let timedOut = false;
  let cancelled = false;
  const timeoutMs = Math.max(1, Math.round(Number(options.timeoutSec) * 1000) || 1);
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const abortFromCaller = () => { cancelled = true; controller.abort(); };
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    const body: JsonRecord = {
      model: requestedModel,
      input: prompt,
      store: false,
    };
    if (isPositiveInteger(options.maxOutputTokens)) body.max_output_tokens = options.maxOutputTokens;
    if (options.reasoningEffort) body.reasoning = { effort: options.reasoningEffort };

    const response = await (options.fetchImpl || fetch)(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const requestId = response.headers.get("x-request-id") || response.headers.get("request-id") || undefined;
    const raw = await response.text();
    const parsed = parseJson(raw);

    if (!response.ok) {
      const error = errorBody(parsed);
      return fail({ ...base, http_status: response.status, request_id: requestId, error_type: error.type, provider_error_code: error.code }, started, classifyHttpError(response.status, error.code), sanitizeMessage(error.message || `OpenAI Responses API returned HTTP ${response.status}.`, apiKey));
    }
    if (!parsed) return fail({ ...base, http_status: response.status, request_id: requestId }, started, "invalid_json", "OpenAI Responses API returned invalid JSON.");

    const summary = extractOutputText(parsed);
    if (!summary) return fail({ ...base, http_status: response.status, request_id: requestId, response_id: stringField(parsed.id), response_status: stringField(parsed.status), resolved_model: stringField(parsed.model) }, started, "empty_output", "OpenAI Responses API returned no output text.");

    const usage = usageFields(recordField(parsed.usage));
    return {
      ...base,
      ok: true,
      summary,
      model: stringField(parsed.model) || requestedModel,
      requested_model: requestedModel,
      resolved_model: stringField(parsed.model) || undefined,
      response_id: stringField(parsed.id),
      response_status: stringField(parsed.status),
      finish_reason: finishReason(parsed),
      http_status: response.status,
      request_id: requestId,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      total_tokens: usage.totalTokens,
      cached_input_tokens: usage.cachedInputTokens,
      reasoning_tokens: usage.reasoningTokens,
      usage: usage.hasUsage ? {
        inputTokens: usage.inputTokens ?? null,
        outputTokens: usage.outputTokens ?? null,
        totalTokens: usage.totalTokens ?? null,
        cachedInputTokens: usage.cachedInputTokens ?? null,
        reasoningTokens: usage.reasoningTokens ?? null,
      } : undefined,
      duration_sec: elapsedSeconds(started),
      duration_ms: Date.now() - started,
      retry_count: 0,
      warnings: [],
    };
  } catch (error) {
    const code = timedOut ? "timeout" : cancelled ? "cancelled" : isAbortError(error) ? "cancelled" : "network_error";
    return fail(base, started, code, sanitizeMessage(error instanceof Error ? error.message : "OpenAI Responses API request failed.", apiKey));
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

function baseResult(model: string, started: number): LlmResult {
  return { ok: false, summary: "", provider: "openai_responses", model, requested_model: model || undefined, duration_sec: elapsedSeconds(started), duration_ms: Date.now() - started, retry_count: 0, warnings: [] };
}

function fail(base: LlmResult, started: number, errorCode: string, message: string): LlmResult {
  const durationMs = Date.now() - started;
  return { ...base, ok: false, summary: "", error_code: errorCode, error: message, duration_sec: durationMs / 1000, duration_ms: durationMs, retry_count: 0 };
}

function responsesEndpoint(rawBaseUrl: string | undefined): string {
  const parsed = new URL(String(rawBaseUrl || DEFAULT_BASE_URL).trim());
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("unsupported protocol");
  const basePath = parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = basePath.endsWith("/v1") ? `${basePath}/responses` : `${basePath}/v1/responses`;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function extractOutputText(payload: JsonRecord): string {
  const topLevel = stringField(payload.output_text);
  if (topLevel) return topLevel;
  const chunks: string[] = [];
  for (const item of arrayField(payload.output)) {
    if (stringField(item.type) !== "message") continue;
    for (const content of arrayField(item.content)) {
      if (stringField(content.type) !== "output_text") continue;
      const text = stringField(content.text);
      if (text) chunks.push(text);
    }
  }
  return chunks.join("").trim();
}

function finishReason(payload: JsonRecord): string | undefined {
  const direct = stringField(payload.finish_reason);
  if (direct) return direct;
  const status = stringField(payload.status);
  return status === "completed" ? "completed" : undefined;
}

function usageFields(usage: JsonRecord | undefined) {
  const inputTokens = numberField(usage?.input_tokens);
  const outputTokens = numberField(usage?.output_tokens);
  const totalTokens = numberField(usage?.total_tokens);
  const inputDetails = recordField(usage?.input_tokens_details);
  const outputDetails = recordField(usage?.output_tokens_details);
  return {
    hasUsage: Boolean(usage), inputTokens, outputTokens, totalTokens,
    cachedInputTokens: numberField(inputDetails?.cached_tokens),
    reasoningTokens: numberField(outputDetails?.reasoning_tokens),
  };
}

function parseJson(raw: string): JsonRecord | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    return recordField(value);
  } catch { return undefined; }
}

function errorBody(value: JsonRecord | undefined) {
  const error = recordField(value?.error);
  return { type: stringField(error?.type), code: stringField(error?.code), message: stringField(error?.message) };
}

function classifyHttpError(status: number, remoteCode?: string): string {
  if (status === 400) return "invalid_request";
  if (status === 401) return "authentication_error";
  if (status === 403) return "permission_denied";
  if (status === 404) return "model_not_found";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server_error";
  if (remoteCode === "model_not_found") return "model_not_found";
  return "http_error";
}

function sanitizeMessage(message: string, apiKey: string): string {
  return String(message || "OpenAI Responses API request failed.")
    .replaceAll(apiKey, "[REDACTED]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .slice(0, 500);
}

function recordField(value: unknown): JsonRecord | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined; }
function arrayField(value: unknown): JsonRecord[] { return Array.isArray(value) ? value.map(recordField).filter((item): item is JsonRecord => Boolean(item)) : []; }
function stringField(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value : undefined; }
function numberField(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function isPositiveInteger(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value > 0; }
function elapsedSeconds(started: number): number { return (Date.now() - started) / 1000; }
function isAbortError(error: unknown): boolean { return error instanceof Error && error.name === "AbortError"; }
