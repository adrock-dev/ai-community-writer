import { Body, Controller, Delete, Get, Headers, HttpException, HttpStatus, Inject, Param, Patch, Post, Put, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { DbService, domainOut, jobOut, safeJson } from "./db.service.js";
import { DrivingplusApiService, type SeoRegionLevel } from "./drivingplus-api.service.js";
import { DEFAULT_DRIVING_BRAND_COLOR, DEFAULT_DRIVING_CONTENT_BRIEF, DEFAULT_DRIVING_DESIGN_TEMPLATE, DEFAULT_DRIVING_VERTICAL, DESIGN_TEMPLATES, DRIVING_VERTICALS, TEMPLATE_SPECS, type AxisName } from "./constants.js";
import { SlotService } from "./slot.service.js";
import { ensureImageSlotsForRender, fallbackImagesForPost, renderMarkdown, stripPseudoSlotsForRender } from "./post-rendering.js";
import { findSlotExclusionTerms, parseExclusionTerms } from "./exclusions.js";

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
      design_templates: DESIGN_TEMPLATES,
      providers: ["codex", "claude"],
      preset_options: [DEFAULT_DRIVING_VERTICAL],
      indexing: { has_key: Boolean(this.db.getSetting("google_sa_json")), url_template: this.indexingUrlTemplate() }
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
    this.db.createDomain({ domain, display_name, vertical, theme: body.theme, brand_color: body.brand_color || DEFAULT_DRIVING_BRAND_COLOR, daily_limit: body.daily_limit });
    this.db.updateDomain(domain, { design_template_id: DEFAULT_DRIVING_DESIGN_TEMPLATE, content_brief: body.content_brief || DEFAULT_DRIVING_CONTENT_BRIEF });
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
    if (Array.isArray(fields.academy_type_filter)) fields.academy_type_filter = JSON.stringify(fields.academy_type_filter.map((v: any) => String(v || "").trim()).filter(Boolean));
    this.db.updateDomain(domain, fields);
    return { ok: true, domain: domainOut(this.requireDomain(domain)) };
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
    const items = this.db.listPosts(domain, { status: query.status || undefined, limit: clampInt(query.limit, 100, 1, 500) });
    return { count: items.length, items };
  }

  @Get("domains/:domain/posts/:postId")
  getPost(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Param("postId") postId: string, @Query("include_rendered") rendered = "") {
    checkAuth(req, headers); this.requireDomain(domain);
    const post = this.db.getPost(postId); if (!post || post.domain !== domain) throw new HttpException("post not found", 404);
    const dbImages = safeJson(post.images, {});
    const mergedImages = { ...fallbackImagesForPost(this.db, domain, post), ...(dbImages && typeof dbImages === "object" ? dbImages : {}) };
    const bodyMarkdown = ensureImageSlotsForRender(stripPseudoSlotsForRender(post.body_markdown || ""), mergedImages);
    const responsePost = { ...post, body_markdown: bodyMarkdown, images: Object.keys(mergedImages).length ? JSON.stringify(mergedImages) : post.images };
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
    const rows = await this.drivingplus.fetchAcademies({ includeBlogReviews: body.include_blog_reviews !== false, blogReviewLimit: clampInt(body.blog_review_limit, 3, 1, 10) });
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
    const academies = await this.drivingplus.fetchAcademies({ includeBlogReviews: body.include_blog_reviews !== false, blogReviewLimit: clampInt(body.blog_review_limit, 3, 1, 10) });
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
    if (!slotIds.length) {
      const picked = this.db.selectSlotsForBatch(domain, { q: body.q || undefined, template: body.template || undefined, limit: clampInt(body.max, 10, 1, 500), balanced: Boolean(body.balanced) });
      slotIds = picked.map((s) => s.slot_id);
    } else {
      const exclusionTerms = parseExclusionTerms(domainMeta.excluded_keywords);
      if (exclusionTerms.length) {
        slotIds = slotIds.filter((slotId) => {
          const slot = this.db.getSlot(slotId);
          return slot && slot.domain === domain && !findSlotExclusionTerms(slot, exclusionTerms).length;
        });
      }
    }
    if (!slotIds.length) throw new HttpException("작성할 planned 슬롯이 없습니다. 검색어나 제외 목록을 확인하세요.", 400);
    const job_id = this.db.enqueueJob(domain, "generate", {
      slot_ids: slotIds,
      provider: body.provider || "codex",
      model: String(body.model || "").trim(),
      design_template_id: body.design_template_id,
      use_web_research: body.use_web_research ?? true,
      cooldown_sec: body.cooldown_sec ?? 60,
      timeout_sec: body.timeout_sec ?? 600,
      enable_image_generation: Boolean(body.enable_image_generation),
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
  const designId = resolveDesignId(post.design_template_id || domainConfig.design_template_id);
  const design = DESIGN_EXPORT_SPECS[designId] || DESIGN_EXPORT_SPECS["local-guide"]!;
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
    <article class="preview-phone preview-phone-fluid design-${designId}" style="--accent:${design.accent};--accent-soft:${design.soft};--primary:${design.accent};background:${design.pageBg}">
      <div class="preview-top"><div><b>${escapeHtml(brand)}</b><p>${escapeHtml(design.label)}</p></div><span class="preview-cta">${escapeHtml(design.topCta)}</span></div>
      <div class="preview-hero post-hero title-hero">
        <div>
          <span>${escapeHtml(design.label)}</span>
          <h3>${escapeHtml(title)}</h3>
        </div>
      </div>
      <div class="preview-body">
        <div class="preview-meta"><span>${escapeHtml(formatShortDate(String(post.generated_at || "")))}</span><span>${escapeHtml(designId)}</span></div>
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

const DESIGN_EXPORT_SPECS: Record<string, { accent: string; soft: string; pageBg: string; topCta: string; bottomCta: string; label: string }> = {
  editorial: { accent: "#5132d7", soft: "#f2efff", pageBg: "#ffffff", topCta: "지금 바로 비교·예약", bottomCta: "상담/예약하러 가기", label: "브랜드 매거진" },
  comparison: { accent: "#2563eb", soft: "#dbeafe", pageBg: "#ffffff", topCta: "BEST 한눈에 비교", bottomCta: "내게 맞는 곳 찾기", label: "BEST 비교 블로그" },
  "local-guide": { accent: "#059669", soft: "#dcfce7", pageBg: "#ffffff", topCta: "내 주변에서 찾기", bottomCta: "가까운 곳 예약하기", label: "지역 추천 블로그" },
  checklist: { accent: "#ca8a04", soft: "#fef3c7", pageBg: "#ffffff", topCta: "체크리스트 저장", bottomCta: "준비 시작하기", label: "체크리스트 블로그" },
  conversion: { accent: "#111827", soft: "#ede9fe", pageBg: "#ffffff", topCta: "비용 상담 신청", bottomCta: "지금 예약하기", label: "예약 전환 블로그" },
  custom: { accent: "#5132d7", soft: "#f2efff", pageBg: "#ffffff", topCta: "자세히 보기", bottomCta: "문의하기", label: "커스텀" },
};

function resolveDesignId(value: unknown): string {
  const id = String(value || "local-guide");
  return DESIGN_EXPORT_SPECS[id] ? id : "local-guide";
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
