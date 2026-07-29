/**
 * T01 슬롯이 실제로 LLM에 보내는 프롬프트를 그대로 덤프한다. LLM 호출·DB 쓰기 없음(읽기 전용).
 *
 * **worker.service.ts `processGenerate`(166~245줄)의 조립 순서를 그대로 따른다.**
 * 특히 모드 해석은 워커와 동일하게 `auto`에서 출발한다 — 관리자 UI 는 generation_mode 를
 * 보내지 않고 admin.controller 가 "auto"를 채우므로, **T01 의 실제 경로는 Legacy Plus 다.**
 * `--mode legacy` 는 API 로 명시했을 때만 도는 호환 경로를 보려는 경우에만 쓴다.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DbService } from "../db.service.js";
import { getArchetype } from "../archetypes.js";
import { resolveTemplateDirection } from "../axis-tags.js";
import { TITLE_RULES } from "../constants.js";
import {
  buildT01LegacyPlusContext, isT01TemplateFamily, legacyPlusAcademyPrinciples, legacyPlusArticlePatternGuide,
  legacyPlusDesignGuide, legacyPlusFactsForPrompt, legacyPlusFaqPromptInstruction, legacyPlusReviewPromptInstruction,
  legacyPlusStructureGuide, legacyPlusTemplateDirection, legacyPlusWritingGuide, resolveT01GenerationMode,
  shouldUseT01LegacyPlusMode, t01LegacyPlusPromptContract,
} from "../t01-legacy-plus.js";
import { buildPrompt, effectiveGenerationTitle, readerFacingModifierLabels, resolveGenerationDesign, resolveTitleFromRule } from "../worker.service.js";
import { structureGuideForArchetype } from "../archetypes.js";
import { buildT16AxisPlan, t16FactsForPrompt, t16ReviewPromptInstruction, t16PromptContract, t16StructureGuide, t16ToneFromDirection, t16WritingGuide } from "../t16-axis-comparison.js";

type Row = Record<string, any>;
const args = new Map(process.argv.slice(2).flatMap((v, i, all) => (v.startsWith("--") ? [[v.slice(2), all[i + 1] || ""]] : [])));
const dbPath = resolve(args.get("db") || "data/admin.db");
const domain = args.get("domain") || "app.drivingplus.me";
const region = args.get("region") || "전북특별자치도 익산시";
const templateId = args.get("template") || "T01";
const requestedMode = args.get("mode") || "auto";
const outPath = args.get("out") ? resolve(args.get("out")!) : "";

const readonly = new DatabaseSync(dbPath, { readOnly: true });
const db = new DbService();
(db as any).db = readonly;
const domainMeta = db.getDomain(domain);
if (!domainMeta) throw new Error(`domain not found: ${domain}`);

// --- worker.service.ts:167~186 과 동일한 해석 순서 ---
const templateSpec: Row = db.getTemplateSpec(domain, templateId) || {};
const isT01Family = isT01TemplateFamily(templateId, templateSpec.origin_template_id);
const effectiveMode = resolveT01GenerationMode(requestedMode, templateId, templateSpec.origin_template_id);
const designTemplateId = resolveGenerationDesign(undefined, domainMeta, templateId, templateSpec.default_design);
const archetype = getArchetype(templateSpec.kind ?? "");
const templateDirection = resolveTemplateDirection(templateSpec as any, undefined);

const worker: any = new (await import("../worker.service.js")).WorkerService(db, {} as never);
const academyTypes: string[] = worker.resolveAcademyTypes(templateSpec);

// 실제 슬롯을 쓴다(시드가 후보 표본·구조 변형을 결정하므로 합성 슬롯은 다른 글이 된다).
// 지역이 정확히 일치하는 슬롯만 쓴다. 없으면 합성 슬롯(축 빈값)으로 명시 폴백한다.
// template_id 만 맞는 아무 슬롯으로 폴백하면 다른 지역 후보를 뽑아 오해를 유발한다(김포 요청에 강릉 후보).
const slot: Row = db.get("SELECT * FROM slots WHERE domain=? AND template_id=? AND region=? LIMIT 1", [domain, templateId, region])
  ?? { slot_id: `dump-${templateId}-${region}`, template_id: templateId, region, primary_keyword: `${region} 운전면허학원`, persona: "", intent: "", modifier_1: "", modifier_2: "", title: null };

// --- worker.service.ts:187~196 ---
const facts = archetype?.academy_centric
  ? worker.buildFacts(domain, slot, { maxAcademyImages: 5, perAcademyImages: 1 }, academyTypes, archetype)
  : worker.buildFacts(domain, slot, { maxAcademyImages: 3, perAcademyImages: 1 }, academyTypes, archetype);
const isT16 = templateId === "T16" || templateSpec.kind === "local_axis";
const usePlus = !isT16 && shouldUseT01LegacyPlusMode(slot.template_id, effectiveMode, templateSpec.origin_template_id);
const t01Context = usePlus ? worker.buildT01DataGatedContext(domain, slot, academyTypes, archetype) : null;
const plus = t01Context ? buildT01LegacyPlusContext(t01Context, String(slot.slot_id ?? slot.id ?? `${slot.region}|${slot.primary_keyword ?? ""}`)) : null;

// --- worker.service.ts:198~202 ---
const titleRule = (templateSpec.title_rule ?? TITLE_RULES[templateId]) as any;
const t16Plan = isT16 ? buildT16AxisPlan(slot, facts.academies) : null;
const titleCtx = { region: String(slot.region || region), count: facts.academyCount, keyword: String(slot.primary_keyword), academyName: facts.firstAcademyName, subtitle: t16Plan?.subtitle };
const titleResolved = resolveTitleFromRule(titleRule, titleCtx);
const forcedTitle = effectiveGenerationTitle(slot.title, titleResolved.title, titleCtx);

// --- worker.service.ts:216~224 (이미지 생성 off → 생성 슬롯 없음) ---
const academyKeys = Object.keys(facts.images);
const factsText = [
  facts.text,
  [
    academyKeys.length ? `학원 사진 슬롯: ${academyKeys.map((k) => `[IMAGE:${k}]`).join(", ")} / 각 사진(academy_N)은 그 N번째 후보(학원/시험장)를 소개하는 카드 안에 배치한다. 특정 대상을 소개하지 않는 일반 문단에는 넣지 않는다.` : "",
    "제공된 이미지 슬롯만 어울리는 위치에 배치하고, 없는 키나 임의 플레이스홀더는 만들지 않는다.",
  ].filter(Boolean).join("\n"),
].filter(Boolean).join("\n\n");

// --- worker.service.ts:225~245 ---
const promptFactsText = plus ? legacyPlusFactsForPrompt(factsText) : t16Plan ? t16FactsForPrompt(factsText, facts.academies) : factsText;
const promptOptions = plus ? {
  structureGuide: legacyPlusStructureGuide(plus),
  writingGuide: legacyPlusWritingGuide(plus),
  articlePatternGuide: legacyPlusArticlePatternGuide(plus),
  designGuide: legacyPlusDesignGuide(),
  academyPrinciples: legacyPlusAcademyPrinciples(),
  modifierLabels: [slot.modifier_1, slot.modifier_2].filter((l: unknown): l is string => Boolean(l && !/^(?:가까운|근처)$/u.test(String(l).trim()))),
  reviewInstruction: legacyPlusReviewPromptInstruction(plus),
  faqInstruction: legacyPlusFaqPromptInstruction(),
  readerFlow: true,
  t01Comparison: true,
} : t16Plan ? {
  structureGuide: t16StructureGuide(structureGuideForArchetype(archetype, String(slot.slot_id ?? "")), t16Plan),
  writingGuide: t16WritingGuide(slot, t16ToneFromDirection(templateDirection)),
  articlePatternGuide: legacyPlusArticlePatternGuide(),
  designGuide: legacyPlusDesignGuide(),
  modifierLabels: readerFacingModifierLabels(slot),
  reviewInstruction: t16ReviewPromptInstruction(),
  cardIntro: "fact_first" as const,
  readerFlow: true, t01Comparison: true,
} : (isT01Family ? { t01Comparison: true } : undefined);
const effectiveDirection = plus ? legacyPlusTemplateDirection(plus) : templateDirection;
const base = buildPrompt(domainMeta, slot, promptFactsText, designTemplateId, archetype, effectiveDirection, academyTypes.length > 0, forcedTitle, promptOptions);
const contract = plus ? t01LegacyPlusPromptContract(plus) : t16Plan ? t16PromptContract(t16Plan, slot, facts.academyCount) : "";
const prompt = contract ? `${base}\n\n${contract}` : base;
readonly.close();

console.error(`[meta] tpl=${templateId} axis=${t16Plan ? `${t16Plan.modifier}/${t16Plan.intent}${t16Plan.demoted.length ? ` (강등: ${t16Plan.demoted.join(",")})` : ""}` : "-"} mode=${effectiveMode} slot=${slot.slot_id} region=${region} 후보=${facts.academyCount} 사진=${academyKeys.length} design=${designTemplateId} title="${forcedTitle}" chars=${prompt.length} (계약문 ${contract.length}자)`);
if (outPath) { writeFileSync(outPath, prompt, "utf8"); console.error(`[out] ${outPath}`); }
else console.log(prompt);
