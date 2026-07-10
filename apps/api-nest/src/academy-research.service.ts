import { Inject, Injectable, Logger } from "@nestjs/common";
import { AcademyResearchDbService } from "./academy-research-db.service.js";
import { DrivingplusApiService, type DrivingplusAcademy } from "./drivingplus-api.service.js";
import {
  detectResearchProviders, parseResearchJson, runResearchCli,
  type ResearchProvider, type ResearchProviderPreference, type ResearchResult,
} from "./academy-research-llm.js";
import { buildExtractionPrompt, gatherSources } from "./academy-research-web.js";

// academy_research 스칼라 필드(courses/shuttle_routes/sources 제외)
const SCALAR_KEYS: Array<keyof ResearchResult> = [
  "name_researched", "address_researched", "phone_researched", "gu", "dong", "jibun_address",
  "hours", "night_class", "weekend", "closed_days", "shuttle_available", "shuttle_summary",
  "licenses", "self_test", "facilities", "fee_summary", "price_disclosed", "pass_rate",
  "pass_rate_scope", "established_year", "scale", "homepage_url", "naver_place_url", "kakao_url",
];

// DrivingPlus 동기화 + AI 심층조사 오케스트레이터.
// 동기화: 원본을 academy_base/academy_reviews 에 미러링(덮어쓰기 아님, 조사값과 병존).
@Injectable()
export class AcademyResearchService {
  private readonly logger = new Logger(AcademyResearchService.name);
  private activeRegionRun = false;

  constructor(
    @Inject(AcademyResearchDbService) private readonly db: AcademyResearchDbService,
    @Inject(DrivingplusApiService) private readonly drivingplus: DrivingplusApiService,
  ) {}

  // DrivingPlus 전체 학원을 동기화. 리뷰/블로그리뷰 원문 포함(A안).
  async syncAll(opts: { reviewLimit?: number; blogReviewLimit?: number } = {}): Promise<{ matched: number; total: number; reviews: number }> {
    const all = await this.drivingplus.fetchAcademies();
    let reviewCount = 0;
    for (const academy of all) {
      reviewCount += await this.upsertWithReviews(academy, opts);
    }
    return { matched: all.length, total: all.length, reviews: reviewCount };
  }

  // 단건(외부 id) 동기화 — 기본정보/리뷰 새로고침.
  async syncOne(externalId: string, opts: { reviewLimit?: number; blogReviewLimit?: number } = {}): Promise<{ external_id: string; found: boolean; reviews: number }> {
    const all = await this.drivingplus.fetchAcademies();
    const academy = all.find((a) => String(a.id) === String(externalId));
    if (!academy) return { external_id: externalId, found: false, reviews: 0 };
    const reviews = await this.upsertWithReviews(academy, opts);
    return { external_id: externalId, found: true, reviews };
  }

  // base upsert + 해당 학원의 리뷰/블로그리뷰만 개별 호출해 저장.
  private async upsertWithReviews(academy: DrivingplusAcademy, opts: { reviewLimit?: number; blogReviewLimit?: number }): Promise<number> {
    const externalId = String(academy.id);
    this.db.upsertBase({
      external_id: externalId,
      name: academy.title,
      address: academy.roadAddress ?? null,
      phone: academy.phone ?? null,
      vphone: academy.vphone ?? null,
      academy_type: academy.type ?? null,
      latitude: academy.roadLatitude ?? null,
      longitude: academy.roadLongitude ?? null,
      thumb_url: academy.thumbSavePath ?? null,
      photos: academy.photos ?? null,
      seo_title: academy.seoTitle ?? null,
      seo_keywords: academy.seoKeywords ?? null,
      seo_description: academy.seoDescription ?? null,
      raw_json: academy,
    });
    const [reviews, blogReviews] = await Promise.all([
      this.drivingplus.fetchReviews(academy.id, opts.reviewLimit ?? 5).catch(() => academy.reviews ?? []),
      this.drivingplus.fetchBlogReviews(academy.id, opts.blogReviewLimit ?? 5).catch(() => academy.blogReviews ?? []),
    ]);
    return this.storeReviews(externalId, { ...academy, reviews, blogReviews });
  }

  // ---- AI 심층조사 ----

  // b: 단건 조사(B안 = 자체 fetch). Node가 직접 공개 페이지를 수집 → LLM이 소스 본문에서만 추출.
  async researchOne(externalId: string, opts: { method?: string; provider?: ResearchProviderPreference; runId?: string } = {}): Promise<{ ok: boolean; external_id: string; provider?: ResearchProvider; error?: string; no_sources?: boolean; sources?: number }> {
    const base = this.db.getBase(externalId);
    if (!base) return { ok: false, external_id: externalId, error: "학원(base)이 없습니다. 먼저 동기화하세요." };
    const providers = await this.resolveProviders(opts.provider);
    if (!providers.length) return { ok: false, external_id: externalId, error: "claude/codex CLI를 찾을 수 없습니다." };
    const method = opts.method ?? "b_single";
    const ref = { external_id: externalId, name: base.name, address: base.address, phone: base.phone, vphone: base.vphone, region: base.region };

    // 1) 공개 소스 수집(검색 → 페이지 fetch)
    const sources = await gatherSources(ref);
    if (sources.length === 0) {
      this.bumpRun(opts.runId);
      return { ok: false, external_id: externalId, provider: providers[0], no_sources: true, error: "공개 소스를 찾지 못했습니다(검색/페치 실패). 값은 저장하지 않았습니다." };
    }

    // 2) 소스 본문에서만 추출(웹툴 불필요 → Opus 지정)
    const prompt = buildExtractionPrompt(ref, sources);
    let lastError = "";
    for (const provider of providers) {
      const out = await runResearchCli(prompt, { provider, model: provider === "claude" ? "opus" : undefined });
      if (!out.ok) { lastError = `${provider}: ${out.error || "CLI 실행 실패"}`; continue; }
      const parsed = parseResearchJson(out.text);
      if (!parsed) { lastError = `${provider}: JSON 파싱 실패(응답이 스키마와 다름)`; continue; }

      // 근거 URL이 비어있는 필드는 수집 소스 첫 URL로 보완(추적성 확보)
      this.persistResearch(externalId, parsed, { engine: provider, method }, sources.map((s) => s.url));
      this.bumpRun(opts.runId);
      return { ok: true, external_id: externalId, provider, sources: sources.length };
    }

    return { ok: false, external_id: externalId, provider: providers[providers.length - 1], error: lastError || "CLI 실행 실패" };
  }

  private bumpRun(runId?: string): void {
    if (!runId) return;
    const run = this.db.getRun(runId);
    this.db.updateRun(runId, { count_done: Number(run?.count_done ?? 0) + 1 });
  }

  // a: 전체 배치 조사. 백그라운드로 실행하고 runId 를 즉시 반환.
  async startRegionResearch(region?: string, opts: { provider?: ResearchProviderPreference } = {}): Promise<{ ok: boolean; run_id?: string; error?: string; count?: number }> {
    if (this.activeRegionRun) return { ok: false, error: "이미 진행 중인 전체 조사가 있습니다." };
    const providers = await this.resolveProviders(opts.provider);
    if (!providers.length) return { ok: false, error: "claude/codex CLI를 찾을 수 없습니다." };
    const targets = this.db.listBase({ region, limit: 5000 });
    if (!targets.length) return { ok: false, error: "동기화된 학원이 없습니다. 먼저 동기화하세요." };

    const runId = this.db.createRun({ scope: "all", region, engine: opts.provider && opts.provider !== "auto" ? opts.provider : "auto", method: "a_batch", count_total: targets.length });
    this.activeRegionRun = true;
    // 백그라운드 실행(HTTP 응답을 막지 않음). 진행 상황은 research_runs 로 추적.
    void this.runRegionBatch(runId, targets.map((t) => String(t.external_id)), opts.provider ?? "auto")
      .catch((error) => { this.logger.error(`batch research failed: ${error?.message || error}`); this.db.updateRun(runId, { status: "error", error: String(error?.message || error), finished: true }); })
      .finally(() => { this.activeRegionRun = false; });
    return { ok: true, run_id: runId, count: targets.length };
  }

  private async runRegionBatch(runId: string, externalIds: string[], provider: ResearchProviderPreference): Promise<void> {
    let done = 0;
    for (const externalId of externalIds) {
      try {
        await this.researchOne(externalId, { method: "a_batch", provider });
      } catch (error: any) {
        this.logger.warn(`researchOne(${externalId}) 실패: ${error?.message || error}`);
      }
      done += 1;
      this.db.updateRun(runId, { count_done: done });
    }
    this.db.updateRun(runId, { status: "done", finished: true });
  }

  private persistResearch(externalId: string, parsed: ResearchResult, meta: { engine: ResearchProvider; method: string }, fallbackSourceUrls: string[] = []): void {
    const scalar: Record<string, unknown> = {};
    for (const key of SCALAR_KEYS) {
      const value = parsed[key];
      if (value !== undefined) scalar[key as string] = value ?? null;
    }
    this.db.upsertResearch(externalId, scalar, { engine: meta.engine, method: meta.method });
    this.db.clearWebBlocked(externalId); // 이전 CLI-웹 조사의 web_blocked 흔적 정리

    if (Array.isArray(parsed.courses)) this.db.replaceCourses(externalId, parsed.courses as Array<Record<string, unknown>>);
    if (Array.isArray(parsed.shuttle_routes)) this.db.replaceShuttleRoutes(externalId, parsed.shuttle_routes as Array<Record<string, unknown>>);

    // 값이 채워진 스칼라 필드는 검증상태 ai_draft + 출처 URL 기록(모델 sources → 없으면 수집소스 첫 URL).
    const sources = parsed.sources && typeof parsed.sources === "object" ? parsed.sources : {};
    const fallbackUrl = fallbackSourceUrls[0];
    for (const key of SCALAR_KEYS) {
      const value = parsed[key];
      if (value == null || value === "") continue;
      const sourceUrl = sources[key as string] ?? fallbackUrl;
      this.db.setFieldMeta(externalId, key as string, {
        status: "ai_draft",
        source_url: sourceUrl,
        source_name: sourceUrl ? undefined : `${meta.engine} 조사`,
      });
    }
  }

  private async resolveProviders(preference: ResearchProviderPreference | undefined): Promise<ResearchProvider[]> {
    if (preference && preference !== "auto") return [preference];
    return detectResearchProviders();
  }

  private storeReviews(externalId: string, academy: DrivingplusAcademy): number {
    let count = 0;
    for (const [i, review] of (academy.reviews ?? []).entries()) {
      const content = String(review.content ?? "").trim();
      if (!content) continue;
      this.db.upsertReview({
        external_id: externalId,
        platform: "drivingplus_review",
        source_key: review.id != null ? String(review.id) : `r${i}`,
        rating: review.point ?? null,
        quote_text: content,
        author_masked: maskAuthor(review.author),
        posted_at: review.date ?? null,
        collect_method: "drivingplus_api",
      });
      count++;
    }
    for (const [i, blog] of (academy.blogReviews ?? []).entries()) {
      const content = String(blog.content ?? blog.title ?? "").trim();
      if (!content) continue;
      this.db.upsertReview({
        external_id: externalId,
        platform: "drivingplus_blog",
        source_key: blog.link ? blog.link : `b${i}`,
        title: blog.title ?? null,
        quote_text: content,
        source_url: blog.link ?? null,
        posted_at: blog.postdate ?? null,
        images: blog.images ?? null,
        collect_method: "drivingplus_api",
      });
      count++;
    }
    return count;
  }
}

// 작성자 식별정보 최소화: 첫 글자만 남기고 마스킹.
function maskAuthor(author: string | null | undefined): string | null {
  const name = String(author ?? "").trim();
  if (!name) return null;
  const first = [...name][0] ?? "";
  return `${first}${"*".repeat(Math.max(1, [...name].length - 1))}`;
}
