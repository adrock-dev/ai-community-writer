import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { t01QualityIssues, type T01DataGatedContext } from "../t01-data-gated.js";

type Row = Record<string, any>;
type Source = { name: string; root: string; pairId: string; sampleType: string };

const outputRoot = resolve(process.argv[2] || "data/content-generation-evaluation/t01-native-gate-reevaluation-20260720");
const sources: Source[] = [
  { name: "익산시", root: "data/content-generation-evaluation/codex-cli-single-pair-20260720", pairId: "pair-01", sampleType: "B_supplement" },
  { name: "동해시", root: "data/content-generation-evaluation/codex-cli-additional-pairs-20260720", pairId: "pair-01", sampleType: "B_supplement" },
  { name: "고성군", root: "data/content-generation-evaluation/codex-cli-additional-pairs-20260720", pairId: "pair-02", sampleType: "C_far" },
  { name: "원주시", root: "data/content-generation-evaluation/codex-cli-additional-pairs-20260720", pairId: "pair-03", sampleType: "E_facts_sparse" },
];

mkdirSync(outputRoot, { recursive: true });
const pairs = sources.map(reevaluate);
const summary = {
  evaluatedAt: new Date().toISOString(),
  evaluator: "updated_t01_v2_native_gate_readonly",
  pairCount: pairs.length,
  totals: {
    legacyNativeHardFailures: pairs.reduce((sum, pair) => sum + pair.legacy.quality.length, 0),
    v2OriginalNativeHardFailures: pairs.reduce((sum, pair) => sum + pair.v2.originalQuality.length, 0),
    v2ReevaluatedNativeHardFailures: pairs.reduce((sum, pair) => sum + pair.v2.reevaluatedQuality.length, 0),
    removedFalsePositives: pairs.reduce((sum, pair) => sum + pair.v2.removedCodes.length, 0),
    newFailures: pairs.reduce((sum, pair) => sum + pair.v2.addedCodes.length, 0),
    neutralHardFailures: pairs.reduce((sum, pair) => sum + pair.neutral.legacyHardFailureCount + pair.neutral.v2HardFailureCount, 0),
  },
  pairs,
};
writeJson(resolve(outputRoot, "summary.json"), summary);
console.log(JSON.stringify(summary.totals));

function reevaluate(source: Source): Row {
  const root = resolve(source.root);
  const snapshot = readJson(resolve(root, "snapshots", `${source.pairId}.json`));
  const v2Record = readJson(resolve(root, "quality", "v2", `${source.pairId}.json`));
  const legacyRecord = readJson(resolve(root, "quality", "legacy", `${source.pairId}.json`));
  const v2Output = readFileSync(resolve(root, "raw", "v2", `${source.pairId}.md`), "utf8");
  const t01Issues = t01QualityIssues(v2Output, snapshot.v2TypedFacts as T01DataGatedContext);
  const newT01HardCodes = t01Issues.filter((issue) => issue.severity === "hard_failure").map((issue) => `t01_${issue.code}`);
  const originalQuality = Array.isArray(v2Record.quality) ? v2Record.quality : [];
  const nonClaimQuality = originalQuality.filter((code: string) => code !== "t01_unverified_shuttle_claim" && code !== "t01_unverified_pass_rate_claim");
  const reevaluatedQuality = [...nonClaimQuality.filter((code: string) => !code.startsWith("t01_")), ...newT01HardCodes];
  const originalT01HardCodes = originalQuality.filter((code: string) => code.startsWith("t01_"));
  const neutral = readOptionalJson(resolve(root, "neutral-quality", `${source.pairId}.json`));
  const result = {
    targetRegion: snapshot.targetRegion,
    sampleType: source.sampleType,
    sourceRoot: source.root,
    pairId: source.pairId,
    candidateIds: snapshot.selectedCandidates.map((candidate: Row) => candidate.academyId),
    legacy: { quality: legacyRecord.quality || [], unchanged: true },
    v2: {
      originalQuality,
      originalT01HardCodes,
      reevaluatedQuality,
      reevaluatedT01Issues: t01Issues,
      removedCodes: originalQuality.filter((code: string) => !reevaluatedQuality.includes(code)),
      addedCodes: reevaluatedQuality.filter((code: string) => !originalQuality.includes(code)),
    },
    neutral: {
      legacyHardFailureCount: neutral?.modes?.legacy?.neutralHardFailureCount ?? null,
      v2HardFailureCount: neutral?.modes?.v2?.neutralHardFailureCount ?? null,
    },
  };
  writeJson(resolve(outputRoot, `${source.name}.json`), result);
  return result;
}

function readJson(path: string): Row { return JSON.parse(readFileSync(path, "utf8")); }
function readOptionalJson(path: string): Row | null { return existsSync(path) ? readJson(path) : null; }
function writeJson(path: string, value: unknown): void { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
