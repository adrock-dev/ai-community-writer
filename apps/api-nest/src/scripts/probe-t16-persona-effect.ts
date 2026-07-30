// T16 의 persona 축이 실제로 글을 다르게 만드는지 재는 probe.
//
// 배경: T16 의 축 조합 공간은 175만 개(persona 31 × intent 5 × modifier 쌍 15 × 토픽 753)인데
// 후보 생성 상한은 그 1.7% 만 만든다. 상한을 올릴 가치가 있으려면 **축 값이 실제로 다른 글을
// 만들어야** 한다. persona 가 31개나 되는데 서로 비슷한 글을 만든다면 공간을 키워도 같은 글이 늘 뿐이다.
//
// LLM 을 부르지 않고 두 층을 잰다.
//   (1) 어휘 겹침 — persona 문자열끼리 얼마나 겹치는가. 겹치면 애초에 구분될 수 없다.
//   (2) 프롬프트 영향력 — 같은 슬롯에서 persona 만 바꿨을 때 프롬프트가 몇 글자 달라지는가.
//       persona 가 글에 미칠 수 있는 영향의 **상한**이다(실제 영향은 이보다 작다).
//
// 프롬프트 조립은 dump-t01-prompt.ts 와 같은 순서를 따른다 — buildPrompt 만 부르면 T16 전용
// 계약·구조·문체 지침이 통째로 빠져 persona 영향이 실제보다 작게 나온다(실제로 그렇게 잘못 쟀었다).
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DbService } from "../db.service.js";
import { getArchetype, structureGuideForArchetype } from "../archetypes.js";
import { resolveTemplateDirection } from "../axis-tags.js";
import { TITLE_RULES } from "../constants.js";
import { legacyPlusArticlePatternGuide, legacyPlusDesignGuide } from "../t01-legacy-plus.js";
import { buildT16AxisPlan, t16FactsForPrompt, t16PromptContract, t16ReviewPromptInstruction, t16StructureGuide, t16ToneFromDirection, t16WritingGuide } from "../t16-axis-comparison.js";
import { buildPrompt, effectiveGenerationTitle, readerFacingModifierLabels, resolveGenerationDesign, resolveTitleFromRule } from "../worker.service.js";

type Row = Record<string, any>;

const args = new Map(process.argv.slice(2).flatMap((v, i, all) => (v.startsWith("--") ? [[v.slice(2), all[i + 1] || ""]] : [])));
const dbPath = resolve(args.get("db") || "data/admin.db");
const domain = args.get("domain") || "app.drivingplus.me";
const templateId = args.get("template") || "T16";

const readonly = new DatabaseSync(dbPath, { readOnly: true });
const db = new DbService();
(db as any).db = readonly;
const domainMetaOrNull = db.getDomain(domain);
if (!domainMetaOrNull) throw new Error(`domain not found: ${domain}`);
// 함수 안에서 쓰므로 좁혀진 값을 따로 잡아 둔다(클로저로는 narrowing 이 안 따라간다).
const domainMeta: Row = domainMetaOrNull;

const templateSpec: Row = db.getTemplateSpec(domain, templateId) || {};
const designTemplateId = resolveGenerationDesign(undefined, domainMeta, templateId, templateSpec.default_design);
const archetype = getArchetype(templateSpec.kind ?? "");
const templateDirection = resolveTemplateDirection(templateSpec as any, undefined);
const worker: any = new (await import("../worker.service.js")).WorkerService(db, {} as never);
const academyTypes: string[] = worker.resolveAcademyTypes(templateSpec);

const personas: string[] = (templateSpec.axis_values?.persona ?? []).map((p: any) => String(p?.value ?? p)).filter(Boolean);
if (!personas.length) throw new Error(`${templateId} 에 persona 축 값이 없다`);

// 실제 슬롯을 쓴다 — 시드가 후보 표본·구조 변형을 정하므로 합성 슬롯은 다른 글이 된다.
// 학원이 많은 지역일수록 facts 가 두꺼워 persona 가 개입할 여지도 커진다(persona 에 유리한 조건).
const slotRow = readonly
  .prepare(
    `SELECT s.* FROM slots s
       JOIN (SELECT region, COUNT(*) n FROM academies WHERE domain=? GROUP BY region) a ON a.region = s.region
      WHERE s.domain=? AND s.template_id=? ORDER BY a.n DESC LIMIT 1`,
  )
  .get(domain, domain, templateId) as Row | undefined;
if (!slotRow) throw new Error("슬롯을 찾지 못했다");
const slot: Row = slotRow;

const facts = worker.buildFacts(domain, slot, { maxAcademyImages: 5, perAcademyImages: 1 }, academyTypes, archetype);
const academyKeys = Object.keys(facts.images);
const factsText = [
  facts.text,
  [
    academyKeys.length ? `학원 사진 슬롯: ${academyKeys.map((k) => `[IMAGE:${k}]`).join(", ")} / 각 사진(academy_N)은 그 N번째 후보(학원/시험장)를 소개하는 카드 안에 배치한다. 특정 대상을 소개하지 않는 일반 문단에는 넣지 않는다.` : "",
    "제공된 이미지 슬롯만 어울리는 위치에 배치하고, 없는 키나 임의 플레이스홀더는 만들지 않는다.",
  ].filter(Boolean).join("\n"),
].filter(Boolean).join("\n\n");

/** dump-t01-prompt.ts 의 T16 분기와 동일한 조립. persona 만 갈아끼운다. */
function promptFor(persona: string): string {
  const s: Row = { ...slot, persona };
  const plan = buildT16AxisPlan(s, facts.academies);
  const titleCtx = { region: String(s.region), count: facts.academyCount, keyword: String(s.primary_keyword), academyName: facts.firstAcademyName, subtitle: plan?.subtitle };
  const forcedTitle = effectiveGenerationTitle(s.title, resolveTitleFromRule((templateSpec.title_rule ?? (TITLE_RULES as any)[templateId]) as any, titleCtx).title, titleCtx);
  const options = {
    structureGuide: t16StructureGuide(structureGuideForArchetype(archetype, String(s.slot_id ?? "")), plan),
    writingGuide: t16WritingGuide(s, t16ToneFromDirection(templateDirection)),
    articlePatternGuide: legacyPlusArticlePatternGuide(),
    designGuide: legacyPlusDesignGuide(),
    modifierLabels: readerFacingModifierLabels(s),
    reviewInstruction: t16ReviewPromptInstruction(),
    cardIntro: "fact_first" as const,
    readerFlow: true, t01Comparison: true,
  };
  const base = buildPrompt(domainMeta, s, t16FactsForPrompt(factsText, facts.academies), designTemplateId, archetype, templateDirection, academyTypes.length > 0, forcedTitle, options);
  return `${base}\n\n${t16PromptContract(plan, s, facts.academyCount)}`;
}

// ---------- (1) persona 문자열끼리의 어휘 겹침 ----------
// 형태소 분석 없이 2-gram 자카드로 잰다. "집과 가까운 학원을 찾는 수강생" 류의 같은 틀을 찾는 게 목적이라 충분하다.
const bigrams = (s: string): Set<string> => {
  const t = s.replace(/\s+/g, "");
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
};
const jaccard = (a: Set<string>, b: Set<string>): number => {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter || 1);
};
const grams = personas.map(bigrams);
const pairs: Array<{ a: string; b: string; sim: number }> = [];
for (let i = 0; i < personas.length; i++)
  for (let j = i + 1; j < personas.length; j++) pairs.push({ a: personas[i]!, b: personas[j]!, sim: jaccard(grams[i]!, grams[j]!) });
pairs.sort((x, y) => y.sim - x.sim);

console.log(`[${templateId}] persona ${personas.length}개 · 슬롯 ${slot.slot_id} · 지역 "${slot.region}"`);
console.log();
console.log("=== (1) persona 끼리 어휘가 얼마나 겹치나 (2-gram 자카드) ===");
console.log(`  쌍 ${pairs.length}개 · 평균 ${(pairs.reduce((s, p) => s + p.sim, 0) / pairs.length).toFixed(3)}`);
console.log(`  0.5 이상(사실상 같은 말) ${pairs.filter((p) => p.sim >= 0.5).length}쌍 · 0.3 이상(상당히 겹침) ${pairs.filter((p) => p.sim >= 0.3).length}쌍`);
for (const p of pairs.slice(0, 8)) console.log(`    ${p.sim.toFixed(2)}  "${p.a}"  ↔  "${p.b}"`);

// ---------- (2) persona 가 프롬프트를 얼마나 바꾸나 ----------
const prompts = personas.map((p) => ({ persona: p, text: promptFor(p) }));
const lineSets = prompts.map((p) => new Set(p.text.split("\n")));
const common = [...lineSets[0]!].filter((line) => lineSets.every((s) => s.has(line)));
const commonChars = common.join("\n").length;
const avgChars = prompts.reduce((s, p) => s + p.text.length, 0) / prompts.length;

console.log();
console.log("=== (2) persona 만 바꿨을 때 프롬프트가 얼마나 달라지나 ===");
console.log(`  학원 ${facts.academyCount}곳 · facts ${facts.text.length}자 · 프롬프트 평균 ${Math.round(avgChars)}자`);
console.log(`  persona 무관 공통: ${commonChars}자 (${((commonChars / avgChars) * 100).toFixed(1)}%)`);
console.log(`  persona 에 따라 달라짐: ${Math.round(avgChars - commonChars)}자 (${(((avgChars - commonChars) / avgChars) * 100).toFixed(1)}%)`);
const differing = prompts[0]!.text.split("\n").filter((line) => !lineSets.every((s) => s.has(line)));
console.log(`  달라지는 줄 ${differing.length}개:`);
for (const line of differing) console.log(`    · ${line.slice(0, 220)}${line.length > 220 ? "…" : ""}`);

readonly.close();
