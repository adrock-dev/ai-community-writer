/**
 * 프롬프트 파일 하나를 지정한 모델로 1회 생성한다(읽기 전용, DB 쓰기 없음).
 * 프롬프트 문구 실험용 — 워커 경로는 이 스크립트를 쓰지 않는다.
 *
 * 예: npx tsx src/scripts/run-prompt-file.ts --prompt-file p.md --model gpt-5.6-luna --out out.md
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runLlm } from "../llm-runner.js";

const args = new Map(process.argv.slice(2).flatMap((value, index, all) => value.startsWith("--") ? [[value.slice(2), all[index + 1] || ""]] : []));
const promptFile = resolve(required("prompt-file"));
const outPath = resolve(required("out"));
const model = args.get("model") || "";
const provider = args.get("provider") || "codex";
const timeoutSec = Number(args.get("timeout") || 1200);

const prompt = readFileSync(promptFile, "utf8");
const result = await runLlm(prompt, { provider, model, timeoutSec, executionProfile: "content_generation" });
writeFileSync(outPath, String(result.summary || ""), "utf8");
writeFileSync(`${outPath}.meta.json`, `${JSON.stringify({
  promptFile, model: result.model, requestedModel: model, provider: result.provider, ok: result.ok,
  durationSec: result.duration_sec, inputTokens: result.input_tokens, outputTokens: result.output_tokens, error: result.error || null,
}, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: result.ok, model: result.model, durationSec: result.duration_sec, out: outPath, error: result.error || null }));

function required(name: string): string {
  const value = String(args.get(name) || "").trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}
