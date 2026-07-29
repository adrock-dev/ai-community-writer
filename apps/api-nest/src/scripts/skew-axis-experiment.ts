// 임시 실험 스크립트: 축(persona/modifier) 조합 겹침이 T01 글을 한쪽으로 치우치게 하는지 검증.
// 지역/facts/모드(legacy)를 고정하고 persona+modifier 조합만 바꾼다 → 치우침이 나오면 순수하게 축 조합 탓.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DbService } from "../db.service.js";
import { academyPool, getArchetype } from "../archetypes.js";
import { resolveTemplateDirection } from "../axis-tags.js";
import { TITLE_RULES } from "../constants.js";
import { articleQualityIssues } from "../quality-gate.js";
import { buildPrompt, effectiveGenerationTitle, normalizeGeneratedMarkdown, resolveGenerationDesign, resolveTitleFromRule, rewriteH1Title } from "../worker.service.js";
import { runLlm } from "../llm-runner.js";

type Row = Record<string, any>;

const args = new Map(process.argv.slice(2).flatMap((v, i, all) => (v.startsWith("--") ? [[v.slice(2), all[i + 1] || ""]] : [])));
const dbPath = resolve(args.get("db") || "data/admin.db");
const domain = args.get("domain") || "app.drivingplus.me";
const region = args.get("region") || "전북특별자치도 익산시";
const provider = args.get("provider") || "codex";
const model = args.get("model") || "";
const timeoutSec = Number(args.get("timeout")) || 600;
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const outputRoot = resolve(args.get("output") || `data/content-generation-evaluation/skew-axis-${stamp}`);

// persona/modifier 모두 실제 T01 axis_values 에서 가져옴. 의도적으로 (1~3)은 겹쳐 쌓고 (4)는 중립, (5)는 상충.
const COMBOS: Array<{ id: string; label: string; persona: string; modifier_1: string; modifier_2: string }> = [
  { id: "01-shuttle", label: "셔틀 3중 겹침", persona: "셔틀버스 이용 희망자", modifier_1: "셔틀편리", modifier_2: "가까운" },
  { id: "02-cost", label: "비용 3중 겹침", persona: "가성비 좋은 학원을 찾는 수강생", modifier_1: "비용절약", modifier_2: "상담전확인" },
  { id: "03-night", label: "야간/직장인 겹침", persona: "야간반을 찾는 직장인", modifier_1: "야간반", modifier_2: "주말반" },
  { id: "04-neutral", label: "중립(대조군)", persona: "운전이 처음인 초보자", modifier_1: "가까운", modifier_2: "상담전확인" },
  { id: "05-conflict", label: "상충(셔틀·비용·야간)", persona: "셔틀버스 이용 희망자", modifier_1: "비용절약", modifier_2: "야간반" },
];

// 치우침 측정용 테마 사전. 각 테마의 등장 횟수를 세어 글이 한쪽으로 쏠렸는지 본다.
const THEMES: Record<string, RegExp> = {
  셔틀: /셔틀/g,
  비용: /비용|수강료|가격|요금|원(?:대|입니다|이며)|만\s*원/g,
  야간_주말: /야간|주말|퇴근|직장인/g,
  거리_근처: /가까|근처|거리|동선|생활권/g,
  상담확인: /상담|확인|문의|체크/g,
  초보: /초보|처음|입문/g,
};

mkdirSync(outputRoot, { recursive: true });
for (const d of ["prompts", "final", "quality"]) mkdirSync(resolve(outputRoot, d), { recursive: true });

const readonly = new DatabaseSync(dbPath, { readOnly: true });
const db = new DbService();
(db as any).db = readonly;
const domainMeta = db.getDomain(domain);
if (!domainMeta) throw new Error(`domain not found: ${domain}`);
const spec: Row = db.getTemplateSpec(domain, "T01") || {};
const archetype = getArchetype(spec.kind || "local");
const academyTypes = Array.isArray(spec.academy_types) && spec.academy_types.length ? spec.academy_types : [];
const design = resolveGenerationDesign("auto", domainMeta, "T01", spec.default_design);
const direction = resolveTemplateDirection(spec as any, undefined);
const worker: any = new (await import("../worker.service.js")).WorkerService(db, {} as never);

// facts 는 지역 기반이라 5개 조합 전부 동일 — 완벽한 통제.
const baseSlot: Row = { slot_id: `skew-${region}`, template_id: "T01", region, primary_keyword: `${region} 운전면허학원`, persona: "", intent: "", modifier_1: "가까운", modifier_2: "상담전확인", title: null };
const facts = worker.buildFacts(domain, baseSlot, { maxAcademyImages: 5, perAcademyImages: 1 }, academyTypes, archetype);
console.log(`[facts] region=${region} academyCount=${facts.academyCount} firstAcademy=${facts.firstAcademyName} factsChars=${facts.text.length}`);
readonly.close();

if (facts.academyCount < 2) throw new Error(`학원 부족: ${facts.academyCount}곳 (T01 최소 2곳)`);

const titleRule = (spec.title_rule || TITLE_RULES.T01) as any;
const summary: Row[] = [];

for (const combo of COMBOS) {
  const slot: Row = { ...baseSlot, slot_id: `skew-${combo.id}`, persona: combo.persona, modifier_1: combo.modifier_1, modifier_2: combo.modifier_2 };
  const titleContext = { region, count: facts.academyCount, keyword: slot.primary_keyword, academyName: facts.firstAcademyName };
  const titleResolved = resolveTitleFromRule(titleRule, titleContext);
  const forcedTitle = effectiveGenerationTitle(null, titleResolved.title, titleContext);
  const prompt = buildPrompt(domainMeta, slot, facts.text, design, archetype, direction, academyTypes.length > 0, forcedTitle);
  writeFileSync(resolve(outputRoot, "prompts", `${combo.id}.md`), prompt, "utf8");

  console.log(`\n[generate] ${combo.id} (${combo.label}) persona="${combo.persona}" mods="${combo.modifier_1},${combo.modifier_2}" ...`);
  const result = await runLlm(prompt, { provider, model, timeoutSec, executionProfile: "content_generation" });
  const raw = String(result.summary || "").trim();
  const output = forcedTitle ? rewriteH1Title(normalizeGeneratedMarkdown(raw, facts.images || {}, domain), forcedTitle) : normalizeGeneratedMarkdown(raw, facts.images || {}, domain);
  writeFileSync(resolve(outputRoot, "final", `${combo.id}.md`), output, "utf8");

  const quality = output ? articleQualityIssues(output, facts.text, facts.images || {}, [], domain) : ["empty_output"];
  const themeCounts: Row = {};
  for (const [name, re] of Object.entries(THEMES)) themeCounts[name] = (output.match(re) || []).length;
  const headings = (output.match(/^##\s+.+$/gm) || []).map((h) => h.replace(/^##\s+/, ""));
  const rec = { id: combo.id, label: combo.label, persona: combo.persona, modifiers: [combo.modifier_1, combo.modifier_2], ok: Boolean(result.ok && output), chars: output.length, durationSec: result.duration_sec, hardFailures: quality, themeCounts, headings };
  writeFileSync(resolve(outputRoot, "quality", `${combo.id}.json`), JSON.stringify(rec, null, 2), "utf8");
  summary.push(rec);
  console.log(`  -> ok=${rec.ok} chars=${rec.chars} dur=${Math.round(result.duration_sec)}s themes=${JSON.stringify(themeCounts)} fails=${quality.length}`);
}

writeFileSync(resolve(outputRoot, "summary.json"), JSON.stringify({ region, provider, model, academyCount: facts.academyCount, combos: summary }, null, 2), "utf8");
console.log(`\n[done] ${outputRoot}`);
