import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { neutralT01QualityIssues, type NeutralFailure } from "../neutral-quality-evaluator.js";

type Row = Record<string, any>;
type TaxonomyClassification = "true_content_error" | "legacy_gate_gap" | "v2_prompt_induced" | "v2_gate_improvement" | "false_positive" | "ambiguous" | "not_applicable";
type NativeFailure = Omit<NeutralFailure, "classification"> & { mode: "legacy" | "v2"; evaluator: "native"; classification: TaxonomyClassification };
const args = new Map(process.argv.slice(2).flatMap((value, index, all) => value.startsWith("--") ? [[value.slice(2), all[index + 1] || ""]] : []));
const inputRoot = resolve(args.get("input") || "data/content-generation-evaluation/codex-cli-single-pair-20260720");
const outputRoot = resolve(args.get("output") || `${inputRoot}/neutral-quality`);
mkdirSync(outputRoot, { recursive: true });
const snapshots = readDir(resolve(inputRoot, "snapshots")).filter((file) => file.endsWith(".json")).sort();
const pairs: Row[] = [];

for (const filename of snapshots) {
  const snapshot = readJson(resolve(inputRoot, "snapshots", filename));
  const id = snapshot.experimentId;
  const result: Row = { experimentId: id, targetRegion: snapshot.targetRegion, candidateIds: snapshot.selectedCandidates.map((candidate: Row) => candidate.academyId), modes: {} };
  for (const mode of ["legacy", "v2"] as const) {
    const markdownPath = resolve(inputRoot, "raw", mode, `${id}.md`);
    const qualityPath = resolve(inputRoot, "quality", mode, `${id}.json`);
    const markdown = existsSync(markdownPath) ? readFileSync(markdownPath, "utf8") : "";
    const native = existsSync(qualityPath) ? readJson(qualityPath) : {};
    const neutral = markdown ? neutralT01QualityIssues(markdown, snapshot.v2TypedFacts) : [];
    const nativeFailures = nativeFailuresFor(mode, native, markdown);
    result.modes[mode] = {
      nativeFailures,
      neutralFailures: neutral,
      neutralHardFailureCount: neutral.filter((issue) => issue.severity === "hard_failure").length,
      neutralWarningCount: neutral.filter((issue) => issue.severity === "warning").length,
      nativeTaxonomy: nativeFailures.map((issue: NativeFailure) => classifyNative(issue, neutral)),
    };
  }
  result.summary = comparisonSummary(result.modes.legacy, result.modes.v2);
  writeJson(resolve(outputRoot, `${id}.json`), result);
  pairs.push(result);
}
writeJson(resolve(outputRoot, "summary.json"), { inputRoot, evaluatedAt: new Date().toISOString(), pairCount: pairs.length, pairs });

function nativeFailuresFor(mode: "legacy" | "v2", record: Row, markdown: string): NativeFailure[] {
  const codes: string[] = Array.isArray(record.quality) ? record.quality : [];
  return codes.map((code) => {
    const mapped = code.replace(/^t01_/, "");
    const evidence = evidenceFor(code, markdown);
    return {
      mode: mode === "v2" ? "v2" : "legacy", evaluator: "native", ruleId: mapped,
      severity: "hard_failure", outputLocation: lineLocation(markdown, evidence), quotedEvidence: evidence,
      candidateId: null, supportingFact: null, classification: "ambiguous", explanation: `Native gate issue: ${code}`,
    };
  });
}

function evidenceFor(code: string, markdown: string): string {
  const patterns: Record<string, RegExp> = {
    too_long: /^#\s.+/m,
    adjacent_headings_without_body: /^###?\s+.+\n\n###?\s+.+/m,
    missing_available_image_slot: /\[IMAGE:[^\]]+\]/,
    exposes_internal_fact_language: /긍정 수강생 리뷰 보충자료|긍정 블로그 리뷰글 보충자료/,
    t01_unverified_shuttle_claim: /[^\n.]*셔틀[^\n.]*/,
    t01_unverified_pass_rate_claim: /[^\n.]*합격률[^\n.]*/,
  };
  const key = Object.keys(patterns).find((name) => code.startsWith(name));
  const found = key ? markdown.match(patterns[key]!)?.[0] : undefined;
  return String(found || code).replace(/\s+/g, " ").trim().slice(0, 240);
}

function classifyNative(native: NativeFailure, neutral: NeutralFailure[]): NativeFailure {
  const exactNeutral = neutral.find((issue) => issue.ruleId === native.ruleId);
  if (native.ruleId === "unverified_shuttle_claim" || native.ruleId === "unverified_pass_rate_claim") {
    return { ...native, classification: exactNeutral ? "v2_prompt_induced" : "false_positive", explanation: exactNeutral ? "Neutral evaluator found the same unsupported positive assertion." : "The matched text is a confirmation question, caveat, or explicit missing-fact statement rather than a positive assertion." };
  }
  if (native.ruleId === "exposes_internal_fact_language") return { ...native, classification: "true_content_error", explanation: "Reader-facing output exposes an internal input-data label." };
  if (native.ruleId === "adjacent_headings_without_body") return { ...native, classification: "true_content_error", explanation: "Heading structure has no intervening body text." };
  if (native.ruleId.startsWith("too_long")) return { ...native, classification: "not_applicable", explanation: "Length is retained as a native structural signal, not as a neutral factual hard failure." };
  if (native.ruleId === "missing_available_image_slot") return { ...native, classification: "ambiguous", explanation: "The rendered markdown contains image placeholders; the native image-slot detection result needs renderer-level verification and is not a neutral factual hard failure." };
  return { ...native, classification: "ambiguous" };
}

function comparisonSummary(legacy: Row, v2: Row): Row {
  const allNative = [...legacy.nativeTaxonomy, ...v2.nativeTaxonomy];
  return {
    neutralLegacyHardFailures: legacy.neutralHardFailureCount,
    neutralV2HardFailures: v2.neutralHardFailureCount,
    legacyGateGapCount: legacy.neutralFailures.filter((issue: NeutralFailure) => issue.severity === "hard_failure").length,
    v2PromptInducedErrorCount: v2.nativeTaxonomy.filter((issue: NativeFailure) => issue.classification === "v2_prompt_induced").length,
    v2GateImprovementCount: allNative.filter((issue: NativeFailure) => issue.classification === "v2_gate_improvement").length,
    falsePositiveCount: allNative.filter((issue: NativeFailure) => issue.classification === "false_positive").length,
  };
}

function readDir(path: string): string[] { return existsSync(path) ? readdirSync(path) : []; }
function readJson(path: string): Row { return JSON.parse(readFileSync(path, "utf8")); }
function writeJson(path: string, value: unknown): void { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function lineLocation(text: string, evidence: string): string { const index = text.indexOf(evidence); return index < 0 ? "unknown" : `line:${text.slice(0, index).split(/\r?\n/).length}`; }
