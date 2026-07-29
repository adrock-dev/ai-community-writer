import { afterEach, describe, expect, it, vi } from "vitest";
import { runLlm, claudeCommandArgs, codexCommandArgs, parseCodex, resolveLlmProvider } from "../src/llm-runner.js";
import { runOpenAiResponses } from "../src/openai-responses-provider.js";

const savedEnv = { key: process.env.OPENAI_API_KEY, baseUrl: process.env.OPENAI_API_BASE_URL };

function setApiKey(value = "test-secret-value") { process.env.OPENAI_API_KEY = value; }
function response(payload: unknown, status = 200, headers: Record<string, string> = {}) { return new Response(JSON.stringify(payload), { status, headers }); }

afterEach(() => {
  if (savedEnv.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedEnv.key;
  if (savedEnv.baseUrl === undefined) delete process.env.OPENAI_API_BASE_URL; else process.env.OPENAI_API_BASE_URL = savedEnv.baseUrl;
  vi.restoreAllMocks();
});

describe("OpenAI Responses provider", () => {
  it("sends a non-stored text request and parses text, model, usage, and metadata", async () => {
    setApiKey();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({
      id: "resp_123", model: "gpt-5.6-luna", status: "completed",
      output: [{ type: "reasoning", summary: [] }, { type: "message", content: [{ type: "output_text", text: "안전한 문장입니다." }] }],
      usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20, input_tokens_details: { cached_tokens: 2 }, output_tokens_details: { reasoning_tokens: 3 } },
    }, 200, { "x-request-id": "req_123" }));

    const result = await runOpenAiResponses("테스트", { model: "gpt-5.6-luna", timeoutSec: 5, maxOutputTokens: 50, fetchImpl: fetchMock });
    const request = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(request[1]?.body));

    expect(String(request[0])).toBe("https://api.openai.com/v1/responses");
    expect(body).toMatchObject({ model: "gpt-5.6-luna", input: "테스트", store: false, max_output_tokens: 50 });
    expect(body.tools).toBeUndefined();
    expect(result).toMatchObject({ ok: true, summary: "안전한 문장입니다.", provider: "openai_responses", model: "gpt-5.6-luna", requested_model: "gpt-5.6-luna", resolved_model: "gpt-5.6-luna", response_id: "resp_123", request_id: "req_123", input_tokens: 12, output_tokens: 8, total_tokens: 20, cached_input_tokens: 2, reasoning_tokens: 3 });
    expect(JSON.stringify(result)).not.toContain("test-secret-value");
  });

  it("joins multiple output_text fragments and ignores reasoning items", async () => {
    setApiKey();
    const result = await runOpenAiResponses("테스트", {
      model: "gpt-5.4-mini", timeoutSec: 5,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ output: [
        { type: "reasoning", content: [{ type: "output_text", text: "숨겨야 함" }] },
        { type: "message", content: [{ type: "output_text", text: "첫째 " }, { type: "output_text", text: "둘째" }] },
      ] })),
    });
    expect(result).toMatchObject({ ok: true, summary: "첫째 둘째" });
  });

  it("uses a custom base URL once and avoids duplicate v1 slashes", async () => {
    setApiKey();
    process.env.OPENAI_API_BASE_URL = "https://gateway.example/v1/";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ output_text: "ok" }));
    await runOpenAiResponses("테스트", { model: "gpt-5.4-mini", timeoutSec: 5, fetchImpl: fetchMock });
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://gateway.example/v1/responses");
  });

  it.each([
    [400, "invalid_request"], [401, "authentication_error"], [403, "permission_denied"], [404, "model_not_found"], [429, "rate_limit"], [500, "server_error"],
  ])("maps HTTP %i to %s without exposing the key", async (status, expectedCode) => {
    setApiKey();
    const result = await runOpenAiResponses("테스트", { model: "gpt-5.4-mini", timeoutSec: 5, fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ error: { type: "api_error", code: "model_not_found", message: "Bearer test-secret-value" } }, status)) });
    expect(result).toMatchObject({ ok: false, error_code: expectedCode, http_status: status, error_type: "api_error", provider_error_code: "model_not_found" });
    expect(result.error).not.toContain("test-secret-value");
  });

  it("returns explicit local errors for missing key, missing model, invalid JSON, empty output, network failure, and timeout", async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(runOpenAiResponses("x", { model: "m", timeoutSec: 5 })).resolves.toMatchObject({ error_code: "missing_api_key" });
    setApiKey();
    await expect(runOpenAiResponses("x", { timeoutSec: 5 })).resolves.toMatchObject({ error_code: "missing_model" });
    await expect(runOpenAiResponses("x", { model: "m", timeoutSec: 5, fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("not-json")) })).resolves.toMatchObject({ error_code: "invalid_json" });
    await expect(runOpenAiResponses("x", { model: "m", timeoutSec: 5, fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ output: [{ type: "message", content: [] }] })) })).resolves.toMatchObject({ error_code: "empty_output" });
    await expect(runOpenAiResponses("x", { model: "m", timeoutSec: 5, fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new Error("network down")) })).resolves.toMatchObject({ error_code: "network_error" });

    const waitForAbort = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_, reject) => {
      (init?.signal as AbortSignal).addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
    await expect(runOpenAiResponses("x", { model: "m", timeoutSec: 0.001, fetchImpl: waitForAbort })).resolves.toMatchObject({ error_code: "timeout" });
  });
});

describe("LLM runner routing compatibility", () => {
  it("keeps omitted provider as codex and retains exact legacy CLI arguments", () => {
    expect(resolveLlmProvider()).toBe("codex");
    expect(codexCommandArgs("model-x")).toEqual(["exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only", "-c", 'approval_policy="never"', "--model", "model-x", "-"]);
    expect(claudeCommandArgs("model-y")).toEqual(["--print", "-", "--output-format", "stream-json", "--verbose", "--model", "model-y"]);
    expect(resolveLlmProvider("claude")).toBe("claude");
    expect(resolveLlmProvider("openai_responses")).toBe("openai_responses");
  });

  it("adds the isolated content-generation profile only when explicitly requested", () => {
    expect(codexCommandArgs("model-x", "/private/tmp/content")).toEqual(["exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only", "-c", 'approval_policy="never"', "--ephemeral", "--ignore-rules", "-C", "/private/tmp/content", "--model", "model-x", "-"]);
  });

  it("parses a final agent message, CLI usage, and a model error when no final text exists", () => {
    expect(parseCodex('{"type":"item.completed","item":{"type":"agent_message","text":"최종 본문"}}\n{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":30,"reasoning_output_tokens":5}}')).toMatchObject({ summary: "최종 본문", error: "", inputTokens: 100, cachedInputTokens: 20, outputTokens: 30, reasoningTokens: 5, totalTokens: 130, hasUsage: true });
    expect(parseCodex('{"type":"error","message":"model requires a newer version"}\n{"type":"turn.failed","error":{"message":"same error"}}')).toMatchObject({ summary: "", error: "model requires a newer version" });
  });

  it("rejects an unknown provider rather than silently routing it to Claude", async () => {
    const result = await runLlm("x", { provider: "unknown", model: "m", timeoutSec: 5 });
    expect(result).toMatchObject({ ok: false, error_code: "unknown_provider", provider: "unknown" });
  });

  it("routes explicit openai_responses requests through the adapter", async () => {
    setApiKey();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ output_text: "adapter route" }));
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;
    try {
      const result = await runLlm("x", { provider: "openai_responses", model: "gpt-5.4-mini", timeoutSec: 5 });
      expect(result).toMatchObject({ ok: true, summary: "adapter route", provider: "openai_responses" });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
