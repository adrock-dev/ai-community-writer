import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { DbService, safeJson } from "./db.service.js";
import { ACADEMY_NEARBY_MAX_KM, PRESETS, TEMPLATE_SPECS, VERTICAL_TO_PRESET, type AxisName, type TemplateSpecShape } from "./constants.js";
import { filterExcludedSlots } from "./exclusions.js";
import { resolveAcceptedTags, resolveAxisPool, resolveRecipeFlags, safeTemplateOverrides } from "./axis-tags.js";
import { getArchetype, buildKeyword, type Archetype } from "./archetypes.js";

type Row = Record<string, any>;

@Injectable()
export class SlotService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  applyPreset(domain: string, key: string, onlyAxes?: AxisName[]): Record<string, number> {
    const presetKey = VERTICAL_TO_PRESET[key] || key;
    const preset = PRESETS[presetKey];
    if (!preset) return {};
    const summary: Record<string, number> = {};
    for (const [axis, values] of Object.entries(preset) as [AxisName, Row[]][]) {
      if (onlyAxes && !onlyAxes.includes(axis)) continue; // axes 필터: 지정된 축만 채운다(예 keyword 만).
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
    // 켜진 글유형이 없으면 슬롯을 만들지 않는다(전체 템플릿으로 폴백하지 않음 — 빈 상태는 0개 생성).
    const templateIds = enabled;
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
      // (a) 주제(topic) 결정 — keyword_filter 있으면 free 모드(그 키워드를 권위로 직접 사용 + primary_override 로 지역 결합 여부),
      //     없으면 아키타입 폴백 모드(keyword_rule 패턴 + archetype.primary). 폴백은 기존과 byte-동일 = 골든 0-diff.
      const topicUnits = buildTopicUnits(spec, archetype, axes);
      if (!topicUnits.length) { summary[tid] = 0; continue; }
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
      for (const topic of topicUnits) {
        const primaryRows: Row[] = [];
        for (const persona of personaValues) for (const intent of intentValues) for (const [m1, m2] of modifierCombos) {
          const parts = [topic.hashKey, persona.value || "", intent.value || "", m1 || "", m2 || ""];
          primaryRows.push({
            slot_id: slotId(domain, tid, parts), domain: domain, template_id: tid, primary_keyword: topic.primaryKeyword,
            region: topic.region, persona: persona.value ?? null, intent: intent.value ?? null,
            modifier_1: m1, modifier_2: m2, entity_id: null, priority_score: priority(topic.sv, topic.kd, spec.weight)
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
    // 학원(좌표 포함) 전체를 한 번 불러 글유형별 academy_types 로 필터 + 지역 좌표 맵으로 인근 계산.
    const allAcademies = this.db.listAcademies(domain, { limit: 100000 });
    const regionCoords = this.buildRegionCoords(domain);
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
      // (a) 생성과 동일 모델: keyword_filter 있으면 free 모드(primary_override), 없으면 아키타입 폴백.
      const kwFilterSet = (spec.keyword_filter ?? []).map((k) => String(k || "").trim()).filter(Boolean);
      const primary = ((kwFilterSet.length ? (spec.primary_override ?? archetype?.primary) : archetype?.primary) ?? "keyword") as AxisName;
      const topicUnits = buildTopicUnits(spec, archetype, axes);
      const regionValues = primary === "region" ? (axes.region || []) : [];
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

      // 키워드: free 모드(keyword_filter)면 그 키워드가 곧 사용 키워드, 폴백이면 아키타입 패턴 매칭.
      const keywordAxis = axes.keyword || [];
      const kr = archetype?.keyword_rule;
      let matched_keyword_count: number | null = null;
      if (kwFilterSet.length) matched_keyword_count = kwFilterSet.length;
      else if (kr) {
        if (kr.format === "plain") matched_keyword_count = keywordAxis.length;
        else if (kr.format === "pick" || kr.format === "region_plus_pick") matched_keyword_count = keywordAxis.filter((k) => kr.pattern.test(String(k.value || ""))).length;
      }
      if (!kwFilterSet.length && (kr?.format === "pick" || kr?.format === "region_plus_pick") && keywordAxis.length > 0 && matched_keyword_count === 0) {
        warnings.push({ level: "warn", code: "keyword_rule_no_match", message: "키워드 규칙에 맞는 키워드가 없어 주키워드가 폴백(일반적)으로 생성됩니다." });
      }

      // 학원 데이터(academy_centric && region-primary && academy_types 선택됨): BEST/비교 근거 부족 위험.
      // 생성(pickAcademiesForRegion)과 동일하게 글유형의 academy_types 로 학원을 거른다(빈 배열이면 학원정보 미사용).
      const academyTypes = (spec.academy_types ?? []).map((t: unknown) => String(t || "").trim()).filter(Boolean);
      const academyApplicable = Boolean(archetype?.academy_centric) && primary === "region" && academyTypes.length > 0;
      let academy: Row;
      if (academyApplicable) {
        // 생성과 동일하게 직접(region 문자열) + 인근(반경 ACADEMY_NEARBY_MAX_KM) 합으로 판정.
        const typeSet = new Set(academyTypes);
        const typed = allAcademies.filter((a) => typeSet.has(String(a.academy_type || "")));
        let withAny = 0, withMin = 0, directMin = 0;
        for (const pv of regionValues) {
          const value = String(pv.value || "").trim();
          if (!value) continue;
          const { direct, nearby } = this.matchRegionAcademies(value, typed, regionCoords.get(value));
          const count = direct.length + nearby.length;
          if (count >= 1) withAny++;
          if (count >= ACADEMY_MIN_FOR_BEST) withMin++;
          if (direct.length >= ACADEMY_MIN_FOR_BEST) directMin++;
        }
        academy = { applicable: true, academy_types: academyTypes, nearby_km: ACADEMY_NEARBY_MAX_KM, regions_total: regionValues.length, regions_with_academies: withAny, regions_with_min_for_best: withMin, regions_with_min_direct: directMin };
        if (withMin === 0) warnings.push({ level: "error", code: "no_academy_data_for_best", message: `학원 근거가 필요한 유형이지만 학원 ${ACADEMY_MIN_FOR_BEST}곳 이상인 지역이 없어(직접+인근 ${ACADEMY_NEARBY_MAX_KM}km) 근거 없는 BEST가 될 위험이 큽니다.` });
        else if (withMin < regionValues.length * 0.5) warnings.push({ level: "warn", code: "low_academy_coverage", message: `학원 데이터가 충분한 지역이 ${withMin}/${regionValues.length} 뿐입니다(직접+인근 ${ACADEMY_NEARBY_MAX_KM}km 반영).` });
      } else {
        academy = { applicable: false };
        // academy_centric·지역형인데 학원 타입 미선택 → 학원정보 미사용(가이드/체크리스트로 작성). 정보용 안내.
        if (Boolean(archetype?.academy_centric) && primary === "region") warnings.push({ level: "warn", code: "academy_types_empty", message: "학원 근거형이지만 학원 타입이 선택되지 않아 학원정보를 쓰지 않습니다(지역 가이드/체크리스트로 작성)." });
      }

      // 예상 슬롯 상한(rough): topic 수(주키워드·min_sv 반영) × 축 팩터. 0 이면 이 유형은 슬롯을 못 만든다.
      const usablePrimary = topicUnits.length;
      const personaFactor = recipe.use_persona && (poolSizes.persona ?? 0) > 0 ? (poolSizes.persona ?? 0) : 1;
      const intentFactor = recipe.with_intent && (poolSizes.intent ?? 0) > 0 ? (poolSizes.intent ?? 0) : 1;
      const mPool = poolSizes.modifier ?? 0;
      const modifierFactor = recipe.modifier_count === 0 ? 1 : recipe.modifier_count === 1 ? (mPool > 0 ? mPool : 1) : (mPool >= 2 ? (mPool * (mPool - 1)) / 2 : 1);
      const estimated_slot_upperbound = usablePrimary * personaFactor * intentFactor * modifierFactor;
      if (estimated_slot_upperbound === 0) warnings.push({ level: "error", code: "no_slots", message: "현재 축/키워드 데이터로 이 유형은 슬롯을 만들지 못합니다." });

      templates.push({
        template_id: tid, name: spec.name, kind: spec.kind, custom: customIdSet.has(tid), enabled: enabledSet.has(tid),
        primary_axis: primary, primary_value_count: topicUnits.length,
        keyword_rule: { format: kwFilterSet.length ? "filter" : (kr?.format ?? null), matched_keyword_count, keyword_total: keywordAxis.length },
        axes: axesReport, academy, estimated_slot_upperbound, warnings,
      });
    }

    return { domain, thresholds: { academy_min_for_best: ACADEMY_MIN_FOR_BEST }, templates };
  }

  // seo_regions 좌표를 region→{lat,lng} 맵으로(지역별 getSeoRegion N회 쿼리 회피). 높은 level 우선.
  private buildRegionCoords(domain: string): Map<string, { lat: number; lng: number }> {
    const map = new Map<string, { lat: number; lng: number; level: number }>();
    for (const r of this.db.listSeoRegions(domain)) {
      const region = String(r.region || "").trim();
      const lat = finiteNum(r.latitude), lng = finiteNum(r.longitude), level = Number(r.level) || 0;
      if (!region || lat === null || lng === null) continue;
      const prev = map.get(region);
      if (!prev || level > prev.level) map.set(region, { lat, lng, level });
    }
    return new Map([...map].map(([k, v]) => [k, { lat: v.lat, lng: v.lng }]));
  }

  // 한 지역 값에 대해 직접(region 문자열 포함) 매칭과 인근(반경 ACADEMY_NEARBY_MAX_KM 내, 직접 제외) 매칭을 나눠 반환.
  // 생성(worker.pickAcademiesForRegion)과 판정 기준을 맞춘다 — 인근 반경 정책 변경 시 둘을 함께 맞춰라.
  private matchRegionAcademies(region: string, typedAcademies: Row[], coords: { lat: number; lng: number } | undefined): { direct: Row[]; nearby: Array<Row & { distance_km: number }> } {
    const direct = typedAcademies.filter((a) => String(a.region || "").includes(region));
    const directKeys = new Set(direct.map(academyKey));
    const nearby: Array<Row & { distance_km: number }> = [];
    if (coords) {
      for (const a of typedAcademies) {
        if (directKeys.has(academyKey(a))) continue;
        const alat = finiteNum(a.latitude), alng = finiteNum(a.longitude);
        if (alat === null || alng === null) continue;
        const km = haversineKm(coords.lat, coords.lng, alat, alng);
        if (km <= ACADEMY_NEARBY_MAX_KM) nearby.push({ ...a, distance_km: Math.round(km * 10) / 10 });
      }
      nearby.sort((x, y) => x.distance_km - y.distance_km);
    }
    return { direct, nearby };
  }

  // 특정 글유형의 지역별 학원 커버리지(팝업 L1/L2용). 정합성과 동일한 매칭:
  // 직접(region 문자열) + 인근(반경 ACADEMY_NEARBY_MAX_KM) + academy_types 필터 + 임계값 2(직접+인근 합).
  // 지역별 학원 목록(직접/인근 구분·거리)과 각 학원의 빠진 데이터까지 반환.
  academyCoverage(domain: string, templateId: string): Row {
    const spec = this.db.getTemplateSpec(domain, templateId);
    if (!spec) throw new Error(`unknown template: ${templateId}`);
    const archetype = getArchetype(String(spec.kind || ""));
    const axes = this.db.listAxes(domain);
    const kwFilterSet = (spec.keyword_filter ?? []).map((k: unknown) => String(k || "").trim()).filter(Boolean);
    const primary = (kwFilterSet.length ? (spec.primary_override ?? archetype?.primary) : archetype?.primary) ?? "keyword";
    const academyTypes = (spec.academy_types ?? []).map((t: unknown) => String(t || "").trim()).filter(Boolean);
    const ACADEMY_MIN_FOR_BEST = 2;
    const applicable = Boolean(archetype?.academy_centric) && primary === "region" && academyTypes.length > 0;
    if (!applicable) return { template_id: templateId, name: spec.name, applicable: false, academy_types: academyTypes, threshold: ACADEMY_MIN_FOR_BEST, nearby_km: ACADEMY_NEARBY_MAX_KM, regions: [] };
    const regionValues = axes.region || [];
    const typed = this.db.listAcademies(domain, { academy_types: academyTypes, limit: 100000 });
    const coordsMap = this.buildRegionCoords(domain);
    const PER_REGION_CAP = 50;
    const toEntry = (a: Row, nearby: boolean) => ({ name: String(a.name || ""), region: String(a.region || ""), academy_type: String(a.academy_type || ""), address: String(a.address || ""), nearby, distance_km: nearby ? (a.distance_km ?? null) : null, missing: academyMissingFields(a) });
    const regions = regionValues.map((pv) => {
      const value = String(pv.value || "").trim();
      if (!value) return null;
      const { direct, nearby } = this.matchRegionAcademies(value, typed, coordsMap.get(value));
      const count = direct.length + nearby.length;
      const entries = [...direct.map((a) => toEntry(a, false)), ...nearby.map((a) => toEntry(a, true))];
      return { region: value, direct: direct.length, nearby: nearby.length, count, sufficient: count >= ACADEMY_MIN_FOR_BEST, academies: entries.slice(0, PER_REGION_CAP), truncated: entries.length > PER_REGION_CAP };
    }).filter((r): r is NonNullable<typeof r> => r !== null);
    const withMin = regions.filter((r) => r.sufficient).length;
    const withAny = regions.filter((r) => r.count >= 1).length;
    const directMin = regions.filter((r) => r.direct >= ACADEMY_MIN_FOR_BEST).length;
    // 부족(count 낮은) 지역을 위로 정렬해 운영자가 먼저 보게 한다.
    regions.sort((a, b) => Number(a.sufficient) - Number(b.sufficient) || a.count - b.count || a.region.localeCompare(b.region, "ko"));
    return { template_id: templateId, name: spec.name, applicable: true, academy_types: academyTypes, threshold: ACADEMY_MIN_FOR_BEST, nearby_km: ACADEMY_NEARBY_MAX_KM, regions_total: regions.length, regions_with_academies: withAny, regions_with_min_for_best: withMin, regions_with_min_direct: directMin, regions };
  }
}

// 학원 1곳에서 생성에 중요한데 비어 있는 데이터 항목을 한국어 라벨로 반환(팝업 L2용).
function academyMissingFields(a: Row): string[] {
  const has = (v: unknown) => { const s = String(v ?? "").trim(); return Boolean(s) && s !== "[]" && s !== "null" && s !== "{}"; };
  const missing: string[] = [];
  if (!has(a.address)) missing.push("주소");
  if (!has(a.phone) && !has(a.vphone)) missing.push("전화");
  if (!has(a.price)) missing.push("가격");
  if (!has(a.shuttle)) missing.push("셔틀");
  if (!has(a.pass_rate)) missing.push("합격률");
  if (!has(a.review) && !has(a.review_json)) missing.push("리뷰");
  if (!has(a.thumb_url) && !has(a.photos)) missing.push("사진");
  return missing;
}

// 학원 중복 제거 키(external_id → id → name 순).
function academyKey(a: Row): string { return String(a.external_id || a.id || a.name); }
function finiteNum(value: unknown): number | null { const n = Number(value); return Number.isFinite(n) ? n : null; }
// 두 좌표 간 거리(km, haversine). worker.haversineKm 와 동일 공식(반경 정책 공유).
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 주키워드 생성 로직은 archetypes.ts (buildKeyword) 로 통합 이전됨.

// slot_id 해시에 domain을 포함한다. slots PK는 전역 slot_id 이므로, domain을 빼면
// 같은 프리셋을 쓰는 다른 도메인끼리 slot_id가 충돌해 두 번째 도메인 슬롯이 유실된다.
// 같은 도메인 재생성 시에는 동일 조합→동일 id 로 idempotency 를 유지한다.
function slotId(domain: string, templateId: string, parts: string[]): string {
  const h = createHash("sha1").update([domain, templateId, ...parts].join("|")).digest("hex").slice(0, 8);
  return `${templateId}_${h}`;
}
type TopicUnit = { primaryKeyword: string; region: string | null; sv: number | null; kd: number | null; hashKey: string };
// (a) 주제(topic) 단위 산출. keyword_filter 있으면 free 모드(그 키워드를 권위로 직접 사용 + primary_override 로 지역 결합),
// 없으면 아키타입 폴백(keyword_rule 패턴 + archetype.primary) — 기존 로직과 byte-동일해야 골든 0-diff.
function buildTopicUnits(spec: TemplateSpecShape, archetype: Archetype | undefined, axes: Record<AxisName, Row[]>): TopicUnit[] {
  const filterSet = (spec.keyword_filter ?? []).map((k) => String(k || "").trim()).filter(Boolean);
  const units: TopicUnit[] = [];
  if (!filterSet.length) {
    const primaryAxis = (archetype?.primary ?? "keyword") as AxisName;
    const primaryValues = primaryAxis === "keyword" ? (axes.keyword || []) : (axes[primaryAxis] || []);
    for (const pv of primaryValues) {
      const primaryKeyword = archetype ? buildKeyword(archetype, String(pv.value || ""), axes.keyword || []) : "";
      if (!primaryKeyword) continue;
      const sv = numberOrNull(pv.monthly_search_volume);
      if (sv !== null && sv < spec.min_sv) continue;
      units.push({ primaryKeyword, region: primaryAxis === "region" ? (pv.value as string) : null, sv, kd: numberOrNull(pv.competition_kd), hashKey: pv.value || "" });
    }
    return units;
  }
  // free 모드: keyword_filter 를 권위로. primary_override 없으면 archetype.primary.
  const primary = spec.primary_override ?? archetype?.primary ?? "keyword";
  if (primary === "region") {
    for (const r of (axes.region || [])) {
      const region = String(r.value || "").trim();
      if (!region) continue;
      const sv = numberOrNull(r.monthly_search_volume);
      if (sv !== null && sv < spec.min_sv) continue;
      const kd = numberOrNull(r.competition_kd);
      for (const kw of filterSet) {
        const primaryKeyword = `${region} ${kw}`.replace(/\s+/g, " ").trim();
        units.push({ primaryKeyword, region, sv, kd, hashKey: primaryKeyword });
      }
    }
  } else {
    const kwRows = new Map((axes.keyword || []).map((k) => [String(k.value || ""), k]));
    for (const kw of filterSet) {
      const row = kwRows.get(kw);
      const sv = numberOrNull(row?.monthly_search_volume);
      if (sv !== null && sv < spec.min_sv) continue;
      units.push({ primaryKeyword: kw, region: null, sv, kd: numberOrNull(row?.competition_kd), hashKey: kw });
    }
  }
  return units;
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
