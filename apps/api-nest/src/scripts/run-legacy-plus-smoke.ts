/**
 * Read-only Legacy / Legacy Plus smoke runner.  It deliberately consumes one
 * frozen candidate snapshot and never enqueues a job or writes to the DB.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DbService } from "../db.service.js";
import { getArchetype } from "../archetypes.js";
import { resolveTemplateDirection } from "../axis-tags.js";
import { TITLE_RULES } from "../constants.js";
import { buildT01DataGatedContext, type T01DataGatedContext } from "../t01-data-gated.js";
import { buildT01LegacyPlusContext, finalizeLegacyPlusMarkdown, legacyPlusAcademyPrinciples, legacyPlusArticlePatternGuide, legacyPlusDesignGuide, legacyPlusFactsForPrompt, legacyPlusFaqPromptInstruction, legacyPlusReviewPromptInstruction, legacyPlusStructureGuide, legacyPlusTemplateDirection, legacyPlusWritingGuide, t01LegacyPlusPromptContract, t01LegacyPlusQualityIssues } from "../t01-legacy-plus.js";
import { articleQualityIssues } from "../quality-gate.js";
import { buildPrompt, effectiveGenerationTitle, normalizeGeneratedMarkdown, resolveGenerationDesign, resolveTitleFromRule, rewriteH1Title } from "../worker.service.js";
import { runLlm } from "../llm-runner.js";

type Row = Record<string, any>;
const args = new Map(process.argv.slice(2).flatMap((value, index, all) => value.startsWith("--") ? [[value.slice(2), all[index + 1] || ""]] : []));
const snapshotPath = resolve(required("snapshot-file"));
const outputRoot = resolve(required("output"));
const dbPath = resolve(args.get("db") || "data/admin.db");
const domain = args.get("domain") || "app.drivingplus.me";
const provider = args.get("provider") || "codex";
const model = required("model");
const timeoutSec = Number(args.get("timeout") || 600);
const executionProfile = args.get("execution-profile") === "content_generation" ? "content_generation" as const : undefined;
const rawLegacyFile = optionalExistingFile("raw-legacy-file");
const rawLegacyPlusFile = optionalExistingFile("raw-legacy-plus-file");

for (const dir of ["snapshots", "prompts/legacy", "prompts/legacy-plus", "raw/legacy", "raw/legacy-plus", "final/legacy", "final/legacy-plus", "quality/legacy", "quality/legacy-plus", "metrics"]) mkdirSync(resolve(outputRoot, dir), { recursive: true });
const source = JSON.parse(readFileSync(snapshotPath, "utf8")) as Row;
const readonly = new DatabaseSync(dbPath, { readOnly: true });
const db = new DbService(); (db as any).db = readonly;

try {
  const domainMeta = db.getDomain(domain);
  if (!domainMeta) throw new Error(`domain not found: ${domain}`);
  const spec: Row = db.getTemplateSpec(domain, "T01") || {};
  const archetype = getArchetype(spec.kind || "local");
  const academyTypes = Array.isArray(spec.academy_types) ? spec.academy_types : [];
  const region = String(source.targetRegion || "");
  const slotSeed = String(source.slotSeed || "");
  const slot = { slot_id: slotSeed, template_id: "T01", region, primary_keyword: `${region} 운전면허학원`, persona: "운전면허 취득 준비자", intent: "지역별 운전학원 비교", modifier_1: "가까운", modifier_2: "상담전확인", title: null };
  const v2 = hydrateTypedFacts(source, db, domain, region, slotSeed, [slot.modifier_1, slot.modifier_2]);
  const plus = buildT01LegacyPlusContext(v2, slotSeed);
  const facts = factsFromSnapshot(source);
  const titleContext = { region, count: facts.academyCount, keyword: slot.primary_keyword, academyName: facts.firstAcademyName };
  const resolved = resolveTitleFromRule((spec.title_rule || TITLE_RULES.T01) as any, titleContext);
  const forcedTitle = effectiveGenerationTitle(typeof source.forcedTitle === "string" ? source.forcedTitle : null, resolved.title, titleContext);
  const design = resolveGenerationDesign("auto", domainMeta, "T01", spec.default_design);
  const direction = resolveTemplateDirection(spec as any, undefined);
  const legacyPrompt = buildPrompt(domainMeta, slot, facts.text, design, archetype, direction, academyTypes.length > 0, forcedTitle);
  const plusPrompt = `${buildPrompt(domainMeta, slot, legacyPlusFactsForPrompt(facts.text), design, archetype, legacyPlusTemplateDirection(plus), academyTypes.length > 0, forcedTitle, {
    structureGuide: legacyPlusStructureGuide(plus),
    writingGuide: legacyPlusWritingGuide(plus),
    articlePatternGuide: legacyPlusArticlePatternGuide(plus),
    designGuide: legacyPlusDesignGuide(),
    academyPrinciples: legacyPlusAcademyPrinciples(),
    modifierLabels: [slot.modifier_1, slot.modifier_2].filter((label): label is string => Boolean(label && !/^(?:가까운|근처)$/u.test(String(label).trim()))),
    reviewInstruction: legacyPlusReviewPromptInstruction(plus),
    faqInstruction: legacyPlusFaqPromptInstruction(),
    readerFlow: true,
  })}\n\n${t01LegacyPlusPromptContract(plus)}`;
  const snapshot = { ...source, experimentId: "legacy-plus-smoke-01", targetRegion: region, slotSeed, forcedTitle, legacyPlusTypedFacts: plus.data, legacyPlusSelectedReviews: plus.selectedReviews, requestParameters: { provider, model, timeoutSec, executionProfile: executionProfile || "default", sourceSnapshotPath: snapshotPath, generationModes: ["legacy", "t01_legacy_plus_v1"] } };
  writeJson("snapshots/legacy-plus-smoke-01.json", snapshot);
  const legacy = await execute("legacy", legacyPrompt, facts, plus, forcedTitle, rawLegacyFile);
  const legacyPlus = await execute("legacy-plus", plusPrompt, facts, plus, forcedTitle, rawLegacyPlusFile);
  const integrity = {
    sameTargetRegion: true,
    sameCandidateIds: JSON.stringify(source.v2TypedFacts.candidates.map((candidate: Row) => candidate.academyId)) === JSON.stringify(plus.data.candidates.map((candidate) => candidate.academyId)),
    sameCandidateOrder: true, sameSlotSeed: true, sameProvider: legacy.result.provider === legacyPlus.result.provider,
    sameRequestedModel: legacy.result.requested_model === legacyPlus.result.requested_model,
    sameTimeout: true, repairDisabled: true, fallbackDisabled: true,
  };
  const result = { outputRoot, snapshotPath, targetRegion: region, slotSeed, integrity, legacy: summarize(legacy), legacyPlus: summarize(legacyPlus), selectedReviews: plus.selectedReviews.map((review) => ({ academyId: review.academyId, academyName: review.academyName, source: review.source.label })), cost: "not_measured_chatgpt_cli" };
  writeJson("metrics/summary.json", result);
  console.log(JSON.stringify(result, null, 2));
} finally {
  readonly.close();
}

async function execute(mode: "legacy" | "legacy-plus", prompt: string, facts: Row, plus: ReturnType<typeof buildT01LegacyPlusContext>, forcedTitle: string | null, rawFile?: string) {
  writeFileSync(resolve(outputRoot, "prompts", mode, "legacy-plus-smoke-01.md"), prompt, "utf8");
  // A direct Codex CLI run can persist its last message with --output-last-message.
  // Reusing only that message here keeps evaluation post-processing (title,
  // per-academy reviews, and quality gates) identical without calling a model
  // a second time. This branch is evaluation-only; the worker never uses it.
  const result: Row = rawFile
    ? {
      ok: true,
      summary: readFileSync(rawFile, "utf8"),
      provider,
      requested_model: model,
      resolved_model: model,
      duration_sec: null,
      usage: null,
      parser_warning: "raw_last_message_reused",
    }
    : await runLlm(prompt, { provider, model, timeoutSec, executionProfile });
  const raw = String(result.summary || "").trim();
  let markdown = forcedTitle ? rewriteH1Title(normalizeGeneratedMarkdown(raw, facts.images, domain), forcedTitle) : normalizeGeneratedMarkdown(raw, facts.images, domain);
  if (mode === "legacy-plus") markdown = finalizeLegacyPlusMarkdown(markdown, plus);
  const t01Issues = mode === "legacy-plus" ? t01LegacyPlusQualityIssues(markdown, plus) : [];
  const hard = [...articleQualityIssues(markdown, facts.text, facts.images, [], domain), ...t01Issues.filter((issue) => issue.severity === "hard_failure").map((issue) => `t01_${issue.code}`)];
  writeFileSync(resolve(outputRoot, "raw", mode, "legacy-plus-smoke-01.md"), raw, "utf8");
  writeFileSync(resolve(outputRoot, "final", mode, "legacy-plus-smoke-01.md"), markdown, "utf8");
  writeJson(`quality/${mode}/legacy-plus-smoke-01.json`, { mode, modelResult: result, hard, t01Issues, repairAttempts: 0, repairStatus: "disabled_for_smoke" });
  return { result, markdown, hard, t01Issues };
}

function hydrateTypedFacts(snapshot: Row, db: DbService, domain: string, region: string, seed: string, modifiers: string[]): T01DataGatedContext {
  const baseline = snapshot.v2TypedFacts as T01DataGatedContext;
  const ids = baseline.candidates.map((candidate) => candidate.academyId);
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.all(`SELECT * FROM academies WHERE domain=? AND external_id IN (${placeholders})`, [domain, ...ids]);
  const byId = new Map(rows.map((row) => [String(row.external_id || row.id || row.name), row]));
  const ordered = ids.map((id) => byId.get(id));
  if (ordered.some((row) => !row)) throw new Error("snapshot candidates are not all available in the read-only DB");
  const context = buildT01DataGatedContext(region, ordered as Row[], snapshot.selectionTrace, seed, modifiers);
  if (JSON.stringify(ids) !== JSON.stringify(context.candidates.map((candidate) => candidate.academyId))) throw new Error("candidate order changed while hydrating snapshot");
  return context;
}

function factsFromSnapshot(snapshot: Row): Row {
  const text = String(snapshot.legacyFacts || "");
  const keys = Array.from(text.matchAll(/\[IMAGE:([A-Za-z0-9_-]+)\]/g)).map((match) => match[1]!);
  return { text, academyCount: snapshot.selectedCandidates?.length || 0, firstAcademyName: snapshot.selectedCandidates?.[0]?.academyName || "", images: Object.fromEntries(keys.map((key) => [key, key])) };
}

function summarize(run: { result: Row; markdown: string; hard: string[]; t01Issues: Row[] }) {
  return { generationSucceeded: Boolean(run.result.ok && run.markdown), provider: run.result.provider, requestedModel: run.result.requested_model || model, resolvedModel: run.result.resolved_model || run.result.model || model, durationSec: run.result.duration_sec, usage: run.result.usage ?? null, inputTokens: run.result.input_tokens ?? null, cachedInputTokens: run.result.cached_input_tokens ?? null, outputTokens: run.result.output_tokens ?? null, totalTokens: run.result.total_tokens ?? null, reasoningTokens: run.result.reasoning_tokens ?? null, hardFailures: run.hard, warnings: run.t01Issues.filter((issue) => issue.severity === "warning"), scorePenalties: run.t01Issues.filter((issue) => issue.severity === "score_penalty"), outputLength: run.markdown.length, error: run.result.error || null };
}

function writeJson(path: string, value: unknown): void { writeFileSync(resolve(outputRoot, path), `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function required(name: string): string { const value = String(args.get(name) || "").trim(); if (!value) throw new Error(`--${name} is required`); return value; }
function optionalExistingFile(name: string): string | undefined {
  const value = String(args.get(name) || "").trim();
  if (!value) return undefined;
  const path = resolve(value);
  if (!existsSync(path)) throw new Error(`--${name} file not found: ${path}`);
  return path;
}
