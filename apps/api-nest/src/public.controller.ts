import { Body, Controller, Get, Header, HttpException, Inject, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { createReadStream, existsSync } from "node:fs";
import { DbService } from "./db.service.js";
import { generatedImageFilePath, safeImageFilename } from "./image-generation.service.js";
import { ensureImageSlotsForRender, fallbackImagesForPost, renderMarkdown, stripPseudoSlotsForRender } from "./post-rendering.js";

type Row = Record<string, any>;

@Controller("api/v1/:domain")
export class PublicController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  @Get("site")
  site(@Param("domain") domain: string) {
    return { site: publicSiteSummary(this.requireDomain(domain)) };
  }

  @Get("posts")
  posts(@Param("domain") domain: string, @Query() query: Row) {
    this.requireDomain(domain);
    const limit = clampInt(query.limit, 50, 1, 100);
    const offset = Math.max(0, Number(query.offset || 0));
    const rows = this.db.all(`SELECT id, domain, slot_id, slug, title, meta_description, images, design_template_id, generated_at, length(body_markdown) AS body_chars FROM posts WHERE domain=? AND status='published' ORDER BY generated_at DESC LIMIT ? OFFSET ?`, [domain, limit, offset]);
    return { count: rows.length, items: rows.map(publicPostSummary) };
  }

  @Get("posts/:slug")
  post(@Param("domain") domain: string, @Param("slug") slug: string, @Query("include_rendered") rendered = "") {
    const domainConfig = this.requireDomain(domain);
    const post = this.db.getPostBySlug(domain, slug, "published");
    if (!post) throw new HttpException("post not found", 404);
    const normalized = normalizePostForPublicRender(this.db, domain, post);
    const payload: Row = { post: publicPostDetail(normalized.post), site: publicSiteSummary(domainConfig) };
    if (rendered === "true" || rendered === "1") payload.body_html = renderMarkdown(normalized.bodyMarkdown, normalized.images);
    return payload;
  }

  @Get("generated-images/:file")
  generatedImage(@Param("domain") domain: string, @Param("file") file: string, @Res() res: Response) {
    this.requireDomain(domain);
    if (safeImageFilename(file) !== file) throw new HttpException("image not found", 404);
    const path = generatedImageFilePath(domain, file);
    if (!existsSync(path)) throw new HttpException("image not found", 404);
    res.setHeader("content-type", "image/png");
    res.setHeader("cache-control", "public, max-age=31536000, immutable");
    createReadStream(path).pipe(res);
  }

  @Get("sitemap.xml")
  @Header("content-type", "application/xml; charset=utf-8")
  sitemap(@Param("domain") domain: string, @Query("base_url") baseUrl = "") {
    this.requireDomain(domain);
    const base = (baseUrl || `https://${domain}`).replace(/\/$/, "");
    const posts = this.db.listPosts(domain, { status: "published", limit: 5000 });
    const urls = posts.map((p) => `  <url><loc>${escapeXml(`${base}/community/${p.slug}`)}</loc><lastmod>${String(p.generated_at || "").slice(0, 10)}</lastmod></url>`).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
  }

  @Get("academies")
  academies(@Param("domain") domain: string, @Query() query: Row) {
    this.requireDomain(domain);
    const items = this.db.listAcademies(domain, { region: query.region || undefined, limit: clampInt(query.limit, 50, 1, 1000) });
    return { count: items.length, items: items.map(publicAcademy) };
  }

  @Post("academies")
  upsertAcademies(@Param("domain") domain: string, @Req() req: Request, @Query("token") token = "", @Body() body: any) {
    this.requireDomain(domain);
    const expected = process.env.PUBLIC_WRITE_TOKEN || "";
    const headerToken = req.headers["x-public-write-token"] || "";
    if (expected && token !== expected && headerToken !== expected) throw new HttpException("Unauthorized", 401);
    let rows = body?.items !== undefined ? body.items : body;
    if (rows && !Array.isArray(rows)) rows = [rows];
    if (!Array.isArray(rows)) throw new HttpException("expected a JSON academy object, array, or {items:[...]}", 400);
    return { ok: true, upserted: this.db.upsertAcademies(domain, rows) };
  }

  private requireDomain(domain: string) { const d = this.db.getDomain(domain); if (!d) throw new HttpException("domain not found", 404); return d; }
}

function publicSiteSummary(row: Row): Row {
  return {
    domain: row.domain,
    display_name: row.display_name,
    brand_color: row.brand_color,
    design_template_id: row.design_template_id,
    logo_url: row.logo_url ?? null,
  };
}

function publicPostSummary(row: Row): Row {
  return { ...row, images: safeJson(row.images, {}) };
}
// 공개 상세 응답은 명시 화이트리스트만 내보낸다(목록 SELECT와 동일 원칙).
// provider/model/cost_usd/session_id/job_id/토큰/duration 등 내부·비용 필드는 절대 노출하지 않는다.
// region/academy_names 는 소비 사이트의 JSON-LD 등 SEO 파생용으로만 유지한다.
function publicPostDetail(row: Row): Row {
  return {
    id: row.id,
    domain: row.domain,
    slug: row.slug,
    title: row.title,
    meta_description: row.meta_description,
    body_markdown: row.body_markdown,
    images: safeJson(row.images, {}),
    design_template_id: row.design_template_id,
    generated_at: row.generated_at,
    region: row.region ?? null,
    academy_names: safeJson(row.academy_names, []),
  };
}

/**
 * 공개 학원 응답도 명시 화이트리스트만 내보낸다(글 상세와 동일 원칙).
 *
 * 이전에는 academies 행을 통째로 반환해서 원천 흔적이 그대로 나갔다. 제외 대상은 세 갈래다.
 * 1) 원천 시스템 흔적: source_name/source_url(내부 동기화 endpoint), external_id, extra(원천 구조체·
 *    가격 수집 출처 URL). 공개물에 내부 API/원천 시스템을 남기지 않는다는 원칙에 직결된다.
 * 2) 리뷰 원문 페이로드: review_json/blog_reviews 는 작성자·작성일·평점·외부 링크·내부 ID를 담는다.
 * 3) 원천 마케팅 문구: seo_content 는 검수되지 않은 홍보 서술이라 공개 소비면에 그대로 흘리지 않는다.
 * 운영 데이터인 domain/created_at 도 라우트에 이미 있거나 소비처에 쓸모가 없어 뺀다.
 */
function publicAcademy(row: Row): Row {
  return {
    id: row.id,
    region: row.region ?? null,
    name: row.name,
    address: row.address ?? null,
    price: row.price ?? null,
    shuttle: row.shuttle ?? null,
    hours: row.hours ?? null,
    pass_rate: row.pass_rate ?? null,
    phone: row.phone ?? null,
    vphone: row.vphone ?? null,
    review: row.review ?? null,
    seo_title: row.seo_title ?? null,
    seo_keywords: row.seo_keywords ?? null,
    seo_description: row.seo_description ?? null,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    thumb_url: row.thumb_url ?? null,
    photos: safeJson(row.photos, []),
    academy_type: row.academy_type ?? null,
    synced_at: row.synced_at ?? null,
  };
}
function normalizePostForPublicRender(db: DbService, domain: string, post: Row): { post: Row; bodyMarkdown: string; images: Record<string, string> } {
  const dbImages = safeJson(post.images, {});
  const images = { ...fallbackImagesForPost(db, domain, post), ...(dbImages && typeof dbImages === "object" ? dbImages : {}) };
  const bodyMarkdown = ensureImageSlotsForRender(stripPseudoSlotsForRender(post.body_markdown || ""), images);
  return { post: { ...post, body_markdown: bodyMarkdown, images: Object.keys(images).length ? JSON.stringify(images) : post.images }, bodyMarkdown, images };
}
function safeJson(value: any, fallback: any) { if (!value || typeof value !== "string") return value || fallback; try { return JSON.parse(value); } catch { return fallback; } }
function clampInt(value: any, fallback: number, min: number, max: number) { const n = Number(value); return Math.max(min, Math.min(max, Number.isFinite(n) ? Math.trunc(n) : fallback)); }
function escapeXml(s: string) { return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c] || c)); }
