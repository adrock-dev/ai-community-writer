import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { DbService, safeJson } from "./db.service.js";
import { PRESETS, TEMPLATE_SPECS, VERTICAL_TO_PRESET, type AxisName } from "./constants.js";
import { filterExcludedSlots } from "./exclusions.js";
import { resolveAcceptedTags, resolveAxisPool, resolveRecipeFlags, safeTemplateOverrides } from "./axis-tags.js";
import { getArchetype, buildKeyword } from "./archetypes.js";

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
      // 글유형 spec: 빌트인(상수)·커스텀(DB)을 동일 shape 로. 아키타입은 spec.kind 참조(커스텀 지원).
      const spec = this.db.getTemplateSpec(domain, tid);
      if (!spec) continue;
      const archetype = getArchetype(String(spec.kind || ""));
      const override = overrides[tid];
      // 주축(region/keyword)은 아키타입이 소유. 미상 유형은 keyword 로 폴백.
      const primaryAxis = (archetype?.primary ?? "keyword") as AxisName;
      const primaryValues = axes[primaryAxis] || [];
      if (!primaryValues.length) { summary[tid] = 0; continue; }
      // 글유형 수용 태그로 축 값을 부분집합화한다. 부합 값이 없으면 해당 축을 생략(null)해 미스매치를 피한다.
      // 프리셋(spec.axis_values) 있으면 도메인 풀 대체, 없으면 도메인 풀+태그필터 폴백.
      const personaPool = resolveAxisPool(spec, "persona");
      const intentPool = resolveAxisPool(spec, "intent");
      const modifierPool = resolveAxisPool(spec, "modifier");
      // 레시피 파라미터(use_persona/with_intent/modifier_count)는 spec 기본값 + 도메인 오버라이드.
      const recipe = resolveRecipeFlags(spec, override);
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

  // 레시피↔데이터 정합성 분석(읽기/계산 전용, 생성 미변경). 전 빌트인+커스텀 유형을 대상으로,
  // 생성 파이프라인과 동일한 pure 헬퍼(getTemplateSpec/getArchetype/resolveRecipeFlags/resolveAcceptedTags/
  // filterAxisValues/buildKeyword)로 "이 유형이 현재 데이터로 뭘 만들지"를 계산해 얇은/근거없는 조합을 사전 경고한다.
  analyzeCoherence(domain: string): Row {
    const domainConfig = this.db.getDomain(domain);
    if (!domainConfig) throw new Error(`unknown domain: ${domain}`);
    const axes = this.db.listAxes(domain);
    const overrides = safeTemplateOverrides(domainConfig.template_overrides);
    const enabledSet = new Set((safeJson(domainConfig.templates_enabled, []) as unknown[]).map((v) => String(v)));
    const academyRegions = this.db.academyRegionValues(domain);
    const ACADEMY_MIN_FOR_BEST = 2;

    const customRows = this.db.listCustomTemplates(domain);
    const customIdSet = new Set(customRows.map((r) => String(r.template_id)));
    const templateIds = [...Object.keys(TEMPLATE_SPECS), ...customRows.map((r) => String(r.template_id))];
    const taggedAxes: Array<"persona" | "intent" | "modifier"> = ["persona", "intent", "modifier"];

    const templates: Row[] = [];
    for (const tid of templateIds) {
      const spec = this.db.getTemplateSpec(domain, tid);
      if (!spec) continue;
      const archetype = getArchetype(String(spec.kind || ""));
      const override = overrides[tid];
      const primary = (archetype?.primary ?? "keyword") as AxisName;
      const primaryValues = axes[primary] || [];
      const recipe = resolveRecipeFlags(spec, override);
      const warnings: Array<{ level: string; code: string; message: string }> = [];

      // 축 풀(persona/intent/modifier): 레시피가 쓰는데 태그 필터 결과가 0이면 조용히 무시됨 = 원래 문제.
      const usedByAxis: Record<string, boolean> = { persona: recipe.use_persona, intent: recipe.with_intent, modifier: recipe.modifier_count > 0 };
      const poolSizes: Record<string, number> = { persona: 0, intent: 0, modifier: 0 };
      const axesReport: Row = {};
      for (const axis of taggedAxes) {
        const accepted = resolveAcceptedTags(spec, axis, override);
        const pool = resolveAxisPool(spec, axis);
        poolSizes[axis] = pool.length;
        axesReport[axis] = { used: usedByAxis[axis], accepted_tags: accepted, pool_size: pool.length, total: pool.length };
        if (usedByAxis[axis] && pool.length === 0) warnings.push({ level: "warn", code: `${axis}_pool_empty`, message: `${axis} 축을 쓰지만 이 글유형에 ${axis} 축 값이 없어(0) 조합에서 무시됩니다. 글유형 편집에서 값을 입력하세요.` });
      }

      // 키워드 규칙 매칭: pick/region_plus_pick 이 0이면 주키워드가 폴백(일반적)으로 생성됨.
      const keywordAxis = axes.keyword || [];
      const kr = archetype?.keyword_rule;
      let matched_keyword_count: number | null = null;
      if (kr) {
        if (kr.format === "plain") matched_keyword_count = keywordAxis.length;
        else if (kr.format === "pick" || kr.format === "region_plus_pick") matched_keyword_count = keywordAxis.filter((k) => kr.pattern.test(String(k.value || ""))).length;
      }
      if ((kr?.format === "pick" || kr?.format === "region_plus_pick") && keywordAxis.length > 0 && matched_keyword_count === 0) {
        warnings.push({ level: "warn", code: "keyword_rule_no_match", message: "키워드 규칙에 맞는 키워드가 없어 주키워드가 폴백(일반적)으로 생성됩니다." });
      }

      // 학원 데이터(academy_centric && region-primary): BEST/비교 근거 부족 위험.
      const academyApplicable = Boolean(archetype?.academy_centric) && primary === "region";
      let academy: Row;
      if (academyApplicable) {
        let withAny = 0, withMin = 0;
        for (const pv of primaryValues) {
          const value = String(pv.value || "").trim();
          if (!value) continue;
          const count = academyRegions.filter((ar) => ar.includes(value)).length;
          if (count >= 1) withAny++;
          if (count >= ACADEMY_MIN_FOR_BEST) withMin++;
        }
        academy = { applicable: true, regions_total: primaryValues.length, regions_with_academies: withAny, regions_with_min_for_best: withMin };
        if (withMin === 0) warnings.push({ level: "error", code: "no_academy_data_for_best", message: `학원 근거가 필요한 유형이지만 학원 ${ACADEMY_MIN_FOR_BEST}곳 이상인 지역이 없어 근거 없는 BEST가 될 위험이 큽니다.` });
        else if (withMin < primaryValues.length * 0.5) warnings.push({ level: "warn", code: "low_academy_coverage", message: `학원 데이터가 충분한 지역이 ${withMin}/${primaryValues.length} 뿐입니다.` });
      } else {
        academy = { applicable: false };
      }

      // 예상 슬롯 상한(rough): 생성 조합 규칙과 동일한 팩터로. 0 이면 이 유형은 슬롯을 못 만든다.
      let usablePrimary = 0;
      for (const pv of primaryValues) {
        const sv = Number(pv.monthly_search_volume);
        if (Number.isFinite(sv) && sv < spec.min_sv) continue;
        if (!archetype || buildKeyword(archetype, String(pv.value || ""), keywordAxis) === "") continue;
        usablePrimary++;
      }
      const personaFactor = recipe.use_persona && (poolSizes.persona ?? 0) > 0 ? (poolSizes.persona ?? 0) : 1;
      const intentFactor = recipe.with_intent && (poolSizes.intent ?? 0) > 0 ? (poolSizes.intent ?? 0) : 1;
      const mPool = poolSizes.modifier ?? 0;
      const modifierFactor = recipe.modifier_count === 0 ? 1 : recipe.modifier_count === 1 ? (mPool > 0 ? mPool : 1) : (mPool >= 2 ? (mPool * (mPool - 1)) / 2 : 1);
      const estimated_slot_upperbound = usablePrimary * personaFactor * intentFactor * modifierFactor;
      if (estimated_slot_upperbound === 0) warnings.push({ level: "error", code: "no_slots", message: "현재 축/키워드 데이터로 이 유형은 슬롯을 만들지 못합니다." });

      templates.push({
        template_id: tid, name: spec.name, kind: spec.kind, custom: customIdSet.has(tid), enabled: enabledSet.has(tid),
        primary_axis: primary, primary_value_count: primaryValues.length,
        keyword_rule: { format: kr?.format ?? null, matched_keyword_count, keyword_total: keywordAxis.length },
        axes: axesReport, academy, estimated_slot_upperbound, warnings,
      });
    }

    return { domain, thresholds: { academy_min_for_best: ACADEMY_MIN_FOR_BEST }, templates };
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
