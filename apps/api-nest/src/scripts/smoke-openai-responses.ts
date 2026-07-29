import { runLlm } from "../llm-runner.js";

const models = ["gpt-5.6-luna", "gpt-5.4-mini"];
const prompt = "다음 문장을 자연스러운 한국어 한 문장으로 바꿔 주세요: 운전면허 학원을 선택할 때는 위치와 교육 과정을 확인해야 합니다.";
const hasCredential = Boolean(String(process.env.OPENAI_API_KEY || "").trim());

if (!hasCredential) {
  console.log(JSON.stringify({ executed: false, status: "not_tested_missing_credentials", requiredEnvironmentVariable: "OPENAI_API_KEY", models }));
} else {
  const results = [];
  for (const model of models) {
    const result = await runLlm(prompt, { provider: "openai_responses", model, timeoutSec: 30, maxOutputTokens: 50 });
    results.push({
      model, status: classify(result), ok: result.ok, requestedModel: result.requested_model || model, resolvedModel: result.resolved_model || result.model || null,
      httpStatus: result.http_status || null, durationMs: result.duration_ms ?? Math.round(result.duration_sec * 1000),
      usage: result.usage || { inputTokens: result.input_tokens ?? null, outputTokens: result.output_tokens ?? null, totalTokens: result.total_tokens ?? null },
      errorCode: result.error_code || null, responseId: result.response_id || null,
    });
  }
  console.log(JSON.stringify({ executed: true, store: false, repair: false, fallback: false, streaming: false, results }));
}

function classify(result: Awaited<ReturnType<typeof runLlm>>) {
  if (result.ok) return "accessible";
  if (["model_not_found", "permission_denied", "authentication_error", "invalid_request"].includes(result.error_code || "")) return result.error_code;
  return "provider_failed";
}
