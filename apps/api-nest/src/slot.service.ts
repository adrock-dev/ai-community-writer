import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { DbService, safeJson } from "./db.service.js";
import { PRESETS, TEMPLATE_SPECS, VERTICAL_TO_PRESET, type AxisName } from "./constants.js";

type Row = Record<string, any>;

@Injectable()
export class SlotService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  applyPreset(domain: string, key: string): Record<string, number> {
    const presetKey = VERTICAL_TO_PRESET[key] || key;
    const preset = PRESETS[presetKey];
    if (!preset) return {};
    const summary: Record<string, number> = {};
    for (const [axis, values] of Object.entries(preset) as [AxisName, Row[]][]) {
      if (!values.length) continue;
      this.db.bulkReplaceAxis(domain, axis, values);
      summary[axis] = values.length;
    }
    return summary;
  }

  generateSlotsForDomain(domain: string, opts: { templates?: string[]; maxPerTemplate?: number; seed?: number } = {}): Record<string, number> {
    const domainConfig = this.db.getDomain(domain);
    if (!domainConfig) throw new Error(`unknown domain: ${domain}`);
    const axes = this.db.listAxes(domain);
    const enabled = opts.templates?.length ? opts.templates : safeJson(domainConfig.templates_enabled, []);
    const templateIds = enabled.length ? enabled : Object.keys(TEMPLATE_SPECS);
    const maxPerTemplate = opts.maxPerTemplate ?? 200;
    const summary: Record<string, number> = {};
    const rows: Row[] = [];

    for (const tid of templateIds) {
      const spec = (TEMPLATE_SPECS as Record<string, any>)[tid];
      if (!spec) continue;
      const primaryAxis = spec.primary[0] as AxisName;
      const primaryValues = axes[primaryAxis] || [];
      if (!primaryValues.length) { summary[tid] = 0; continue; }
      const personaValues = spec.use_persona ? (axes.persona.length ? axes.persona : [{ value: null }]) : [{ value: null }];
      const intentValues = spec.with_intent ? (axes.intent.length ? axes.intent : [{ value: null }]) : [{ value: null }];
      const modifierCombos = modifierPairs(axes.modifier, spec.modifier_count);
      const candidatesByPrimary: Row[][] = [];
      for (const pv of primaryValues) {
        let primaryKeyword = buildPrimaryKeyword(tid, spec, pv, axes);
        if (!primaryKeyword) continue;
        if (tid === "T01" || tid === "T07" || tid === "T14" || tid === "T15") {
          const kw = chooseKeywordForTemplate(tid, axes.keyword);
          if (!kw) continue;
          primaryKeyword = formatRegionKeyword(pv.value, kw.value);
        }
        const sv = numberOrNull(pv.monthly_search_volume);
        if (sv !== null && sv < spec.min_sv) continue;
        const primaryRows: Row[] = [];
        for (const persona of personaValues) for (const intent of intentValues) for (const [m1, m2] of modifierCombos) {
          const parts = [pv.value || "", persona.value || "", intent.value || "", m1 || "", m2 || ""];
          primaryRows.push({
            slot_id: slotId(tid, parts), domain: domain, template_id: tid, primary_keyword: primaryKeyword,
            region: primaryAxis === "region" ? pv.value : null, persona: persona.value ?? null, intent: intent.value ?? null,
            modifier_1: m1, modifier_2: m2, entity_id: null, priority_score: priority(sv, numberOrNull(pv.competition_kd), spec.weight)
          });
        }
        if (primaryRows.length) candidatesByPrimary.push(primaryRows);
      }
      const distributed = interleaveByPrimary(candidatesByPrimary, maxPerTemplate);
      rows.push(...distributed);
      summary[tid] = distributed.length;
    }
    rows.sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0));
    summary._inserted_total = this.db.bulkUpsertSlots(rows);
    return summary;
  }
}

function buildPrimaryKeyword(templateId: string, spec: Row, primaryValue: Row, axes: Record<AxisName, Row[]>): string {
  const value = String(primaryValue.value || "").trim();
  const kind = String(spec.kind || "");
  if (!value) return "";
  if (kind === "written_registration") return pickKeyword(axes.keyword, /필기시험.*접수|접수.*필기시험/u, "운전면허 필기시험 접수");
  if (kind === "written_tips") return pickKeyword(axes.keyword, /필기시험.*(?:팁|문제|공부|합격)/u, "운전면허 필기시험 팁");
  if (kind === "written_app") return pickKeyword(axes.keyword, /필기시험.*(?:어플|앱)/u, "운전면허 필기시험 어플");
  if (kind === "test_center") return formatRegionKeyword(value, "운전면허시험장");
  if (kind === "license_complete") return pickKeyword(axes.keyword, /취득|총정리|준비물/u, value);
  if (kind === "license_compare") return pickKeyword(axes.keyword, /1종|2종|대형|소형|종보통/u, value);
  if (kind === "cost_strategy") return pickKeyword(axes.keyword, /비용|가격|수강료|절약/u, value);
  if (kind === "exam_best") return pickKeyword(axes.keyword, /필기시험|기능시험|도로주행|시험/u, value);
  return value;
}

function chooseKeywordForTemplate(templateId: string, keywords: Row[]): Row | null {
  const patterns: Record<string, RegExp> = {
    T01: /운전면허학원|자동차학원/u,
    T07: /운전면허|운전면허학원/u,
    T14: /운전면허학원|자동차운전전문학원|자동차학원/u,
    T15: /필기시험|기능시험|도로주행|운전면허학원/u,
  };
  const pattern = patterns[templateId] || /./u;
  return keywords.find((kw) => pattern.test(String(kw.value || ""))) || keywords[0] || null;
}

function pickKeyword(keywords: Row[], pattern: RegExp, fallback: string): string {
  return String((keywords.find((kw) => pattern.test(String(kw.value || ""))) || {}).value || fallback);
}

function formatRegionKeyword(region: string, keyword: string): string {
  return `${String(region || "").trim()} ${String(keyword || "").trim()}`.replace(/\s+/g, " ").trim();
}

function slotId(templateId: string, parts: string[]): string {
  const h = createHash("sha1").update([templateId, ...parts].join("|")).digest("hex").slice(0, 8);
  return `${templateId}_${h}`;
}
function numberOrNull(v: any): number | null { const n = Number(v); return Number.isFinite(n) ? n : null; }
function priority(sv: number | null, kd: number | null, weight: number): number {
  const svNorm = Math.log10((sv ?? 0) + 1) / 4.5;
  const kdNorm = (100 - (kd ?? 50)) / 100;
  return Math.round(Math.min(Math.max((svNorm * 0.6 + kdNorm * 0.4) * weight * 100, 0), 100) * 100) / 100;
}
function modifierPairs(values: Row[], count: number): Array<[string | null, string | null]> {
  if (count === 0) return [[null, null]];
  if (count === 1) return values.length ? values.map((m) => [m.value, null]) : [[null, null]];
  if (values.length < 2) return [[values[0]?.value ?? null, null]];
  const out: Array<[string, string]> = [];
  for (let i = 0; i < values.length; i++) for (let j = i + 1; j < values.length; j++) out.push([values[i]!.value, values[j]!.value]);
  return out;
}

function interleaveByPrimary(groups: Row[][], limit: number): Row[] {
  const out: Row[] = [];
  const active = groups.filter((group) => group.length);
  for (let index = 0; out.length < limit && active.some((group) => index < group.length); index++) {
    for (const group of active) {
      const row = group[index];
      if (row) out.push(row);
      if (out.length >= limit) break;
    }
  }
  return out;
}
