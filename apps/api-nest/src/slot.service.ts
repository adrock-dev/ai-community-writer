import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { DbService, safeJson } from "./db.service.js";
import { PRESETS, TEMPLATE_SPECS, VERTICAL_TO_PRESET, type AxisName } from "./constants.js";
import { filterExcludedSlots } from "./exclusions.js";
import { filterAxisValues, resolveAcceptedTags, resolveRecipeFlags, safeTemplateOverrides } from "./axis-tags.js";
import { getArchetypeForTemplate, buildKeyword } from "./archetypes.js";

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
    const overrides = safeTemplateOverrides(domainConfig.template_overrides);
    const summary: Record<string, number> = {};
    const rows: Row[] = [];

    for (const tid of templateIds) {
      const spec = (TEMPLATE_SPECS as Record<string, any>)[tid];
      if (!spec) continue;
      const archetype = getArchetypeForTemplate(tid);
      // 주축(region/keyword)은 아키타입이 소유. 미상 유형은 글유형 선언값으로 폴백.
      const primaryAxis = (archetype?.primary ?? spec.primary[0]) as AxisName;
      const primaryValues = axes[primaryAxis] || [];
      if (!primaryValues.length) { summary[tid] = 0; continue; }
      // 글유형 수용 태그로 축 값을 부분집합화한다. 부합 값이 없으면 해당 축을 생략(null)해 미스매치를 피한다.
      const personaPool = filterAxisValues("persona", axes.persona, resolveAcceptedTags(tid, "persona", overrides));
      const intentPool = filterAxisValues("intent", axes.intent, resolveAcceptedTags(tid, "intent", overrides));
      const modifierPool = filterAxisValues("modifier", axes.modifier, resolveAcceptedTags(tid, "modifier", overrides));
      // 레시피 파라미터(use_persona/with_intent/modifier_count)는 상수 기본값 + 도메인 오버라이드.
      const recipe = resolveRecipeFlags(tid, overrides);
      const personaValues = recipe.use_persona ? (personaPool.length ? personaPool : [{ value: null }]) : [{ value: null }];
      const intentValues = recipe.with_intent ? (intentPool.length ? intentPool : [{ value: null }]) : [{ value: null }];
      const modifierCombos = modifierPairs(modifierPool, recipe.modifier_count);
      const candidatesByPrimary: Row[][] = [];
      for (const pv of primaryValues) {
        // 주키워드 생성은 아키타입 인터프리터로 통합됨(archetypes.ts). axes.keyword 는 listAxes 정렬(weight DESC).
        const primaryKeyword = archetype ? buildKeyword(archetype, String(pv.value || ""), axes.keyword) : "";
        if (!primaryKeyword) continue;
        const sv = numberOrNull(pv.monthly_search_volume);
        if (sv !== null && sv < spec.min_sv) continue;
        const primaryRows: Row[] = [];
        for (const persona of personaValues) for (const intent of intentValues) for (const [m1, m2] of modifierCombos) {
          const parts = [pv.value || "", persona.value || "", intent.value || "", m1 || "", m2 || ""];
          primaryRows.push({
            slot_id: slotId(domain, tid, parts), domain: domain, template_id: tid, primary_keyword: primaryKeyword,
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
    const filtered = filterExcludedSlots(rows, domainConfig.excluded_keywords);
    summary._excluded_total = filtered.excluded.length;
    summary._inserted_total = this.db.bulkUpsertSlots(filtered.kept);
    return summary;
  }
}

// 주키워드 생성 로직은 archetypes.ts (buildKeyword) 로 통합 이전됨.

// slot_id 해시에 domain을 포함한다. slots PK는 전역 slot_id 이므로, domain을 빼면
// 같은 프리셋을 쓰는 다른 도메인끼리 slot_id가 충돌해 두 번째 도메인 슬롯이 유실된다.
// 같은 도메인 재생성 시에는 동일 조합→동일 id 로 idempotency 를 유지한다.
function slotId(domain: string, templateId: string, parts: string[]): string {
  const h = createHash("sha1").update([domain, templateId, ...parts].join("|")).digest("hex").slice(0, 8);
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
