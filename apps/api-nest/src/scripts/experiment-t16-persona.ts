// T16 persona 통제 실험 — 지역·키워드·intent·수식어를 고정하고 persona 만 바꿔 글을 생성·비교한다.
// skew-axis-experiment.ts(T01 의 persona×수식어 겹침 검증)의 T16 판이다.
//
// 왜 필요했나: T16 의 축 조합 공간은 175만 개인데 후보 생성 상한은 그 1.7% 만 만든다.
// 상한을 올릴 가치가 있으려면 축 값이 실제로 다른 글을 만들어야 한다는 판단이 먼저 필요했다.
// probe-t16-persona-effect.ts 가 "프롬프트가 얼마나 달라지나"(=영향의 상한)를 재고,
// 이 스크립트가 "실제로 다른 글이 나오나"를 잰다.
//
// **설계의 핵심은 대조군이다.** 같은 persona 로 두 번 생성해 LLM 자체의 변동폭을 먼저 잰다.
// 그 변동폭보다 persona 간 차이가 크지 않으면 "persona 가 글을 바꿨다"고 말할 수 없다.
// 대조군 없이 "글이 서로 다르다"만 보면 LLM 의 무작위성을 축 효과로 오독하게 된다.
//
// 2026-07-30 실측 결과(경기도 용인시 처인구·학원 5곳·persona 6종):
//   도입부   대조군 0.227 vs 다른 persona 0.157 → persona 효과 있음
//   본문산문 대조군 0.493 vs 다른 persona 0.476 → 구분 안 됨(LLM 변동폭 수준)
//   테마이동 야간반 persona 는 비용 언급 17→5회, 방학단기는 기간 13.5→28회, 보호자는 자녀 0→9회
// 즉 persona 는 도입·강조점을 바꾸지만 본문 대부분(학원 카드·표·과정 설명)은 facts 가 정한다.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DbService } from "../db.service.js";
import { getArchetype, structureGuideForArchetype } from "../archetypes.js";
import { resolveTemplateDirection } from "../axis-tags.js";
import { TITLE_RULES } from "../constants.js";
import { runLlm } from "../llm-runner.js";
import { legacyPlusArticlePatternGuide, legacyPlusDesignGuide } from "../t01-legacy-plus.js";
import { buildT16AxisPlan, normalizeT16ReviewAttribution, t16FactsForPrompt, t16PromptContract, t16ReviewPromptInstruction, t16StructureGuide, t16ToneFromDirection, t16WritingGuide } from "../t16-axis-comparison.js";
import { buildPrompt, effectiveGenerationTitle, normalizeGeneratedMarkdown, readerFacingModifierLabels, resolveGenerationDesign, resolveTitleFromRule, rewriteH1Title, WorkerService } from "../worker.service.js";

type Row = Record<string, any>;
const args = new Map(process.argv.slice(2).flatMap((v, i, all) => (v.startsWith("--") ? [[v.slice(2), all[i + 1] || ""]] : [])));
const dbPath = resolve(args.get("db") || "data/admin.db");
const domain = args.get("domain") || "app.drivingplus.me";
const templateId = args.get("template") || "T16";
const provider = args.get("provider") || "codex";
const timeoutSec = Number(args.get("timeout")) || 900;
// --analyze <dir> 를 주면 생성 없이 기존 결과만 다시 분석한다(LLM 비용 0).
const analyzeOnly = args.get("analyze") || "";

// ---------- 비교 지표 ----------
/**
 * 도입 = H1 이후 첫 산문 3단락.
 * "첫 ## 이전"으로 잡으면 안 된다 — 도입을 H2 섹션 안에 넣는 글과 H1 직후에 두는 글이 섞여 있어
 * (같은 persona 로 두 번 돌린 결과조차 갈렸다) 한쪽 도입이 빈 문자열이 되고 유사도가 0으로 튄다.
 */
function intro(markdown: string): string {
  const out: string[] = [];
  for (const line of markdown.split("\n")) {
    const t = line.trim();
    if (!t || /^#{1,6}\s/.test(t) || /^\|/.test(t) || /^!\[/.test(t) || /^[-*]\s/.test(t) || /^>/.test(t)) continue;
    out.push(t);
    if (out.length >= 3) break;
  }
  return out.join("\n");
}
/** 표·카드·이미지는 facts 에서 그대로 오므로 persona 와 무관하게 같다. 산문만 남겨 비교한다. */
function prose(markdown: string): string {
  return markdown.split("\n").filter((l) => !/^\s*\|/.test(l) && !/^\s*!\[/.test(l) && !/^\s*#{1,6}\s/.test(l) && !/^\s*[-*]\s/.test(l)).join("\n");
}
function bigrams(s: string): Set<string> {
  const t = s.replace(/\s+/g, "");
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}
function similarity(a: string, b: string): number {
  const A = bigrams(a), B = bigrams(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter || 1);
}
const THEMES: Record<string, RegExp> = {
  비용: /비용|수강료|가격|요금|만\s*원/g, 셔틀: /셔틀/g, 야간_주말: /야간|주말|퇴근|직장/g,
  기간_단기: /단기|방학|빠르게|기간|일정/g, 코스_시설: /코스|시험장|장내|기능|주행/g, 자녀_보호자: /자녀|아이|부모|보호자/g,
};

/** 대조군(같은 persona 2회)과 비교해 판정한다. 대조군이 없으면 판정하지 않는다. */
function report(dir: string): void {
  const docs = new Map<string, string>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) docs.set(f.replace(/\.md$/, ""), readFileSync(resolve(dir, f), "utf8"));
  const ids = [...docs.keys()].sort();
  if (!ids.length) { console.log("결과 파일이 없다"); return; }
  const control = ids.filter((i) => i.endsWith("-repeat"));

  for (const [label, pick] of [["도입부", intro], ["본문 산문(표·목록 제외)", prose]] as Array<[string, (s: string) => string]>) {
    console.log(`\n=== ${label} 유사도 (2-gram 자카드 · 높을수록 비슷) ===`);
    console.log("        " + ids.map((i) => i.padStart(11)).join(""));
    for (const a of ids) console.log(a.padEnd(8) + ids.map((b) => (a === b ? "-" : similarity(pick(docs.get(a)!), pick(docs.get(b)!)).toFixed(3))).map((s) => s.padStart(11)).join(""));
    const base = control.length ? similarity(pick(docs.get(control[0]!.replace("-repeat", ""))!), pick(docs.get(control[0]!)!)) : null;
    const cross: number[] = [];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        if (ids[j]!.replace("-repeat", "") === ids[i]!.replace("-repeat", "")) continue; // 대조군 쌍 제외
        cross.push(similarity(pick(docs.get(ids[i]!)!), pick(docs.get(ids[j]!)!)));
      }
    const mean = cross.reduce((s, v) => s + v, 0) / (cross.length || 1);
    console.log(`  대조군(같은 persona 2회): ${base === null ? "없음" : base.toFixed(3)}`);
    console.log(`  다른 persona 쌍 평균:     ${mean.toFixed(3)}  (최소 ${Math.min(...cross).toFixed(3)} · 최대 ${Math.max(...cross).toFixed(3)})`);
    if (base !== null) {
      const gap = base - mean;
      console.log(`  차이: ${gap >= 0 ? "+" : ""}${gap.toFixed(3)} → ${gap > 0.03 ? "persona 가 글을 바꿨다" : gap < -0.03 ? "역전 — persona 로 설명 안 됨" : "구분 안 됨(LLM 변동폭 수준)"}`);
    }
  }

  console.log("\n=== 테마 어휘 빈도 ===");
  console.log("            " + Object.keys(THEMES).map((t) => t.padStart(10)).join(""));
  const count = (id: string, re: RegExp) => (docs.get(id)!.match(re) || []).length;
  for (const id of ids) console.log(id.padEnd(12) + Object.values(THEMES).map((re) => String(count(id, re)).padStart(10)).join(""));

  if (control.length) {
    const a = control[0]!.replace("-repeat", ""), b = control[0]!;
    console.log("\n=== 테마 이동이 잡음(대조군 편차)보다 큰가 ===");
    for (const [theme, re] of Object.entries(THEMES)) {
      const noise = Math.abs(count(a, re) - count(b, re));
      const mid = (count(a, re) + count(b, re)) / 2;
      const hits = ids.filter((i) => i !== a && i !== b).map((i) => ({ i, d: count(i, re) - mid })).filter((x) => Math.abs(x.d) > Math.max(noise, 2));
      console.log(`  ${theme.padEnd(10)} 잡음바닥 ±${noise} · 기준 ${mid.toFixed(1)} → ${hits.length ? hits.map((x) => `${x.i} ${x.d > 0 ? "+" : ""}${x.d.toFixed(1)}`).join(", ") : "넘어선 것 없음"}`);
    }
  }
  console.log(`\n글자 수: ${ids.map((i) => `${i} ${docs.get(i)!.length}`).join(" · ")}`);
}

if (analyzeOnly) { report(resolve(analyzeOnly)); process.exit(0); }

// ---------- 생성 ----------
const readonly = new DatabaseSync(dbPath, { readOnly: true });
const db = new DbService();
(db as any).db = readonly;
const domainMeta: Row | undefined = db.getDomain(domain);
if (!domainMeta) throw new Error(`domain not found: ${domain}`);
const meta: Row = domainMeta;
const spec: Row = db.getTemplateSpec(domain, templateId) || {};
const archetype = getArchetype(spec.kind ?? "");
const templateDirection = resolveTemplateDirection(spec as any, undefined);
const worker: any = new WorkerService(db, {} as never);
const academyTypes: string[] = worker.resolveAcademyTypes(spec);
const design = resolveGenerationDesign(undefined, meta, templateId, spec.default_design);

const allPersonas: string[] = (spec.axis_values?.persona ?? []).map((p: any) => String(p?.value ?? p)).filter(Boolean);
// 기본은 의미 축이 서로 먼 6종. --personas 로 바꿀 수 있다(쉼표 구분).
const personas = (args.get("personas") || "").trim()
  ? args.get("personas")!.split(",").map((s) => s.trim()).filter(Boolean)
  : allPersonas.slice(0, Number(args.get("count")) || 6);
if (personas.length < 2) throw new Error("persona 가 2종 이상 필요하다");

// 학원이 가장 많은 지역의 실제 슬롯 — facts 가 두꺼울수록 persona 가 개입할 여지가 크다.
const regionArg = args.get("region") || "";
const slotBase = (regionArg
  ? readonly.prepare("SELECT * FROM slots WHERE domain=? AND template_id=? AND region=? LIMIT 1").get(domain, templateId, regionArg)
  : readonly.prepare(
      `SELECT s.* FROM slots s JOIN (SELECT region, COUNT(*) n FROM academies WHERE domain=? GROUP BY region) a ON a.region=s.region
        WHERE s.domain=? AND s.template_id=? ORDER BY a.n DESC LIMIT 1`,
    ).get(domain, domain, templateId)) as Row | undefined;
if (!slotBase) throw new Error("슬롯을 찾지 못했다");

const facts = worker.buildFacts(domain, slotBase, { maxAcademyImages: 5, perAcademyImages: 1 }, academyTypes, archetype);
const academyKeys = Object.keys(facts.images);
const factsText = [
  facts.text,
  [
    academyKeys.length ? `학원 사진 슬롯: ${academyKeys.map((k) => `[IMAGE:${k}]`).join(", ")} / 각 사진(academy_N)은 그 N번째 후보(학원/시험장)를 소개하는 카드 안에 배치한다. 특정 대상을 소개하지 않는 일반 문단에는 넣지 않는다.` : "",
    "제공된 이미지 슬롯만 어울리는 위치에 배치하고, 없는 키나 임의 플레이스홀더는 만들지 않는다.",
  ].filter(Boolean).join("\n"),
].filter(Boolean).join("\n\n");

const outputRoot = resolve(args.get("output") || `data/content-generation-evaluation/t16-persona-${String(slotBase.slot_id)}`);
mkdirSync(outputRoot, { recursive: true });

console.log(`[setup] 지역="${slotBase.region}" 학원 ${facts.academyCount}곳 · intent=${slotBase.intent} · 수식어=${slotBase.modifier_1}/${slotBase.modifier_2}`);
console.log(`[setup] persona ${personas.length}종 + 대조군 1 = ${personas.length + 1}건 · provider=${provider}`);
console.log(`[setup] 출력 ${outputRoot}\n`);

// 마지막은 첫 persona 반복 = 대조군.
const runs = [...personas.map((p, i) => ({ id: `p${i + 1}`, persona: p })), { id: "p1-repeat", persona: personas[0]! }];
for (const run of runs) {
  const slot: Row = { ...slotBase, persona: run.persona };
  const plan = buildT16AxisPlan(slot, facts.academies);
  const titleCtx = { region: String(slot.region), count: facts.academyCount, keyword: String(slot.primary_keyword), academyName: facts.firstAcademyName, subtitle: plan?.subtitle };
  const forcedTitle = effectiveGenerationTitle(slot.title, resolveTitleFromRule((spec.title_rule ?? (TITLE_RULES as any)[templateId]) as any, titleCtx).title, titleCtx);
  const options = {
    structureGuide: t16StructureGuide(structureGuideForArchetype(archetype, String(slot.slot_id ?? "")), plan),
    writingGuide: t16WritingGuide(slot, t16ToneFromDirection(templateDirection)),
    articlePatternGuide: legacyPlusArticlePatternGuide(),
    designGuide: legacyPlusDesignGuide(),
    modifierLabels: readerFacingModifierLabels(slot),
    reviewInstruction: t16ReviewPromptInstruction(),
    cardIntro: "fact_first" as const,
    readerFlow: true, t01Comparison: true,
  };
  const base = buildPrompt(meta, slot, t16FactsForPrompt(factsText, facts.academies), design, archetype, templateDirection, academyTypes.length > 0, forcedTitle, options);
  const prompt = `${base}\n\n${t16PromptContract(plan, slot, facts.academyCount)}`;

  process.stdout.write(`[${run.id}] "${run.persona}" 생성 중... `);
  const result = await runLlm(prompt, { provider, model: args.get("model") || "", timeoutSec, executionProfile: "content_generation" });
  const raw = String(result.summary || "").trim();
  let markdown = normalizeGeneratedMarkdown(raw, facts.images || {}, domain);
  if (forcedTitle) markdown = rewriteH1Title(markdown, forcedTitle);
  markdown = normalizeT16ReviewAttribution(markdown);
  console.log(`ok=${Boolean(result.ok && markdown)} ${markdown.length}자 ${Math.round(result.duration_sec)}초`);
  writeFileSync(resolve(outputRoot, `${run.id}.md`), markdown, "utf8");
}
readonly.close();
report(outputRoot);
console.log(`\n[done] ${outputRoot}`);
