import { Body, Controller, Delete, Get, Headers, HttpException, HttpStatus, Inject, Param, Patch, Post, Put, Query, Req, Res } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { DbService, domainOut, jobOut, safeJson } from "./db.service.js";
import { DrivingplusApiService, type SeoRegionLevel } from "./drivingplus-api.service.js";
import { AUTO_DESIGN_TEMPLATE_ID, DEFAULT_DRIVING_BRAND_COLOR, DEFAULT_DRIVING_COMMON_PRINCIPLES, DEFAULT_DRIVING_TEMPLATE_IDS, DEFAULT_DRIVING_VERTICAL, DESIGN_TEMPLATES, DRIVING_VERTICALS, TEMPLATE_SPECS, type AxisName } from "./constants.js";
import { SlotService } from "./slot.service.js";
import { ensureImageSlotsForRender, fallbackImagesForPost, renderMarkdown, stripPseudoSlotsForRender } from "./post-rendering.js";
import { findSlotExclusionTerms, parseExclusionTerms } from "./exclusions.js";
import { AXIS_TAG_VOCAB, safeTemplateOverrides } from "./axis-tags.js";
import { adminApiBaseUrl, drivingplusApiBaseUrl } from "./runtime-config.js";
import { getDesignTheme, resolveDesignId } from "./design-theme.js";

type Row = Record<string, any>;
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || "").trim();

@Controller("api/admin")
export class AdminController {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(SlotService) private readonly slots: SlotService,
    @Inject(DrivingplusApiService) private readonly drivingplus: DrivingplusApiService,
  ) {}

  @Get("options")
  options(@Req() req: Request, @Headers() headers: Record<string, string>) {
    checkAuth(req, headers);
    return {
      verticals: [...DRIVING_VERTICALS],
      themes: ["clean", "modern", "pro"],
      templates: Object.keys(TEMPLATE_SPECS),
      template_specs: TEMPLATE_SPECS,
      axis_tag_vocab: AXIS_TAG_VOCAB,
      design_templates: DESIGN_TEMPLATES,
      providers: ["codex", "claude"],
      preset_options: [DEFAULT_DRIVING_VERTICAL],
      indexing: { has_key: Boolean(this.db.getSetting("google_sa_json")), url_template: this.indexingUrlTemplate() }
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
    if (!DRIVING_VERTICALS.includes(vertical as any)) throw new HttpException("Adrock 회사용 운영본은 driving 도메인만 지원합니다", 400);
    if (this.db.getDomain(domain)) throw new HttpException("domain already exists", 409);
    this.db.createDomain({ domain, display_name, vertical, theme: body.theme, brand_color: body.brand_color || DEFAULT_DRIVING_BRAND_COLOR, daily_limit: body.daily_limit, templates_enabled: JSON.stringify(DEFAULT_DRIVING_TEMPLATE_IDS) });
    // 새 도메인은 디자인 자동 매칭으로 시작한다: 글마다 슬롯의 글 유형 기본 디자인을 적용(docs/design-template-mapping.md).
    this.db.updateDomain(domain, { design_template_id: AUTO_DESIGN_TEMPLATE_ID, common_principles: body.common_principles || body.content_brief || DEFAULT_DRIVING_COMMON_PRINCIPLES });
    if (body.apply_preset !== false) this.slots.applyPreset(domain, vertical);
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
      design_presets: this.db.listDesignPresets(domain),
      slot_counts: this.db.countSlots(domain),
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
    if (Array.isArray(fields.academy_type_filter)) fields.academy_type_filter = JSON.stringify(fields.academy_type_filter.map((v: any) => String(v || "").trim()).filter(Boolean));
    this.db.updateDomain(domain, fields);
    return { ok: true, domain: domainOut(this.requireDomain(domain)) };
  }

  @Post("domains/:domain/design-presets")
  createDesignPreset(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Body() body: Row) {
    checkAuth(req, headers); this.requireDomain(domain);
    const html = String(body.html || body.source_html || "").trim();
    const name = String(body.name || "").trim();
    if (!html) throw new HttpException("html required", 400);
    if (html.length > 500_000) throw new HttpException("html too large", 400);
    const extracted = extractDesignPresetFromHtml(html, name);
    return { ok: true, preset: this.db.createDesignPreset(domain, extracted) };
  }

  @Delete("domains/:domain/design-presets/:presetId")
  deleteDesignPreset(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Param("presetId") presetId: string) {
    checkAuth(req, headers); this.requireDomain(domain);
    return { ok: true, deleted: this.db.deleteDesignPreset(domain, presetId) };
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
    this.slots.applyPreset(domain, preset_key);
    return { ok: true, preset_key, axes: this.db.listAxes(domain) };
  }

  @Post("domains/:domain/axes/ai-fill")
  aiFill(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string) {
    checkAuth(req, headers); const domainConfig = this.requireDomain(domain);
    // Nest runtime no longer shells through Python ai_axes; keep endpoint explicit and safe.
    const summary = this.slots.applyPreset(domain, domainConfig.vertical || DEFAULT_DRIVING_VERTICAL);
    return { ok: true, summary: { applied_preset: domainConfig.vertical, ...summary }, axes: this.db.listAxes(domain) };
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
    const summary = this.slots.generateSlotsForDomain(domain, { maxPerTemplate: Math.max(1, Number(body.max_per_template || 200)) });
    return { ok: true, summary, slot_counts: this.db.countSlots(domain) };
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
      design_preset: getUploadedDesignPresetForPost(this.db, domain, post),
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
    .filter((entry) => templates.has(entry[0] ?? "") && (designs.has(entry[1] ?? "") || String(entry[1] || "").startsWith("uploaded:"))));
}

function extractDesignPresetFromHtml(html: string, fallbackName: string): Row {
  const safeHtml = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<iframe[\s\S]*?<\/iframe>/gi, "");
  const title = firstMatch(safeHtml, /<title[^>]*>([\s\S]*?)<\/title>/i) || firstMatch(safeHtml, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const headings = Array.from(safeHtml.matchAll(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi))
    .map((m) => cleanText(m[2] || ""))
    .filter(Boolean)
    .slice(0, 8);
  const cssText = Array.from(safeHtml.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)).map((m) => String(m[1] || "").trim()).filter(Boolean).join("\n\n").slice(0, 12000);
  const plain = sanitizeHtmlExampleContent(cleanText(safeHtml)).slice(0, 1200);
  const colors = Array.from(new Set((safeHtml.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)/g) || []).slice(0, 12)));
  const radii = Array.from(new Set((cssText.match(/border-radius\s*:\s*[^;]+/gi) || []).map((v) => v.split(":")[1]?.trim()).filter(Boolean))).slice(0, 4);
  const vars = extractCssVars(cssText);
  const structureGuide = headings.length
    ? headings.map((heading, i) => `${i + 1}) ${generalizeHtmlSectionHeading(heading)} 섹션을 구성한다`)
    : [
      "상단에 제목과 핵심 요약을 배치한다",
      "본문은 명확한 섹션 단위로 나눈다",
      "비교표, 리스트, CTA 위치를 예시 HTML의 리듬에 맞춘다",
    ];
  return {
    name: sanitizeHtmlExampleContent(fallbackName || title || `HTML 디자인 ${randomUUID().slice(0, 4)}`),
    source_html: safeHtml,
    extracted_summary: summarizeHtmlLayout(headings, plain, safeHtml),
    best_for: inferBestFor(plain, safeHtml),
    tone: inferTone(plain, safeHtml),
    structure_guide: structureGuide,
    css_text: cssText,
    css_tokens: { colors, radii, vars },
  };
}

function firstMatch(text: string, pattern: RegExp): string {
  return cleanText(pattern.exec(text)?.[1] || "");
}

function cleanText(value: string): string {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCssVars(cssText: string): Row {
  return Object.fromEntries(Array.from(cssText.matchAll(/--([a-z0-9_-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/gi))
    .map((match) => [match[1], match[2]]));
}

function sanitizeHtmlExampleContent(value: string): string {
  return String(value || "")
    .replace(/\b\d{2,3}-\d{3,4}-\d{4}\b/g, "[연락처]")
    .replace(/\b010-\d{4}-\d{4}\b/g, "[연락처]")
    .replace(/\b\d{1,3}(?:,\d{3})+\s*원\b/g, "[가격]")
    .replace(/\b\d+\s*만\s*원\b/g, "[가격]")
    .replace(/(?:서울|부산|대구|인천|광주|대전|울산|세종)\s*[가-힣]+구/g, "[지역]")
    .replace(/[가-힣]+(?:특별시|광역시|특별자치시|특별자치도|도)\s+[가-힣]+(?:시|군|구)/g, "[지역]")
    .replace(/(?:[가-힣]+구)(?=(?:엔|에는|은|는|이|가|을|를|에서|으로|로|까지|부터|,|\.|\s|$))/g, "[지역]")
    .replace(/[가-힣]+(?:시|군|구)\s+[가-힣]+(?:읍|면|동|리)/g, "[생활권]")
    .replace(/[가-힣A-Za-z0-9·&()\-\s]{2,40}(?:자동차운전전문학원|운전전문학원|자동차운전학원)/g, "[학원명]")
    .replace(/\s+/g, " ")
    .trim();
}

function generalizeHtmlSectionHeading(heading: string): string {
  const text = sanitizeHtmlExampleContent(heading)
    .replace(/\[지역\]/g, "지역")
    .replace(/\[생활권\]/g, "생활권")
    .replace(/\[학원명\]/g, "후보 학원")
    .replace(/\[가격\]/g, "비용")
    .replace(/\[연락처\]/g, "연락처")
    .replace(/^[0-9]{1,2}[\s.)-]+/, "")
    .trim();
  if (/비교|BEST|순위|추천/.test(text)) return "후보 비교/추천";
  if (/순서|목차/.test(text)) return "목차";
  if (/가격|비용|수강료|할인/.test(text)) return "비용 확인";
  if (/위치|주소|셔틀|거리|가까/.test(text)) return "동선/접근성";
  if (/후기|평점|리뷰/.test(text)) return "후기/판단 근거";
  if (/상담|예약|문의|전화/.test(text)) return "상담/CTA";
  if (/준비|절차|방법|체크/.test(text)) return "절차/체크리스트";
  if (/요약|핵심/.test(text)) return "핵심 요약";
  return text.replace(/\[[^\]]+\]/g, "").trim() || "본문";
}

function summarizeHtmlLayout(headings: string[], plain: string, html = ""): string {
  const sections = headings.map(generalizeHtmlSectionHeading).filter(Boolean).slice(0, 5);
  const sectionText = sections.length ? ` 주요 섹션 흐름: ${Array.from(new Set(sections)).join(" -> ")}.` : "";
  const patterns = [
    isReportGuideHtml(html) ? "리포트/완벽 가이드형" : "",
    /비교|BEST|추천|표/.test(plain) ? "비교/추천형" : "",
    /상담|예약|문의/.test(plain) ? "상담 CTA형" : "",
    /체크|절차|준비/.test(plain) ? "체크리스트형" : "",
  ].filter(Boolean).join(", ");
  return `업로드 HTML에서 구조와 스타일만 추출한 화면 구상입니다.${sectionText}${patterns ? ` 감지된 패턴: ${patterns}.` : ""}`;
}

function inferBestFor(text: string, html = ""): string {
  if (isReportGuideHtml(html)) return "리포트형, 완벽 가이드, 표 비교 글";
  if (/비교|BEST|추천|표/.test(text)) return "비교형, 추천형, BEST 글";
  if (/체크|준비물|절차|시험/.test(text)) return "체크리스트형, 시험 준비 글";
  if (/상담|예약|문의|비용/.test(text)) return "상담 전환형, 비용 문의 글";
  return "브랜드 가이드, 정보성 글";
}

function inferTone(text: string, html = ""): string {
  if (isReportGuideHtml(html)) return "검증 자료 중심의 차분한 리포트 톤";
  if (/상담|예약|문의/.test(text)) return "전환을 유도하는 실무적인 톤";
  if (/체크|절차|준비/.test(text)) return "간결하고 따라가기 쉬운 안내 톤";
  if (/비교|추천|BEST/.test(text)) return "판단이 쉬운 비교 큐레이션 톤";
  return "업로드 예시 기반 브랜드 톤";
}

function isReportGuideHtml(html: string): boolean {
  return /class=["'][^"']*(masthead|dateline|tldr|callout|matrix-wrap|profile|serif)[^"']*["']/.test(html)
    || /완벽\s*가이드|리포트|핵심\s*요약|정확성\s*안내/.test(cleanText(html).slice(0, 2000));
}
function normalizePostForAdminExport(db: DbService, domain: string, post: Row): Row {
  const dbImages = safeJson(post.images, {});
  const images = { ...fallbackImagesForPost(db, domain, post), ...(dbImages && typeof dbImages === "object" ? dbImages : {}) };
  const bodyMarkdown = ensureImageSlotsForRender(stripPseudoSlotsForRender(post.body_markdown || ""), images);
  return { ...post, body_markdown: bodyMarkdown, body_html: renderMarkdown(bodyMarkdown, images), images, design_preset: getUploadedDesignPresetForPost(db, domain, post) };
}

function getUploadedDesignPresetForPost(db: DbService, domain: string, post: Row): Row | undefined {
  const designId = String(post.design_template_id || "");
  return designId.startsWith("uploaded:") ? db.getDesignPreset(domain, designId) : undefined;
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
  const designPreset = post.design_preset;
  const design = designPreset ? uploadedDesignTheme(designPreset, domainConfig.brand_color) : getDesignTheme(designId, domainConfig.brand_color);
  const articleClass = designPreset ? "design-uploaded" : `design-${designId}`;
  const visibleDesignId = designPreset ? rawDesignId : designId;
  const brand = publicBrandName(String(domainConfig.display_name || domain));
  const title = String(post.title || brand);
  const contentHtml = toPreviewBlocks(prepareBodyHtml(String(post.body_html || ""), title));
  const chips = designPreset ? uploadedDesignChips(designPreset) : designChips(designId);
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

function uploadedDesignChips(preset: Row): string[] {
  return [
    String(preset.best_for || "").split(",")[0]?.trim(),
    String(preset.tone || "").replace(/\s*톤\s*$/u, "").trim(),
    "업로드 프리셋",
  ].filter((value): value is string => Boolean(value)).slice(0, 3);
}

function uploadedDesignTheme(preset: Row, brandColor?: string | null): ReturnType<typeof getDesignTheme> {
  const base = getDesignTheme("custom", brandColor);
  const tokens = safeJson(preset.css_tokens, {});
  const vars = tokens && typeof tokens === "object" && !Array.isArray(tokens) && tokens.vars && typeof tokens.vars === "object" ? tokens.vars as Row : {};
  const colors = Array.isArray(tokens?.colors) ? tokens.colors.map((value: unknown) => String(value)).filter(isCssColorToken) : [];
  const accent = pickCssVar(vars, ["brand", "teal", "primary", "accent"], colors, base.accent);
  const soft = pickCssVar(vars, ["brand-soft", "teal-soft", "surface", "sand"], colors.filter((color: string) => color !== accent), `color-mix(in srgb, ${accent} 12%, white)`);
  const pageBg = pickCssVar(vars, ["paper", "bg", "background", "card"], colors, base.pageBg);
  return { ...base, accent, soft, pageBg, label: sanitizeHtmlExampleContent(String(preset.name || "업로드 프리셋")).slice(0, 28) || "업로드 프리셋" };
}

function pickCssVar(vars: Row, names: string[], fallbackColors: string[], fallback: string): string {
  for (const name of names) {
    const value = vars[name];
    if (typeof value === "string" && isCssColorToken(value)) return value;
  }
  if (names.some((name) => /soft|surface|sand|paper|bg|card/.test(name))) return fallbackColors.find(isSoftColor) || fallbackColors[0] || fallback;
  return fallbackColors.find(isSaturatedHex) || fallbackColors.find((color) => !isSoftColor(color)) || fallback;
}

function isCssColorToken(value: string): boolean {
  return /^#[0-9a-fA-F]{3,8}$/.test(value) || /^rgba?\([^)]+\)$/.test(value);
}

function isSoftColor(color: string): boolean {
  if (!color.startsWith("#")) return false;
  const rgb = hexToRgb(color);
  return Boolean(rgb && rgb.r > 225 && rgb.g > 225 && rgb.b > 225);
}

function isSaturatedHex(color: string): boolean {
  const rgb = hexToRgb(color);
  if (!rgb) return false;
  const max = Math.max(rgb.r, rgb.g, rgb.b);
  const min = Math.min(rgb.r, rgb.g, rgb.b);
  return max - min > 55 && max > 120 && min < 230;
}

function hexToRgb(color: string): { r: number; g: number; b: number } | null {
  const hex = color.replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((v) => v + v).join("") : hex.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16) };
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
