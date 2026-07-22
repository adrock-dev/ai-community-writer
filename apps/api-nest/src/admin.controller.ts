import { Body, Controller, Delete, Get, Headers, HttpException, HttpStatus, Inject, Param, Patch, Post, Put, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { DbService, domainOut, jobOut, nowSql, safeJson } from "./db.service.js";
import { DrivingplusApiService, type SeoRegionLevel } from "./drivingplus-api.service.js";
import { RegionDirectoryService } from "./region-directory.service.js";
import { ACADEMY_TYPES, AUTO_DESIGN_TEMPLATE_ID, DEFAULT_DRIVING_BRAND_COLOR, DEFAULT_DRIVING_COMMON_PRINCIPLES, DEFAULT_DRIVING_TEMPLATE_IDS, DEFAULT_EXPOSED_BUILTIN_TEMPLATE_IDS, DEFAULT_DRIVING_VERTICAL, DESIGN_TEMPLATES, DRIVING_ABSOLUTE_PRINCIPLES, DRIVING_ACADEMY_PRINCIPLES, MAX_SLOTS_PER_TEMPLATE, TEMPLATE_SPECS, TITLE_RULES, type AxisName } from "./constants.js";
import { SlotService } from "./slot.service.js";
import { ensureImageSlotsForRender, fallbackImagesForPost, renderMarkdown, stripPseudoSlotsForRender } from "./post-rendering.js";
import { findSlotExclusionTerms, parseExclusionTerms, parseMonitoredPhrases } from "./exclusions.js";
import { articleQualityIssues, postSurfaceQualityIssues, renderedCandidateCount } from "./quality-gate.js";
import { blockingClass, classifyIssues } from "./quality-gate-severity.js";
import { AXIS_TAG_VOCAB, resolveRecipeFlags, resolveTemplateDirection, safeTemplateOverrides, type TaggedAxis } from "./axis-tags.js";
import { archetypeStructureVariants, getArchetype, writingGuideLines } from "./archetypes.js";
import { runLlm } from "./llm-runner.js";
import { adminApiBaseUrl, drivingplusApiBaseUrl } from "./runtime-config.js";
import { getDesignTheme, resolveDesignId } from "./design-theme.js";
import { isT01TemplateFamily, T01_LEGACY_PLUS_MODE } from "./t01-legacy-plus.js";

type Row = Record<string, any>;
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || "").trim();

// 빌트인 글유형 spec 에 제목 규칙(TITLE_RULES 맵 소유)을 병합해 반환한다. /options·/templates 가 동일 계약을
// 쓰도록 한 곳에서 만든다(한쪽만 병합해 시작점 프리필이 비던 드리프트 방지).
function builtinSpecWithTitleRule(id: string, spec: Record<string, unknown>): Record<string, unknown> {
  return { ...spec, title_rule: TITLE_RULES[id] ?? null };
}

@Controller("api/admin")
export class AdminController {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(SlotService) private readonly slots: SlotService,
    @Inject(DrivingplusApiService) private readonly drivingplus: DrivingplusApiService,
    @Inject(RegionDirectoryService) private readonly regionDirectory: RegionDirectoryService,
  ) {}

  @Get("options")
  options(@Req() req: Request, @Headers() headers: Record<string, string>) {
    checkAuth(req, headers);
    return {
      verticals: this.db.getVerticals(),
      themes: ["clean", "modern", "pro"],
      templates: Object.keys(TEMPLATE_SPECS),
      // 빌트인 제목 규칙(TITLE_RULES)을 spec 에 병합 — 커스텀 폼 '시작점' 프리필이 이 값을 읽는다(listTemplates 와 동일 계약).
      template_specs: Object.fromEntries(Object.entries(TEMPLATE_SPECS).map(([id, spec]) => [id, builtinSpecWithTitleRule(id, spec)])),
      // 학원 타입 정식 목록(5종). 커스텀 폼 학원 타입 체크박스가 이걸로 5종 전부 노출한다.
      // (커스텀 폼은 지역형 kind 일 때만 이 필드를 노출한다 — academy_types 는 지역형에서만 효과.)
      // 아키타입 kind → 섹션 순서 변형 라벨(읽기전용). 커스텀 폼이 시작점/참조 아키타입의 구조 다양성을 안내.
      archetype_structure_variants: archetypeStructureVariants(),
      academy_types: [...ACADEMY_TYPES],
      axis_tag_vocab: AXIS_TAG_VOCAB,
      design_templates: DESIGN_TEMPLATES,
      providers: ["codex", "claude"],
      preset_options: [DEFAULT_DRIVING_VERTICAL],
      indexing: { has_key: Boolean(this.db.getSetting("google_sa_json")), url_template: this.indexingUrlTemplate() },
      // 전역 빌트인 노출 허용 목록(검증용 임시). null = 전체 노출. 카탈로그/커스텀 시작점/아키타입 목록에서 필터.
      exposed_builtin_template_ids: this.exposedBuiltinIds()
    };
  }

  @Get("runtime/apis")
  runtimeApis(@Req() req: Request, @Headers() headers: Record<string, string>) {
    checkAuth(req, headers);
    const drivingplusBase = drivingplusApiBaseUrl();
    return {
      admin_api_base: adminApiBaseUrl(),
      public_api_base: adminApiBaseUrl(),
      drivingplus_api_base: drivingplusBase,
      drivingplus_endpoints: {
        academies: `${drivingplusBase}/v1/academy/get-all-academy`,
        reviews: `${drivingplusBase}/v1/review/list/:academyId?sort=point&limit=5`,
        blog_reviews: `${drivingplusBase}/v1/blog-review/list/:academyId?limit=3`,
        seo_regions: `${drivingplusBase}/v1/zipcode/search-seo?level=2`,
      },
      sync_defaults: {
        include_reviews: true,
        review_limit: 5,
        review_sort: "point",
        include_blog_reviews: true,
        blog_review_limit: 3,
        review_source_note: "학원 기본 정보는 get-all-academy에서 가져오고, 일반 리뷰와 블로그 리뷰는 학원별 review/blog-review API를 추가 호출해 글 생성 보충자료로 저장합니다.",
      },
    };
  }

  @Get("domains")
  listDomains(@Req() req: Request, @Headers() headers: Record<string, string>) {
    checkAuth(req, headers);
    const items = this.db.listDomains().map(domainOut);
    return { count: items.length, items };
  }

  @Post("domains")
  createDomain(@Req() req: Request, @Headers() headers: Record<string, string>, @Body() body: Row) {
    checkAuth(req, headers);
    const domain = String(body.domain || "").trim().toLowerCase();
    const display_name = String(body.display_name || "").trim();
    const vertical = String(body.vertical || DEFAULT_DRIVING_VERTICAL).trim();
    if (!domain || !display_name) throw new HttpException("domain, display_name required", 400);
    if (!this.db.getVerticals().some((v) => v.key === vertical)) throw new HttpException("등록되지 않은 업종입니다. 작업환경에서 먼저 추가하세요.", 400);
    if (this.db.getDomain(domain)) throw new HttpException("domain already exists", 409);
    this.db.createDomain({ domain, display_name, vertical, theme: body.theme, brand_color: body.brand_color || DEFAULT_DRIVING_BRAND_COLOR, daily_limit: body.daily_limit, templates_enabled: JSON.stringify(DEFAULT_DRIVING_TEMPLATE_IDS) });
    // 새 도메인은 디자인 자동 매칭으로 시작한다: 글마다 슬롯의 글 유형 기본 디자인을 적용(docs/design-template-mapping.md).
    this.db.updateDomain(domain, { design_template_id: AUTO_DESIGN_TEMPLATE_ID, common_principles: body.common_principles || body.content_brief || DEFAULT_DRIVING_COMMON_PRINCIPLES });
    if (body.apply_preset !== false) this.slots.applyPreset(domain, vertical);
    // 전역 지역 사전을 미리 준비해 둔다(비어 있거나 오래됐을 때만 원천 호출).
    // 비차단이다 — 원천이 죽어 있어도 도메인 생성은 성공해야 한다.
    this.regionDirectory.ensureInBackground(`domain:${domain}`);
    return { ok: true, domain: domainOut(this.requireDomain(domain)) };
  }

  @Get("domains/:domain")
  getDomain(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Query() query: Row) {
    checkAuth(req, headers);
    const domainConfig = domainOut(this.requireDomain(domain));
    const include = new Set(String(query.include || "").split(",").map((s) => s.trim()).filter(Boolean));
    const limit = clampInt(query.limit, 100, 1, 500);
    const payload: Row = {
      domain: domainConfig,
      axes: this.db.listAxes(domain),
      slot_counts: this.db.countSlots(domain),
      custom_templates: this.db.listCustomTemplates(domain),
      settings: { indexing_has_key: Boolean(this.db.getSetting("google_sa_json")), indexing_url_template: this.indexingUrlTemplate() }
    };
    if (include.has("slots")) payload.slots = this.db.listSlots(domain, { status: query.slot_status || undefined, template: query.slot_template || undefined, q: query.slot_q || undefined, limit });
    if (include.has("posts")) payload.posts = this.db.listPosts(domain, { limit });
    if (include.has("academies")) payload.academies = this.db.listAcademies(domain, { limit });
    if (include.has("jobs")) payload.jobs = this.db.listJobs({ domain: domain, limit }).map(jobOut);
    return payload;
  }

  @Patch("domains/:domain")
  updateDomain(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Body() body: Row) {
    checkAuth(req, headers);
    this.requireDomain(domain);
    const fields = { ...body };
    if (Array.isArray(fields.templates_enabled)) fields.templates_enabled = JSON.stringify(fields.templates_enabled);
    if (fields.design_template_overrides && typeof fields.design_template_overrides === "object") fields.design_template_overrides = JSON.stringify(normalizeDesignOverrides(fields.design_template_overrides));
    if (fields.template_overrides && typeof fields.template_overrides === "object") fields.template_overrides = JSON.stringify(safeTemplateOverrides(fields.template_overrides));
    this.db.updateDomain(domain, fields);
    return { ok: true, domain: domainOut(this.requireDomain(domain)) };
  }

  // 글유형 목록: 빌트인(TEMPLATE_SPECS) + 도메인 커스텀(custom_templates).
  @Get("domains/:domain/templates")
  listTemplates(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string) {
    checkAuth(req, headers); this.requireDomain(domain);
    return {
      builtin: Object.entries(TEMPLATE_SPECS).map(([id, spec]) => ({ template_id: id, ...builtinSpecWithTitleRule(id, spec), custom: false })),
      custom: this.db.listCustomTemplates(domain),
    };
  }

  // 커스텀 글유형 생성. kind 는 기존 아키타입 참조만 허용(getArchetype 검증) — 새 아키타입 authoring 금지(품질 보장).
  @Post("domains/:domain/templates")
  createTemplate(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Body() body: Row) {
    checkAuth(req, headers); this.requireDomain(domain);
    const name = String(body.name || "").trim();
    const kind = String(body.kind || "").trim();
    if (!name) throw new HttpException("name required", 400);
    if (!getArchetype(kind)) throw new HttpException(`unknown archetype kind: ${kind || "(empty)"}`, 400);
    const template = this.db.createCustomTemplate(domain, {
      name, kind,
      use_persona: Boolean(body.use_persona),
      with_intent: Boolean(body.with_intent),
      modifier_count: body.modifier_count,
      weight: body.weight,
      min_sv: body.min_sv,
      axis_tags: body.axis_tags,
      axis_values: body.axis_values,
      academy_types: body.academy_types,
      keyword_filter: body.keyword_filter,
      primary_override: body.primary_override,
      default_direction: body.default_direction,
      default_design: body.default_design,
      title_rule: body.title_rule,
    });
    return { ok: true, template };
  }

  // 커스텀 글유형 삭제. 빌트인은 상수라 삭제 불가.
  @Delete("domains/:domain/templates/:templateId")
  deleteTemplate(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Param("templateId") templateId: string) {
    checkAuth(req, headers); this.requireDomain(domain);
    if ((TEMPLATE_SPECS as Record<string, unknown>)[templateId]) throw new HttpException("cannot delete builtin template", 400);
    const deleted = this.db.deleteCustomTemplate(domain, templateId);
    if (!deleted) throw new HttpException("custom template not found", 404);
    return { ok: true, deleted: templateId };
  }

  // 글유형 복제(clone) — 검증된 기존 글유형(빌트인/커스텀)을 복사해 조정 시작점으로. 새 커스텀 row 발급.
  // effective 복사: 소스가 '이 도메인에서 지금 동작하는 그대로'(spec + 해당 오버라이드 병합)를 파라미터로 굳혀 독립 row 로.
  @Post("domains/:domain/templates/clone")
  cloneTemplate(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Body() body: Row) {
    checkAuth(req, headers); this.requireDomain(domain);
    const sourceId = String(body.source_template_id || "").trim();
    if (!sourceId) throw new HttpException("source_template_id required", 400);
    const spec = this.db.getTemplateSpec(domain, sourceId);
    if (!spec) throw new HttpException("source template not found", 404);
    const config = domainOut(this.requireDomain(domain));
    const srcOverride = safeTemplateOverrides(config.template_overrides)[sourceId];
    // effective 파라미터: 오버라이드를 소스 spec 위에 적용해 굳힌다(복제본은 오버라이드 없이 소스와 동일 동작).
    const recipe = resolveRecipeFlags(spec, srcOverride);
    const axis_tags: Partial<Record<TaggedAxis, string[]>> = {};
    for (const axis of ["persona", "intent", "modifier"] as TaggedAxis[]) {
      const tags = srcOverride?.axis_tags?.[axis] ?? spec.axis_tags?.[axis];
      if (Array.isArray(tags) && tags.length) axis_tags[axis] = tags;
    }
    const direction = resolveTemplateDirection(spec, srcOverride);
    // inline overrides(복제-후-조정 한 번에). 알려진 파라미터만 위에 덮는다.
    const inline = (body.overrides && typeof body.overrides === "object" && !Array.isArray(body.overrides)) ? body.overrides : {};
    const input: Row = {
      kind: spec.kind,
      use_persona: recipe.use_persona,
      with_intent: recipe.with_intent,
      modifier_count: recipe.modifier_count,
      weight: spec.weight,
      min_sv: spec.min_sv,
      axis_tags,
      axis_values: spec.axis_values,
      academy_types: spec.academy_types,
      keyword_filter: spec.keyword_filter,
      primary_override: spec.primary_override,
      default_direction: direction || null,
      default_design: spec.default_design,
      // 복제본이 다시 복제돼도 최초 빌트인 원본을 유지한다. T01 계보의 기본
      // 생성 정책을 제목·이름 추정 없이 안전하게 적용하기 위한 내부 메타데이터다.
      origin_template_id: spec.origin_template_id || sourceId,
      // 소스의 유효 제목 규칙을 굳혀 복사 — 빌트인(T01 등) 클론도 제목 규칙을 그대로 상속한다.
      // (getTemplateSpec 이 빌트인 title_rule 을 TITLE_RULES 에서 실어주므로 빌트인/커스텀 동일 경로.)
      title_rule: spec.title_rule ?? null,
      ...inline,
    };
    const kind = String(input.kind || "").trim();
    if (!getArchetype(kind)) throw new HttpException(`unknown archetype kind: ${kind || "(empty)"}`, 400);
    input.kind = kind;
    input.name = String(body.name || "").trim() || `${spec.name} (복사본)`;
    const template = this.db.createCustomTemplate(domain, input);
    return { ok: true, template, source_template_id: sourceId };
  }

  // 커스텀 글유형 편집(PATCH). 빌트인은 상수라 편집 불가(template_overrides 로).
  @Patch("domains/:domain/templates/:templateId")
  updateTemplate(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Param("templateId") templateId: string, @Body() body: Row) {
    checkAuth(req, headers); this.requireDomain(domain);
    if ((TEMPLATE_SPECS as Record<string, unknown>)[templateId]) throw new HttpException("cannot edit builtin template (clone it to a custom template instead)", 400);
    if (!this.db.getCustomTemplate(domain, templateId)) throw new HttpException("custom template not found", 404);
    if (body.kind !== undefined && !getArchetype(String(body.kind || "").trim())) throw new HttpException(`unknown archetype kind: ${String(body.kind || "").trim() || "(empty)"}`, 400);
    this.db.updateCustomTemplate(domain, templateId, body);
    return { ok: true, template: this.db.getCustomTemplate(domain, templateId) };
  }

  // 커스텀 글유형 축 값(persona/intent/modifier) AI 제안 — LLM 에 유형 맥락(kind/이름/방향성)을 주고 후보를 생성한다.
  // 저장하지 않고 '제안'만 반환한다(프론트가 폼에 채우고 사용자가 검토/수정 후 저장 — 품질 관문은 사람).
  @Post("domains/:domain/templates/suggest-axes")
  async suggestAxes(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Body() body: Row) {
    checkAuth(req, headers);
    const config = domainOut(this.requireDomain(domain));
    const kind = String(body.kind || "").trim();
    const archetype = getArchetype(kind);
    if (!archetype) throw new HttpException(`unknown archetype kind: ${kind || "(empty)"}`, 400);
    const axes = (Array.isArray(body.axes) ? body.axes : []).map((a: any) => String(a)).filter((a: string) => ["persona", "intent", "modifier"].includes(a));
    if (!axes.length) throw new HttpException("axes required (persona/intent/modifier 중 하나 이상)", 400);
    const keywords = (Array.isArray(body.keywords) ? body.keywords : []).map((k: any) => String(k).trim()).filter(Boolean).slice(0, 20);
    const prompt = buildAxisSuggestPrompt({ domainName: String(config.display_name || domain), kind, primary: archetype.primary, name: String(body.name || ""), direction: String(body.direction || ""), keywords, axes, commonPrinciples: String(config.common_principles || ""), writingGuide: writingGuideLines(archetype) });
    const result = await runLlm(prompt, { provider: String(body.provider || "codex").trim() || "codex", model: String(body.model || "").trim(), timeoutSec: clampInt(body.timeout_sec, 180, 30, 600) });
    if (!result.ok || !result.summary.trim()) throw new HttpException(`LLM 호출 실패: ${result.error || "빈 응답"} (codex/claude CLI 설치·인증 확인)`, 502);
    const suggestions = parseAxisSuggestion(result.summary, axes);
    if (!Object.keys(suggestions).length) throw new HttpException("LLM 응답에서 축 값을 추출하지 못했습니다. 다시 시도해 주세요.", 502);
    return { ok: true, suggestions, provider: result.provider, model: result.model };
  }

  // 방향성 검증: 입력한 방향성이 절대 원칙(하드코딩 보편 바닥)·공통원칙·아키타입 writing_guide 와 중복/충돌하는지 LLM 으로 대조하고,
  // 이 글유형 고유 방향만 남긴 개선안을 제안한다. 저장하지 않음(프론트가 사용자 확인 후 방향성 폼에 반영).
  @Post("domains/:domain/templates/validate-direction")
  async validateDirection(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Body() body: Row) {
    checkAuth(req, headers);
    const config = domainOut(this.requireDomain(domain));
    const kind = String(body.kind || "").trim();
    const archetype = getArchetype(kind);
    if (!archetype) throw new HttpException(`unknown archetype kind: ${kind || "(empty)"}`, 400);
    const direction = String(body.direction || "").trim();
    if (!direction) throw new HttpException("검증할 방향성(direction)을 입력하세요.", 400);
    // 유형이 학원 후보를 다루면(has_academy) 학원 전용 규칙도 함께 대조. 기본값은 아키타입 academy_centric.
    const hasAcademy = typeof body.has_academy === "boolean" ? body.has_academy : Boolean(archetype.academy_centric);
    const absolutePrinciples = DRIVING_ABSOLUTE_PRINCIPLES + (hasAcademy ? `\n${DRIVING_ACADEMY_PRINCIPLES}` : "");
    const prompt = buildDirectionValidatePrompt({
      name: String(body.name || ""), kind, direction, currentDirection: String(body.current_direction || ""),
      commonPrinciples: String(config.common_principles || ""), writingGuide: writingGuideLines(archetype), absolutePrinciples,
    });
    const result = await runLlm(prompt, { provider: String(body.provider || "codex").trim() || "codex", model: String(body.model || "").trim(), timeoutSec: clampInt(body.timeout_sec, 180, 30, 600) });
    if (!result.ok || !result.summary.trim()) throw new HttpException(`LLM 호출 실패: ${result.error || "빈 응답"} (codex/claude CLI 설치·인증 확인)`, 502);
    const validation = parseDirectionValidation(result.summary);
    if (!validation) throw new HttpException("LLM 응답을 해석하지 못했습니다. 다시 시도해 주세요.", 502);
    return { ok: true, validation, provider: result.provider, model: result.model };
  }

  // 레시피↔데이터 정합성(coherence) — 읽기/계산 전용. 생성 전에 얇은/근거없는 조합을 사전 경고(전 빌트인+커스텀).
  @Get("domains/:domain/templates/coherence")
  templatesCoherence(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string) {
    checkAuth(req, headers); this.requireDomain(domain);
    return this.slots.analyzeCoherence(domain);
  }

  // 특정 글유형의 지역별 학원 커버리지(팝업 L1/L2). 지역별 학원 수·충분 여부 + 학원별 빠진 데이터.
  @Get("domains/:domain/templates/:templateId/academy-coverage")
  academyCoverage(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Param("templateId") templateId: string) {
    checkAuth(req, headers); this.requireDomain(domain);
    return this.slots.academyCoverage(domain, templateId);
  }

  // 커스텀 글유형 편집 상태 export — DB 초기화(wipe) 대비. 빌트인은 상수라 export 불필요.
  // 봉투(envelope): 메타(schema/version/domain/exported_at) + custom_templates + template_overrides + templates_enabled.
  @Get("domains/:domain/templates/export")
  exportTemplates(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string) {
    checkAuth(req, headers);
    const config = domainOut(this.requireDomain(domain));
    const custom_templates = this.db.listCustomTemplates(domain).map((t) => ({
      template_id: t.template_id, name: t.name, kind: t.kind,
      use_persona: t.use_persona, with_intent: t.with_intent, modifier_count: t.modifier_count,
      weight: t.weight, min_sv: t.min_sv, axis_tags: t.axis_tags, axis_values: t.axis_values, academy_types: t.academy_types, keyword_filter: t.keyword_filter, primary_override: t.primary_override,
      default_direction: t.default_direction ?? null, default_design: t.default_design,
      origin_template_id: t.origin_template_id ?? null, title_rule: t.title_rule ?? null,
      created_at: t.created_at,
    }));
    return {
      schema: "adrock-templates-export",
      version: 1,
      domain,
      exported_at: nowSql(),
      custom_templates,
      template_overrides: config.template_overrides,
      templates_enabled: config.templates_enabled,
    };
  }

  // 커스텀 글유형 편집 상태 import(복구/복제). mode=merge(기본): id별 upsert + overrides/enabled 병합. replace: 교체.
  // id 보존(overrides/enabled 참조 유지) · 빌트인 id 차단 · kind 검증 · 부재 필드는 건드리지 않음(부분 봉투 방어).
  @Post("domains/:domain/templates/import")
  importTemplates(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Query() query: Row, @Body() body: Row) {
    checkAuth(req, headers); this.requireDomain(domain);
    const mode = String(query.mode || "").trim() === "replace" ? "replace" : "merge";
    const isObj = (v: unknown): v is Row => Boolean(v) && typeof v === "object" && !Array.isArray(v);
    // {data: envelope} 래퍼를 명시했으면 data 는 반드시 객체여야 한다(malformed 래퍼 차단).
    if (body && Object.prototype.hasOwnProperty.call(body, "data") && !isObj(body.data)) throw new HttpException("invalid import envelope (data wrapper malformed)", 400);
    const env: Row = isObj(body?.data) ? body.data : (body || {});
    if (!isObj(env)) throw new HttpException("invalid import envelope", 400);
    // 최소한 export 봉투 표식이나 import 가능한 필드가 하나는 있어야 한다.
    const hasPayload = env.schema === "adrock-templates-export" || Array.isArray(env.custom_templates) || isObj(env.template_overrides) || Array.isArray(env.templates_enabled);
    if (!hasPayload) throw new HttpException("invalid import envelope (no importable fields)", 400);
    const warnings: string[] = [];
    if (env.domain && String(env.domain) !== domain) warnings.push(`envelope domain '${env.domain}' != target '${domain}' — importing into target`);

    // 1) custom_templates
    if (mode === "replace") this.db.deleteAllCustomTemplates(domain);
    let imported = 0, skipped = 0;
    const incomingCustom = Array.isArray(env.custom_templates) ? env.custom_templates : [];
    for (const row of incomingCustom) {
      const tid = String(row?.template_id || "").trim();
      const kind = String(row?.kind || "").trim();
      if (!tid) { skipped++; warnings.push("custom template without template_id skipped"); continue; }
      if ((TEMPLATE_SPECS as Record<string, unknown>)[tid]) { skipped++; warnings.push(`'${tid}' collides with builtin id — skipped`); continue; }
      if (!getArchetype(kind)) { skipped++; warnings.push(`'${tid}' unknown archetype kind '${kind || "(empty)"}' — skipped`); continue; }
      this.db.importCustomTemplate(domain, row);
      imported++;
    }

    // 2) template_overrides (봉투에 필드가 있을 때만). merge: 기존 ∪ 봉투(봉투 우선). replace: 봉투로 교체.
    let overrides_merged = 0;
    if (env.template_overrides !== undefined && env.template_overrides !== null) {
      const incoming = safeTemplateOverrides(env.template_overrides);
      const existing = mode === "replace" ? {} : safeTemplateOverrides(domainOut(this.requireDomain(domain)).template_overrides);
      const merged = { ...existing, ...incoming };
      this.db.updateDomain(domain, { template_overrides: JSON.stringify(merged) });
      overrides_merged = Object.keys(incoming).length;
    }

    // 3) templates_enabled (봉투에 필드가 있을 때만). 실제 존재하는 id(빌트인+현재 커스텀)만 남겨 유령 id 방지.
    let templates_enabled: string[] | undefined;
    if (Array.isArray(env.templates_enabled)) {
      const valid = new Set<string>([...Object.keys(TEMPLATE_SPECS), ...this.db.listCustomTemplates(domain).map((t) => String(t.template_id))]);
      const incoming = env.templates_enabled.map((v: unknown) => String(v));
      const base = mode === "replace" ? [] : (Array.isArray(domainOut(this.requireDomain(domain)).templates_enabled) ? domainOut(this.requireDomain(domain)).templates_enabled.map((v: unknown) => String(v)) : []);
      templates_enabled = [...new Set([...base, ...incoming])].filter((id) => valid.has(id));
      this.db.updateDomain(domain, { templates_enabled: JSON.stringify(templates_enabled) });
    }

    return { ok: true, mode, imported, skipped, overrides_merged, templates_enabled, warnings };
  }

  @Delete("domains/:domain")
  deleteDomain(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string) {
    checkAuth(req, headers); this.requireDomain(domain); this.db.deleteDomain(domain); return { ok: true };
  }

  @Put("domains/:domain/axes/:axis")
  replaceAxis(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Param("axis") axis: AxisName, @Body() body: Row) {
    checkAuth(req, headers); this.requireDomain(domain);
    const valid = new Set(["region", "keyword", "intent", "persona", "modifier"]);
    if (!valid.has(axis)) throw new HttpException("invalid axis", 400);
    const rows = (Array.isArray(body.values) ? body.values : []).map((v: Row) => ({
      value: String(v.value || "").trim(), weight: v.weight ?? 3, monthly_search_volume: nullableNumber(v.monthly_search_volume), competition_kd: nullableNumber(v.competition_kd)
    })).filter((v: Row) => v.value);
    this.db.bulkReplaceAxis(domain, axis, rows);
    return { ok: true, axis, count: rows.length, axes: this.db.listAxes(domain) };
  }

  @Post("domains/:domain/axes/preset")
  preset(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Body() body: Row) {
    checkAuth(req, headers); this.requireDomain(domain);
    const preset_key = String(body.preset_key || "").trim();
    if (!preset_key) throw new HttpException("preset_key required", 400);
    // axes 필터(선택): 지정하면 그 축만 프리셋으로 채운다(예 ["keyword"] — region 등 동기화 축 보존).
    const onlyAxes = Array.isArray(body.axes) ? (body.axes as unknown[]).map((a) => String(a)).filter((a): a is AxisName => ["region", "keyword", "intent", "persona", "modifier"].includes(a)) : undefined;
    this.slots.applyPreset(domain, preset_key, onlyAxes);
    return { ok: true, preset_key, axes: this.db.listAxes(domain) };
  }

  @Get("domains/:domain/slots")
  listSlots(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Query() query: Row) {
    checkAuth(req, headers); this.requireDomain(domain);
    const filters = { status: query.status || undefined, template: query.template || undefined, q: query.q || undefined };
    const items = this.db.listSlots(domain, { ...filters, limit: clampInt(query.limit, 300, 1, 2000), offset: clampInt(query.offset, 0, 0, 1000000) });
    return { count: items.length, total: this.db.countSlotsFiltered(domain, filters), slot_counts: this.db.countSlots(domain), items };
  }

  @Post("domains/:domain/slots/generate")
  generateSlots(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Body() body: Row) {
    checkAuth(req, headers); this.requireDomain(domain);
    // template(단일)/templates(배열)가 오면 그 유형만 후보 생성한다. 없으면 기존대로 enabled 전 유형.
    const rawTemplates = Array.isArray(body.templates) ? body.templates : (body.template ? [body.template] : []);
    const templates = rawTemplates.map((t: any) => String(t).trim()).filter(Boolean);
    // 글유형당 상한은 MAX_SLOTS_PER_TEMPLATE 로 클램프한다(축 조합 폭발 → 메모리/삽입 폭주로 인한 500 방지).
    const maxPerTemplate = clampInt(body.max_per_template, 200, 1, MAX_SLOTS_PER_TEMPLATE);
    const opts: { templates?: string[]; maxPerTemplate: number } = { maxPerTemplate };
    if (templates.length) opts.templates = templates;
    const summary = this.slots.generateSlotsForDomain(domain, opts);
    return { ok: true, max_per_template: maxPerTemplate, summary, slot_counts: this.db.countSlots(domain) };
  }

  @Delete("domains/:domain/slots/:slotId")
  deleteSlot(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Param("slotId") slotId: string) {
    checkAuth(req, headers); this.requireDomain(domain); return { ok: true, deleted: this.db.deleteSlot(domain, slotId) };
  }

  @Post("domains/:domain/slots/:slotId/reset")
  resetSlot(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Param("slotId") slotId: string) {
    checkAuth(req, headers); this.requireDomain(domain);
    const slot = this.db.getSlot(slotId); if (!slot || slot.domain !== domain) throw new HttpException("slot not found", 404);
    this.db.updateSlotStatus(slotId, "planned", null); return { ok: true, slot: this.db.getSlot(slotId) };
  }

  // 슬롯 수동 제목 오버라이드. title=null/"" 이면 규칙/LLM 로 폴백. {지역}/{개수}/{키워드}/{학원명} 은 생성 시점 치환.
  @Patch("domains/:domain/slots/:slotId")
  updateSlot(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Param("slotId") slotId: string, @Body() body: Row) {
    checkAuth(req, headers); this.requireDomain(domain);
    const slot = this.db.getSlot(slotId); if (!slot || slot.domain !== domain) throw new HttpException("slot not found", 404);
    if (body.title !== undefined) this.db.updateSlotTitle(slotId, body.title == null ? null : String(body.title));
    return { ok: true, slot: this.db.getSlot(slotId) };
  }

  @Get("domains/:domain/posts")
  listPosts(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Query() query: Row) {
    checkAuth(req, headers); this.requireDomain(domain);
    const items = this.db.listPosts(domain, { status: query.status || undefined, jobId: query.job_id || undefined, limit: clampInt(query.limit, 100, 1, 500) });
    return { count: items.length, items };
  }

  @Get("domains/:domain/posts/:postId")
  getPost(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Param("postId") postId: string, @Query("include_rendered") rendered = "") {
    checkAuth(req, headers); this.requireDomain(domain);
    const post = this.db.getPost(postId); if (!post || post.domain !== domain) throw new HttpException("post not found", 404);
    const dbImages = safeJson(post.images, {});
    const mergedImages = { ...fallbackImagesForPost(this.db, domain, post), ...(dbImages && typeof dbImages === "object" ? dbImages : {}) };
    const bodyMarkdown = ensureImageSlotsForRender(stripPseudoSlotsForRender(post.body_markdown || ""), mergedImages);
    const responsePost = {
      ...post,
      body_markdown: bodyMarkdown,
      images: Object.keys(mergedImages).length ? JSON.stringify(mergedImages) : post.images,
    };
    const payload: Row = { post: responsePost };
    if (rendered === "true" || rendered === "1") payload.body_html = renderMarkdown(bodyMarkdown, mergedImages);
    return payload;
  }

  @Post("domains/:domain/posts/export")
  exportPosts(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Body() body: Row, @Res() res: Response) {
    checkAuth(req, headers); const domainConfig = this.requireDomain(domain);
    const ids = (Array.isArray(body.post_ids) ? body.post_ids : []).map((id: any) => String(id)).filter(Boolean);
    const format = String(body.format || "markdown").trim().toLowerCase();
    if (!ids.length) throw new HttpException("post_ids required", 400);
    if (!["markdown", "html"].includes(format)) throw new HttpException("format must be markdown or html", 400);
    const posts = ids.map((id: string) => this.db.getPost(id)).filter((post: Row | undefined): post is Row => Boolean(post && post.domain === domain && post.status !== "deleted"));
    if (!posts.length) throw new HttpException("exportable posts not found", 404);
    const exported = posts.map((post) => normalizePostForAdminExport(this.db, domain, post));
    const filename = safeExportFilename(`${domain}-posts-${format === "html" ? "html" : "markdown"}.zip`);
    const files = exported.map((post, index) => ({
      name: safeExportFilename(`${String(index + 1).padStart(3, "0")}-${post.id}.${format === "html" ? "html" : "md"}`),
      content: format === "html" ? renderSingleHtmlExport(domainConfig, domain, post) : renderSingleMarkdownExport(domain, post),
    }));
    const zip = createZip(files);
    res.setHeader("content-type", "application/zip");
    res.setHeader("content-disposition", `attachment; filename="${filename}"`);
    res.send(zip);
  }

  @Delete("domains/:domain/posts/:postId")
  deletePost(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Param("postId") postId: string) {
    checkAuth(req, headers); this.requireDomain(domain);
    const post = this.db.getPost(postId); if (!post || post.domain !== domain) throw new HttpException("post not found", 404);
    this.db.deletePost(postId); return { ok: true };
  }

  // --- 격리(draft_posts) 검수: 품질 게이트 미통과 글을 관리자가 확인/발행/반려 ---
  @Get("domains/:domain/drafts")
  listDrafts(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Query() query: Row) {
    checkAuth(req, headers); this.requireDomain(domain);
    const items = this.db.listDraftPosts(domain, { reviewStatus: query.status || undefined, limit: clampInt(query.limit, 100, 1, 500) })
      .map((draft) => ({ ...draft, quality_issues: safeJson(draft.quality_issues, []) }));
    return { count: items.length, pending: this.db.countDraftPosts(domain, "pending"), items };
  }

  @Get("domains/:domain/drafts/:draftId")
  getDraft(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Param("draftId") draftId: string, @Query("include_rendered") rendered = "") {
    checkAuth(req, headers); this.requireDomain(domain);
    const draft = this.db.getDraftPost(draftId); if (!draft || draft.domain !== domain) throw new HttpException("draft not found", 404);
    const dbImages = safeJson(draft.images, {});
    const mergedImages = { ...fallbackImagesForPost(this.db, domain, draft), ...(dbImages && typeof dbImages === "object" ? dbImages : {}) };
    const bodyMarkdown = ensureImageSlotsForRender(stripPseudoSlotsForRender(draft.body_markdown || ""), mergedImages);
    const responseDraft = {
      ...draft,
      quality_issues: safeJson(draft.quality_issues, []),
      body_markdown: bodyMarkdown,
      images: Object.keys(mergedImages).length ? JSON.stringify(mergedImages) : draft.images,
    };
    const payload: Row = { draft: responseDraft };
    if (rendered === "true" || rendered === "1") payload.body_html = renderMarkdown(bodyMarkdown, mergedImages);
    return payload;
  }

  @Post("domains/:domain/drafts/:draftId/promote")
  promoteDraft(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Param("draftId") draftId: string) {
    checkAuth(req, headers); this.requireDomain(domain);
    const draft = this.db.getDraftPost(draftId); if (!draft || draft.domain !== domain) throw new HttpException("draft not found", 404);
    if (draft.review_status === "promoted") throw new HttpException("이미 발행된 초안입니다", 409);
    // UI 우회 방지: 저장된 이슈로 서버에서 다시 차단 등급을 계산한다. B(안전/사실)가 남아 있으면 발행 불가.
    const codes = (safeJson(draft.quality_issues, []) as Row[]).map((issue) => String(issue.code ?? issue));
    if (blockingClass(codes) === "B") throw new HttpException("안전·사실(B) 이슈가 남아 있어 발행할 수 없습니다. 본문을 수정해 재검증하세요.", 409);
    const postId = this.db.promoteDraftToPost(draftId);
    return { ok: true, post_id: postId };
  }

  @Post("domains/:domain/drafts/:draftId/revalidate")
  revalidateDraft(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Param("draftId") draftId: string, @Body() body: Row) {
    checkAuth(req, headers); this.requireDomain(domain);
    const draft = this.db.getDraftPost(draftId); if (!draft || draft.domain !== domain) throw new HttpException("draft not found", 404);
    const newBody = typeof body?.body_markdown === "string" && body.body_markdown.trim() ? body.body_markdown : String(draft.body_markdown || "");
    const images = safeJson(draft.images, {}) as Record<string, string>;
    const factsText = String(draft.facts_text || "");
    const monitoredPhrases = parseMonitoredPhrases(this.db.getDomain(domain)?.monitored_phrases);
    // 워커의 두 게이트(본문·최종 표면)를 저장된 facts 로 그대로 재현한다.
    const articleIssues = articleQualityIssues(newBody, factsText, images, monitoredPhrases, domain);
    const surfaceIssues = postSurfaceQualityIssues(
      { title: draft.title, body_markdown: newBody, images: Object.keys(images).length ? JSON.stringify(images) : null, design_template_id: draft.design_template_id },
      3500, renderedCandidateCount(newBody, factsText), monitoredPhrases, domain,
    );
    // t01 데이터 게이트는 별도 모듈이라 여기서 재실행하지 않는다(워커 캡처 훅과 함께 연결 예정).
    // 그전까지는 기존에 걸린 t01_ 코드를 보수적으로 유지해 안전 이슈가 재검증으로 사라지지 않게 한다.
    const carriedT01 = (safeJson(draft.quality_issues, []) as Row[]).map((issue) => String(issue.code ?? issue)).filter((code) => code.startsWith("t01_"));
    const codes = Array.from(new Set([...articleIssues, ...surfaceIssues, ...carriedT01]));
    const classified = classifyIssues(codes);
    const bc = blockingClass(codes);
    this.db.updateDraftAfterRevalidate(draftId, newBody, JSON.stringify(classified), bc);
    return { ok: true, quality_issues: classified, blocking_class: bc, promotable: bc !== "B" };
  }

  @Post("domains/:domain/drafts/:draftId/dismiss")
  dismissDraft(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Param("draftId") draftId: string) {
    checkAuth(req, headers); this.requireDomain(domain);
    const draft = this.db.getDraftPost(draftId); if (!draft || draft.domain !== domain) throw new HttpException("draft not found", 404);
    this.db.setDraftReviewStatus(draftId, "dismissed"); return { ok: true };
  }

  @Delete("domains/:domain/drafts/:draftId")
  deleteDraft(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Param("draftId") draftId: string) {
    checkAuth(req, headers); this.requireDomain(domain);
    const draft = this.db.getDraftPost(draftId); if (!draft || draft.domain !== domain) throw new HttpException("draft not found", 404);
    this.db.deleteDraftPost(draftId); return { ok: true };
  }

  @Get("domains/:domain/academies")
  listAcademies(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Query() query: Row) {
    checkAuth(req, headers); this.requireDomain(domain);
    const items = this.db.listAcademies(domain, {
      region: query.region || undefined,
      academy_type: query.academy_type || undefined,
      q: query.q || undefined,
      has_photos: query.has_photos === "1" || query.has_photos === "true",
      limit: clampInt(query.limit, 500, 1, 1000),
    });
    return { count: items.length, items, academy_types: this.db.listAcademyTypes(domain) };
  }

  @Post("domains/:domain/academies")
  upsertAcademies(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Body() body: any) {
    checkAuth(req, headers); this.requireDomain(domain);
    let rows = body?.items !== undefined ? body.items : body;
    if (rows && !Array.isArray(rows)) rows = [rows];
    if (!Array.isArray(rows)) throw new HttpException("expected a JSON academy object, array, or {items:[...]}", 400);
    return { ok: true, upserted: this.db.upsertAcademies(domain, rows) };
  }

  @Post("domains/:domain/sync/drivingplus/academies")
  async syncDrivingplusAcademies(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Body() body: Row = {}) {
    checkAuth(req, headers); this.requireDomain(domain);
    // 셔틀 운행 지역은 학원 동기화 시점에 계산해 저장한다. 사전이 없으면 지역이 비므로 먼저 확보한다
    // (이미 최신이면 원천을 호출하지 않는다). 실패해도 학원 동기화는 계속 진행한다.
    await this.regionDirectory.ensure().catch(() => null);
    const rows = await this.drivingplus.fetchAcademies({
      includeReviews: body.include_reviews !== false,
      reviewLimit: clampInt(body.review_limit, 5, 1, 10),
      reviewSort: body.review_sort === "new" ? "new" : "point",
      includeBlogReviews: body.include_blog_reviews !== false,
      blogReviewLimit: clampInt(body.blog_review_limit, 3, 1, 10),
    });
    return { ok: true, ...this.db.upsertDrivingplusAcademies(domain, rows) };
  }

  @Post("domains/:domain/sync/drivingplus/regions")
  async syncDrivingplusRegions(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Body() body: Row) {
    checkAuth(req, headers); this.requireDomain(domain);
    const level = normalizeSeoRegionLevel(body.level);
    const replaceAxis = Boolean(body.replace_axis);
    const max = clampInt(body.max, level === "3" ? 500 : 10000, 1, 10000);
    const rows = (await this.drivingplus.fetchSeoRegions(level)).slice(0, max);
    const summary = this.db.upsertSeoRegions(domain, rows);
    let axis_replaced = false;
    if (replaceAxis) {
      const axisRows = rows.map((r) => ({ value: r.region, weight: r.level === 2 ? 5 : 3, monthly_search_volume: null, competition_kd: null }));
      this.db.bulkReplaceAxis(domain, "region", axisRows);
      axis_replaced = true;
    }
    return { ok: true, level, axis_replaced, ...summary };
  }

  @Post("domains/:domain/sync/drivingplus")
  async syncDrivingplusAll(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Body() body: Row) {
    checkAuth(req, headers); this.requireDomain(domain);
    const level = normalizeSeoRegionLevel(body.level || "2");
    const regions = await this.drivingplus.fetchSeoRegions(level);
    const regionSummary = this.db.upsertSeoRegions(domain, regions);
    if (body.replace_axis) this.db.bulkReplaceAxis(domain, "region", regions.map((r) => ({ value: r.region, weight: r.level === 2 ? 5 : 3, monthly_search_volume: null, competition_kd: null })));
    // 셔틀 운행 지역은 학원 동기화 시점에 계산해 저장한다. 사전이 없으면 지역이 비므로 먼저 확보한다
    // (이미 최신이면 원천을 호출하지 않는다). 실패해도 학원 동기화는 계속 진행한다.
    await this.regionDirectory.ensure().catch(() => null);
    const academies = await this.drivingplus.fetchAcademies({
      includeReviews: body.include_reviews !== false,
      reviewLimit: clampInt(body.review_limit, 5, 1, 10),
      reviewSort: body.review_sort === "new" ? "new" : "point",
      includeBlogReviews: body.include_blog_reviews !== false,
      blogReviewLimit: clampInt(body.blog_review_limit, 3, 1, 10),
    });
    const academySummary = this.db.upsertDrivingplusAcademies(domain, academies);
    return { ok: true, regions: regionSummary, academies: academySummary, axis_replaced: Boolean(body.replace_axis), level };
  }

  @Delete("domains/:domain/academies/:academyId")
  deleteAcademy(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Param("academyId") academyId: string) {
    checkAuth(req, headers); this.requireDomain(domain); return { ok: true, deleted: this.db.deleteAcademy(domain, academyId) };
  }

  // 학원 자료 일괄 삭제. region 쿼리가 있으면 그 지역만, 없으면 도메인 전체.
  @Delete("domains/:domain/academies")
  deleteAcademies(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Query() query: Row) {
    checkAuth(req, headers); this.requireDomain(domain);
    const region = String(query.region || "").trim();
    return { ok: true, deleted: this.db.deleteAcademies(domain, region || undefined) };
  }

  @Post("domains/:domain/jobs/generate")
  enqueueGenerate(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Body() body: Row) {
    checkAuth(req, headers); const domainMeta = this.requireDomain(domain);
    let slotIds = Array.isArray(body.slot_ids) ? body.slot_ids.map((id: any) => String(id)).filter(Boolean) : [];
    const batchOpts = {
      q: body.q || undefined,
      template: body.template || undefined,
      limit: clampInt(body.max, 10, 1, 500),
      balanced: Boolean(body.balanced),
    };
    if (!slotIds.length) {
      slotIds = this.db.selectSlotsForBatch(domain, batchOpts).map((s) => s.slot_id);
    } else {
      const exclusionTerms = parseExclusionTerms(domainMeta.excluded_keywords);
      if (exclusionTerms.length) {
        slotIds = slotIds.filter((slotId) => {
          const slot = this.db.getSlot(slotId);
          return slot && slot.domain === domain && !findSlotExclusionTerms(slot, exclusionTerms).length;
        });
      }
    }
    // 작성은 기존 planned 후보만 사용한다. 후보 생성은 '재료로 글 후보 만들기'(slots/generate) 전용이며 여기서 자동 생성하지 않는다.
    if (!slotIds.length) {
      throw new HttpException(
        "작성할 planned 후보가 없습니다. 먼저 ‘재료로 글 후보 만들기’로 후보를 만든 뒤 작성하세요. (검색어·유형·제외 목록도 확인하세요.)",
        400,
      );
    }
    const enableImageGeneration = Boolean(body.enable_image_generation);
    const defaultTimeoutSec = enableImageGeneration ? 1200 : 600;
    // 모드가 생략되면 worker 가 슬롯별로 T01 계보는 Legacy Plus, 그 외는 Legacy를
    // 선택한다. 하나의 배치에 두 계보가 섞여도 생성 경로가 섞이지 않게 auto를 보존한다.
    // 명시 legacy는 기존 동작을 강제하는 호환 탈출구다.
    const generationMode = body.generation_mode === undefined || body.generation_mode === null || body.generation_mode === ""
      ? "auto"
      : String(body.generation_mode);
    if (["t01_data_gated_v2", "t01_hybrid_v1"].includes(generationMode)) {
      throw new HttpException(`retired generation_mode: ${generationMode}; use legacy or ${T01_LEGACY_PLUS_MODE}`, 400);
    }
    if (!["auto", "legacy", T01_LEGACY_PLUS_MODE].includes(generationMode)) {
      throw new HttpException(`unknown generation_mode: ${generationMode}`, 400);
    }
    if (generationMode === T01_LEGACY_PLUS_MODE) {
      const nonT01 = slotIds.map((slotId) => this.db.getSlot(slotId)).find((slot) => {
        if (!slot) return true;
        const spec = this.db.getTemplateSpec(domain, String(slot.template_id || ""));
        return !isT01TemplateFamily(slot.template_id, spec?.origin_template_id);
      });
      if (nonT01) throw new HttpException(`${generationMode} is only supported for T01 slots`, 400);
    }
    const job_id = this.db.enqueueJob(domain, "generate", {
      slot_ids: slotIds,
      provider: body.provider || "codex",
      model: String(body.model || "").trim(),
      design_template_id: body.design_template_id,
      use_web_research: body.use_web_research ?? true,
      cooldown_sec: body.cooldown_sec ?? 60,
      timeout_sec: body.timeout_sec ?? defaultTimeoutSec,
      enable_image_generation: enableImageGeneration,
      image_generation_required: Boolean(body.image_generation_required),
      image_count: clampInt(body.image_count, 1, 1, 3),
      image_size: String(body.image_size || "1024x1024"),
      image_model: String(body.image_model || "").trim(),
      image_provider: String(body.image_provider || "private-codex").trim(),
      generation_mode: generationMode,
    });
    return { ok: true, job_id, slot_count: slotIds.length };
  }
  @Post("domains/:domain/jobs/dedup")
  enqueueDedup(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Body() body: Row) {
    checkAuth(req, headers); this.requireDomain(domain); return { ok: true, job_id: this.db.enqueueJob(domain, "dedup", { threshold: body.threshold ?? 0.75, dry_run: body.dry_run ?? false }) };
  }
  @Post("domains/:domain/jobs/prune")
  enqueuePrune(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Body() body: Row) {
    checkAuth(req, headers); this.requireDomain(domain); return { ok: true, job_id: this.db.enqueueJob(domain, "prune", { min_body_chars: body.min_body_chars ?? 700, stale_noindex_days: body.stale_noindex_days ?? 90, dry_run: body.dry_run ?? false }) };
  }
  @Post("domains/:domain/jobs/indexing")
  enqueueIndexing(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Body() body: Row) {
    checkAuth(req, headers); this.requireDomain(domain); return { ok: true, job_id: this.db.enqueueJob(domain, "indexing", { max: body.max ?? 200, type: "URL_UPDATED" }) };
  }

  @Get("jobs")
  listJobs(@Req() req: Request, @Headers() headers: Record<string, string>, @Query() query: Row) {
    checkAuth(req, headers);
    const items = this.db.listJobs({ domain: query.domain || undefined, status: query.status || undefined, limit: clampInt(query.limit, 200, 1, 1000) }).map(jobOut);
    return { count: items.length, items };
  }

  @Post("jobs/:id/cancel")
  cancelJob(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("id") id: string) {
    checkAuth(req, headers); return this.db.cancelJob(id);
  }

  @Post("jobs/:id/pause")
  pauseJob(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("id") id: string) {
    checkAuth(req, headers); return { ok: this.db.pauseJob(id) };
  }

  @Post("jobs/:id/resume")
  resumeJob(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("id") id: string) {
    checkAuth(req, headers); return { ok: this.db.resumeJob(id) };
  }

  @Post("jobs/:id/prioritize")
  prioritizeJob(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("id") id: string) {
    checkAuth(req, headers); return { ok: this.db.prioritizeJob(id) };
  }

  @Get("settings/indexing")
  getIndexing(@Req() req: Request, @Headers() headers: Record<string, string>) {
    checkAuth(req, headers); return { has_key: Boolean(this.db.getSetting("google_sa_json")), url_template: this.indexingUrlTemplate() };
  }
  @Put("settings/indexing")
  saveIndexing(@Req() req: Request, @Headers() headers: Record<string, string>, @Body() body: Row) {
    checkAuth(req, headers);
    const sa = String(body.sa_json || "").trim();
    if (sa && !isServiceAccount(sa)) throw new HttpException("서비스계정 JSON 형식 오류(client_email/private_key 필요)", 400);
    if (sa) this.db.setSetting("google_sa_json", sa);
    if (String(body.url_template || "").trim()) this.db.setSetting("indexing_url_template", String(body.url_template).trim());
    return { ok: true, has_key: Boolean(this.db.getSetting("google_sa_json")), url_template: this.indexingUrlTemplate() };
  }

  // 전역 빌트인 노출 목록(검증용 임시). body.exposed = 노출 허용 id 배열 | null(전체 노출로 초기화).
  // 노출 제어는 UI 카탈로그/커스텀 시작점/아키타입 목록에만 영향(비파괴) — 이미 켠 유형의 생성엔 영향 없음.
  @Put("settings/builtin-visibility")
  saveBuiltinVisibility(@Req() req: Request, @Headers() headers: Record<string, string>, @Body() body: Row) {
    checkAuth(req, headers);
    const exposed = body.exposed;
    if (exposed === null || exposed === undefined) {
      this.db.setSetting("exposed_builtin_template_ids", null); // 설정 삭제 → 기본값(T01)으로 복귀
    } else {
      if (!Array.isArray(exposed)) throw new HttpException("exposed must be an array or null", 400);
      const valid = new Set(Object.keys(TEMPLATE_SPECS));
      const ids = [...new Set(exposed.map((x: unknown) => String(x)).filter((x: string) => valid.has(x)))];
      // 명시 목록을 그대로 저장(전부 노출도 명시 저장). 저장 안 하면 기본값 T01 만 노출된다.
      this.db.setSetting("exposed_builtin_template_ids", JSON.stringify(ids));
    }
    return { ok: true, exposed_builtin_template_ids: this.exposedBuiltinIds() };
  }

  // 저장된 노출 목록 파싱. 설정이 없거나 파싱 실패면 기본값(T01)만 노출.
  private exposedBuiltinIds(): string[] {
    const raw = this.db.getSetting("exposed_builtin_template_ids");
    if (!raw) return [...DEFAULT_EXPOSED_BUILTIN_TEMPLATE_IDS];
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((x: unknown): x is string => typeof x === "string") : [...DEFAULT_EXPOSED_BUILTIN_TEMPLATE_IDS]; }
    catch { return [...DEFAULT_EXPOSED_BUILTIN_TEMPLATE_IDS]; }
  }

  // 전역 행정구역 사전. 도메인별이 아니라 모든 도메인이 같은 표를 본다.
  // 도메인 생성 시 자동으로 준비되므로 이 엔드포인트는 수동 갱신(행정구역 개편 등)용이다.
  @Get("settings/region-directory")
  regionDirectoryStatus(@Req() req: Request, @Headers() headers: Record<string, string>) {
    checkAuth(req, headers); return this.db.regionDirectoryStatus();
  }
  @Post("settings/region-directory/sync")
  async syncRegionDirectory(@Req() req: Request, @Headers() headers: Record<string, string>) {
    checkAuth(req, headers);
    const result = await this.regionDirectory.sync();
    return { ok: true, ...result, ...this.db.regionDirectoryStatus() };
  }

  // 업종 레지스트리(라벨 MVP): 작업환경에서 key/label 추가·삭제. key 는 프리셋 선택·프롬프트에 쓰인다.
  // 주의: 새 key 는 프리셋(PRESETS)이 없어 해당 도메인은 축이 빈 상태로 시작한다(생성은 driving 프리셋만 실효).
  @Get("settings/verticals")
  listVerticals(@Req() req: Request, @Headers() headers: Record<string, string>) {
    checkAuth(req, headers); return { items: this.db.getVerticals() };
  }
  @Post("settings/verticals")
  addVertical(@Req() req: Request, @Headers() headers: Record<string, string>, @Body() body: Row) {
    checkAuth(req, headers);
    const key = String(body.key || "").trim().toLowerCase();
    const label = String(body.label || "").trim();
    if (!/^[a-z0-9-]+$/.test(key)) throw new HttpException("업종 key는 영문 소문자·숫자·하이픈만 사용하세요.", 400);
    if (!label) throw new HttpException("표시명(label)을 입력하세요.", 400);
    const list = this.db.getVerticals();
    if (list.some((v) => v.key === key)) throw new HttpException("이미 존재하는 업종 key 입니다.", 409);
    list.push({ key, label });
    this.db.setVerticals(list);
    return { ok: true, items: list };
  }
  @Delete("settings/verticals/:key")
  deleteVertical(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("key") key: string) {
    checkAuth(req, headers);
    if (key === "driving") throw new HttpException("기본 업종(driving)은 삭제할 수 없습니다.", 400);
    const inUse = this.db.countDomainsByVertical(key);
    if (inUse > 0) throw new HttpException(`이 업종을 쓰는 도메인이 ${inUse}개 있어 삭제할 수 없습니다.`, 409);
    const list = this.db.getVerticals().filter((v) => v.key !== key);
    if (!list.length) throw new HttpException("최소 1개 업종은 남겨야 합니다.", 400);
    this.db.setVerticals(list);
    return { ok: true, items: list };
  }

  private requireDomain(domain: string): Row { const domainConfig = this.db.getDomain(domain); if (!domainConfig) throw new HttpException("domain not found", 404); return domainConfig; }
  private indexingUrlTemplate() { return this.db.getSetting("indexing_url_template") || "https://{domain}/community/{slug}"; }
}

export function checkAuth(req: Request, headers: Record<string, string>): void {
  if (!ADMIN_PASSWORD) return;
  const cookieHeader = req.headers.cookie || "";
  const cookieToken = cookieHeader.split(";").map((p: string) => p.trim()).find((p: string) => p.startsWith("admin_token="))?.split("=").slice(1).join("=") || "";
  const headerToken = headers["x-admin-token"] || "";
  const auth = headers.authorization || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (![cookieToken, headerToken, bearer].includes(ADMIN_PASSWORD)) throw new HttpException("Unauthorized", HttpStatus.UNAUTHORIZED);
}

function clampInt(value: any, fallback: number, min: number, max: number): number { const n = Number(value); return Math.max(min, Math.min(max, Number.isFinite(n) ? Math.trunc(n) : fallback)); }
function normalizeDesignOverrides(value: Row): Row {
  const templates = new Set(Object.keys(TEMPLATE_SPECS));
  const designs = new Set<string>(DESIGN_TEMPLATES.map((template) => template.id));
  return Object.fromEntries(Object.entries(value)
    .map(([templateId, designId]) => [String(templateId), String(designId || "")])
    .filter((entry) => templates.has(entry[0] ?? "") && designs.has(entry[1] ?? "")));
}

function normalizePostForAdminExport(db: DbService, domain: string, post: Row): Row {
  const dbImages = safeJson(post.images, {});
  const images = { ...fallbackImagesForPost(db, domain, post), ...(dbImages && typeof dbImages === "object" ? dbImages : {}) };
  const bodyMarkdown = ensureImageSlotsForRender(stripPseudoSlotsForRender(post.body_markdown || ""), images);
  return { ...post, body_markdown: bodyMarkdown, body_html: renderMarkdown(bodyMarkdown, images), images };
}

function renderSingleMarkdownExport(domain: string, post: Row): string {
  return [
    `<!-- domain: ${domain} -->`,
    `<!-- post_id: ${post.id} -->`,
    `<!-- slug: ${post.slug} -->`,
    `<!-- generated_at: ${post.generated_at || ""} -->`,
    "",
    String(post.body_markdown || "").trim(),
    "",
  ].join("\n");
}

function renderBulkMarkdownExport(domain: string, posts: Row[]): string {
  return [
    `<!-- exported_domain: ${domain} -->`,
    `<!-- exported_count: ${posts.length} -->`,
    `<!-- exported_at: ${new Date().toISOString()} -->`,
    "",
    ...posts.map((post, index) => [
      index ? "\n---\n" : "",
      `<!-- post_id: ${post.id} -->`,
      `<!-- slug: ${post.slug} -->`,
      `<!-- generated_at: ${post.generated_at || ""} -->`,
      "",
      String(post.body_markdown || "").trim(),
      "",
    ].join("\n")),
  ].join("\n").trim() + "\n";
}

function renderSingleHtmlExport(domainConfig: Row, domain: string, post: Row): string {
  const rawDesignId = String(post.design_template_id || domainConfig.design_template_id || "");
  const designId = resolveDesignId(rawDesignId);
  const design = getDesignTheme(designId, domainConfig.brand_color);
  const articleClass = `design-${designId}`;
  const visibleDesignId = designId;
  const brand = publicBrandName(String(domainConfig.display_name || domain));
  const title = String(post.title || brand);
  const contentHtml = toPreviewBlocks(prepareBodyHtml(String(post.body_html || ""), title));
  const chips = designChips(designId);
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  ${post.meta_description ? `<meta name="description" content="${escapeAttr(String(post.meta_description))}" />` : ""}
  <style>${standaloneExportCss()}</style>
</head>
<body>
  <main class="post-page">
    <article class="preview-phone preview-phone-fluid ${articleClass}" style="--accent:${design.accent};--accent-soft:${design.soft};--primary:${design.accent};background:${design.pageBg}">
      <div class="preview-top"><div><b>${escapeHtml(brand)}</b><p>${escapeHtml(design.label)}</p></div><span class="preview-cta">${escapeHtml(design.topCta)}</span></div>
      <div class="preview-hero post-hero title-hero">
        <div>
          <span>${escapeHtml(design.label)}</span>
          <h3>${escapeHtml(title)}</h3>
        </div>
      </div>
      <div class="preview-body">
        <div class="preview-meta"><span>${escapeHtml(formatShortDate(String(post.generated_at || "")))}</span><span>${escapeHtml(visibleDesignId)}</span></div>
        <div class="preview-divider"></div>
        <div class="row post-chips">${chips.map((chip) => `<span class="badge">${escapeHtml(chip)}</span>`).join("")}</div>
        <div class="generated-blocks">
${contentHtml}
        </div>
        <section class="preview-bottom-cta"><b>${escapeHtml(brand)}에서 ${escapeHtml(design.bottomCta)}</b><a class="btn primary" href="#">${escapeHtml(design.bottomCta)}</a></section>
      </div>
    </article>
  </main>
</body>
</html>`;
}

function renderBulkHtmlExport(domainConfig: Row, domain: string, posts: Row[]): string {
  return posts.map((post) => renderSingleHtmlExport(domainConfig, domain, post)).join("\n");
}

function designChips(designId: string): string[] {
  const chips: Record<string, string[]> = {
    editorial: ["가이드", "FAQ", "정보성"],
    comparison: ["비교 기준", "요약 표", "추천 케이스"],
    "local-guide": ["지역 고민", "주변 선택 기준", "동선/접근성"],
    checklist: ["요약", "준비 체크", "절차"],
    conversion: ["문제 공감", "해결 기준", "상담"],
    custom: ["상단 구성", "본문 규칙", "CTA 위치"],
  };
  return chips[designId] || chips["local-guide"]!;
}

function prepareBodyHtml(html: string, title: string): string {
  let out = html.trim();
  const escapedTitle = escapeRegExp(escapeHtml(title.trim()));
  out = out.replace(new RegExp(`^<h1>\\s*${escapedTitle}\\s*</h1>\\s*`, "i"), "");
  out = out.replace(/^<h1>[\s\S]*?<\/h1>\s*/i, "");
  return out;
}

function toPreviewBlocks(html: string): string {
  const blocks = html.match(/<figure class="post-image">[\s\S]*?<\/figure>|<div class="post-table-wrap">[\s\S]*?<\/div>|<blockquote>[\s\S]*?<\/blockquote>|<ul>[\s\S]*?<\/ul>|<ol>[\s\S]*?<\/ol>|<h2>[\s\S]*?<\/h2>|<h3>[\s\S]*?<\/h3>|<p>[\s\S]*?<\/p>/gi);
  if (!blocks?.length) return html ? `<section class="preview-block"><p>${html}</p></section>` : "";
  const groups: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (!current.length) return;
    groups.push(`<section class="preview-block">${current.join("\n")}</section>`);
    current = [];
  };
  for (const block of blocks) {
    if (block.startsWith("<figure")) { flush(); groups.push(block); continue; }
    if (block.startsWith("<h2") && current.length) flush();
    current.push(block);
  }
  flush();
  return groups.join("\n");
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value ? value.slice(0, 10) : "";
  return new Intl.DateTimeFormat("ko-KR", { year: "2-digit", month: "2-digit", day: "2-digit" }).format(date);
}

function standaloneExportCss(): string {
  return `
*{box-sizing:border-box}body{margin:0;background:transparent;color:#111827;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.post-page{width:100%;padding:0}.preview-phone{width:100%;max-width:none;border:1px solid #e5e7eb;border-radius:24px;overflow:hidden;background:white;box-shadow:0 20px 50px rgba(15,23,42,.14)}.preview-top{background:var(--primary);color:white;padding:16px;display:flex;justify-content:space-between;gap:10px;align-items:center}.preview-top p{margin:2px 0 0;opacity:.85;font-size:12px}.preview-cta{border-radius:12px;background:#ffe94d;color:#111827;padding:9px 12px;font-size:12px;font-weight:900;white-space:nowrap}.preview-hero{margin:18px;min-height:280px;border-radius:14px;background:radial-gradient(circle at 18% 20%,rgba(255,255,255,.55),transparent 30%),linear-gradient(135deg,var(--accent-soft),#f6f0ff 45%,#fff4a7);position:relative;overflow:hidden;display:flex;align-items:flex-end;padding:22px}.preview-hero.title-hero h3{margin:10px 0 0;font-size:clamp(24px,4.6vw,48px);line-height:1.18;letter-spacing:-.055em;color:#111827}.preview-hero span{display:inline-flex;border-radius:999px;background:rgba(255,255,255,.88);padding:6px 10px;font-size:11px;color:var(--primary);font-weight:900}.preview-body{padding:0 22px 22px}.preview-meta{display:flex;justify-content:center;gap:16px;color:#94a3b8;font-size:11px}.preview-divider{height:9px;border-radius:999px;background:#ffe94d;margin:14px 0}.row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.post-chips{margin-bottom:14px}.badge{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:4px 8px;font-size:12px;font-weight:800;background:#f1f5f9;color:#334155}.generated-blocks{display:grid;gap:12px}.preview-block{border-radius:12px;background:#f8fafc;padding:12px;margin:0;font-size:14px;line-height:1.75}.preview-block p{margin:6px 0 0;color:#64748b}.generated-blocks ul{display:grid;gap:8px;margin:10px 0 0;padding-left:0;list-style:none;color:#475569}.generated-blocks ul li{position:relative;margin:0;padding-left:24px}.generated-blocks ul li::before{content:"✓";position:absolute;left:0;top:0;color:var(--primary);font-weight:900;line-height:inherit}.generated-blocks ol{margin:10px 0 0;padding-left:22px;color:#475569}.generated-blocks ol li{margin:6px 0;padding-left:2px}.generated-blocks blockquote{margin:0;border-left:4px solid #ffe94d;background:#fafaf7;padding:12px;border-radius:0 12px 12px 0;color:#475569}.preview-block strong{font-weight:900;color:#020617}.preview-block a{color:var(--primary);font-weight:800}.post-table-wrap{overflow:auto;border:1px solid #e5e7eb;border-radius:12px;background:white}.post-table-wrap table{min-width:680px;margin:0;font-size:13px}.post-table-wrap th{background:#fffacc;color:#111827;font-weight:900}.post-table-wrap td{background:white}.preview-block code{border-radius:6px;background:#e2e8f0;padding:2px 6px}.preview-block h2,.preview-block h3{margin:0 0 6px;font-size:16px}.post-image{margin:0;border-radius:14px;overflow:hidden}.post-image img{display:block;width:100%;max-height:520px;object-fit:cover;border-radius:14px}.cite{color:#64748b;font-size:.72em}.preview-bottom-cta{margin-top:18px;border:2px solid #ffe94d;border-radius:16px;background:#fafaf7;padding:16px;text-align:center;display:grid;gap:12px}.btn{display:inline-flex;align-items:center;justify-content:center;border-radius:12px;padding:10px 14px;text-decoration:none;font-weight:900}.btn.primary{background:var(--primary);color:white}.design-comparison .preview-divider{background:repeating-linear-gradient(90deg,var(--primary) 0,var(--primary) 22px,#ffe94d 22px,#ffe94d 36px)}.design-local-guide .preview-divider{border-top:2px dashed rgba(81,50,215,.45);background:transparent;height:16px}.design-checklist .preview-divider{height:auto;padding:8px;border:1px solid #ffe94d;background:#fffacc;color:var(--primary);text-align:center;font-size:10px;font-weight:900;letter-spacing:.16em}.design-checklist .preview-divider::before{content:"CHECK BEFORE RESERVATION"}.design-conversion .preview-top{background:#111827}.design-conversion .preview-divider{background:linear-gradient(90deg,var(--primary),#ffe94d,var(--primary))}.design-conversion .preview-bottom-cta{background:#111827;color:white}.design-conversion .preview-bottom-cta .btn.primary{background:#ffe94d;color:#111827}@media(max-width:720px){.preview-phone{border-radius:0}.preview-top{align-items:flex-start;flex-direction:column}}`;
}

function safeExportFilename(value: string): string {
  return String(value || "posts.md")
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "post";
}
function createZip(files: Array<{ name: string; content: string | Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const data = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}
function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff]!;
  return (crc ^ 0xffffffff) >>> 0;
}
const CRC32_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
// 축 값 AI 제안 프롬프트: 유형 맥락(아키타입 작성지침 + 커스텀 방향성 + 도메인 공통원칙) + 축별 정의/개수 + JSON-only 출력.
function buildAxisSuggestPrompt(o: { domainName: string; kind: string; primary: string; name: string; direction: string; keywords?: string[]; axes: string[]; commonPrinciples?: string; writingGuide?: string[] }): string {
  const axisSpec: Record<string, string> = {
    persona: 'persona: 이 글의 독자(누구에게 말하는가). 구체적 상황·니즈를 담은 짧은 명사구. 예: "주말만 가능한 직장인", "집 근처 학원을 찾는 수강생".',
    intent: 'intent: 사용자가 알고 싶어하는 정보 의도. 짧은 명사구. 예: "준비물", "비용확인", "근처학원".',
    modifier: 'modifier: 주키워드에 붙는 짧은 강조 수식어. 예: "가까운", "비용절약", "야간반".',
  };
  const counts: Record<string, string> = { persona: "10~14개", intent: "4~6개", modifier: "5~8개" };
  const wanted = o.axes.map((a) => `- ${axisSpec[a]} (${counts[a]})`).join("\n");
  const guide = (o.writingGuide ?? []).map((g) => `- ${g}`).join("\n");
  const principles = String(o.commonPrinciples || "").trim();
  const keywords = (o.keywords ?? []).filter(Boolean);
  return [
    "너는 한국 운전면허·운전학원 SEO 콘텐츠의 축(axis) 값을 제안하는 도우미다.",
    `대상 글유형: "${o.name || o.kind}" (아키타입 kind=${o.kind}, 주축=${o.primary === "region" ? "지역형(지역+키워드)" : "키워드형"}).`,
    guide ? `이 아키타입이 쓰는 글의 작성 지침(이 글이 무엇을 하는지 참고):\n${guide}` : "",
    o.direction ? `이 커스텀 글유형의 방향성: ${o.direction}` : "",
    keywords.length ? `이 글유형이 노리는 주키워드(이 키워드에 딱 맞는 값으로 제안):\n${keywords.map((k) => `- ${k}`).join("\n")}` : "",
    principles ? `도메인 공통 원칙(톤·전략, 참고):\n${principles}` : "",
    "위 맥락 전체에 맞춰 아래 축 값을 제안하라:",
    wanted,
    "규칙: 운전면허·운전학원 도메인에 현실적으로 맞는 한국어 값만. 각 값은 짧고 서로 중복 없이. 가격·합격률 등 확인 불가한 수치를 값에 넣지 말 것.",
    '출력은 오직 JSON 하나. 키는 요청한 축만 포함. 예: {"persona":["...","..."],"modifier":["..."]}. JSON 외 다른 텍스트·코드펜스 금지.',
  ].filter(Boolean).join("\n\n");
}

// 방향성 검증 프롬프트: 방향성 ↔ (절대 원칙·공통원칙·writing_guide) 대조 + 고유 방향만 남긴 개선안 요청.
function buildDirectionValidatePrompt(o: { name: string; kind: string; direction: string; currentDirection?: string; commonPrinciples?: string; writingGuide?: string[]; absolutePrinciples: string }): string {
  const guide = (o.writingGuide ?? []).map((g) => `- ${g}`).join("\n");
  const principles = String(o.commonPrinciples || "").trim();
  const current = String(o.currentDirection || "").trim();
  return [
    "너는 한국 운전면허·운전학원 SEO 콘텐츠 시스템에서 '글유형 방향성(direction)'을 검증하는 도우미다.",
    "방향성은 '이 글유형만의 방향(무엇을 어떤 각도로 다루고, 어떤 전환으로 잇는지)'을 적는 자리다. 아래 '이미 강제되는 규칙'을 다시 진술하면 중복(불필요)이다.",
    `대상 글유형: "${o.name || o.kind}" (아키타입 kind=${o.kind}).`,
    `[이 유형에 이미 강제되는 절대 원칙 — 방향성에 다시 쓰면 중복]\n${o.absolutePrinciples}`,
    principles ? `[도메인 공통 원칙(톤·정책) — 다시 쓰면 중복]\n${principles}` : "",
    guide ? `[이 아키타입 작성 지침(writing_guide) — 다시 쓰면 중복]\n${guide}` : "",
    current ? `[이 글유형의 현재 방향성(참고)]\n${current}` : "",
    `[검증할 방향성 — 사용자 입력]\n${o.direction}`,
    "작업: (1) '검증할 방향성'의 각 요소가 위 절대 원칙/공통 원칙/작성 지침과 중복(이미 강제됨)되는지, 충돌하는지 판단하라. (2) 중복·충돌을 제거하고 이 글유형만의 고유 방향만 남긴 개선된 방향성을 1~3문장으로 제안하라. 고유 방향이 없으면 현재 방향성을 유지하는 제안을 하라.",
    "규칙: 안전·데이터 규칙(날조 금지, 내부흔적 금지 등)은 방향성에 넣지 않는다(이미 강제됨). 제안은 한국어로 간결하게.",
    '출력은 오직 JSON 하나: {"redundant":[{"text":"중복 부분","overlaps":"절대원칙|공통원칙|작성지침"}],"conflicting":[{"text":"충돌 부분","reason":"이유"}],"suggested_direction":"개선된 방향성 문장","summary":"한 문장 요약"}. JSON 외 텍스트·코드펜스 금지.',
  ].filter(Boolean).join("\n\n");
}

// 방향성 검증 응답 파싱. 첫 JSON 블록 추출 후 필드 정규화. suggested_direction 이 없으면 실패(null).
function parseDirectionValidation(text: string): { redundant: Array<{ text: string; overlaps: string }>; conflicting: Array<{ text: string; reason: string }>; suggested_direction: string; summary: string } | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let obj: any;
  try { obj = JSON.parse(m[0]); } catch { return null; }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const suggested = String(obj.suggested_direction ?? "").trim();
  if (!suggested) return null;
  const redundant = Array.isArray(obj.redundant) ? obj.redundant.map((r: any) => ({ text: String(r?.text ?? "").trim(), overlaps: String(r?.overlaps ?? "").trim() })).filter((r: any) => r.text).slice(0, 12) : [];
  const conflicting = Array.isArray(obj.conflicting) ? obj.conflicting.map((r: any) => ({ text: String(r?.text ?? "").trim(), reason: String(r?.reason ?? "").trim() })).filter((r: any) => r.text).slice(0, 12) : [];
  return { redundant, conflicting, suggested_direction: suggested, summary: String(obj.summary ?? "").trim() };
}

// LLM 응답 텍스트에서 첫 JSON 블록을 추출·검증해 요청한 축의 문자열 배열만 반환(코드펜스/설명 섞여도 방어).
function parseAxisSuggestion(text: string, axes: string[]): Record<string, string[]> {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return {};
  let obj: any;
  try { obj = JSON.parse(m[0]); } catch { return {}; }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const out: Record<string, string[]> = {};
  for (const axis of axes) {
    const list = obj[axis];
    if (!Array.isArray(list)) continue;
    const clean = [...new Set(list.map((v: unknown) => String(v ?? "").trim()).filter(Boolean))].slice(0, 20);
    if (clean.length) out[axis] = clean;
  }
  return out;
}

function publicBrandName(value: string): string { return value.replace(/\s*(?:샘플|데모)\s*$/u, "").trim() || value; }
function escapeRegExp(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function escapeHtml(s: string): string { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] || c)); }
function escapeAttr(s: string): string { return escapeHtml(s).replace(/'/g, "&#39;"); }
function normalizeSeoRegionLevel(value: any): SeoRegionLevel {
  const v = String(value || "2").trim();
  if (v === "all" || v === "2" || v === "3") return v;
  throw new HttpException("level must be one of all, 2, 3", 400);
}
function nullableNumber(value: any): number | null { if (value === "" || value === null || value === undefined) return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
function isServiceAccount(text: string): boolean { try { const o = JSON.parse(text); return Boolean(o.client_email && o.private_key); } catch { return false; } }
