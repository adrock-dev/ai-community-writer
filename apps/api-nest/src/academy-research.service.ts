import { Inject, Injectable, Logger } from "@nestjs/common";
import { AcademyResearchDbService } from "./academy-research-db.service.js";
import { DrivingplusApiService, type DrivingplusAcademy } from "./drivingplus-api.service.js";
import {
  detectResearchProviders, parseResearchJson, runResearchCli,
  type ResearchProvider, type ResearchProviderPreference, type ResearchResult,
} from "./academy-research-llm.js";
import { buildExtractionPrompt, gatherSources, structuredFactsFromSources, type WebSource } from "./academy-research-web.js";
import { baseKnownFacts, knownFactsFromSource, type KnownFacts } from "./academy-research-known-facts.js";
import { findingNote, hasFinding, inspectResearchValue, sourceHaystack } from "./academy-research-grounding.js";
import { blogReviewSyncEnabled } from "./runtime-config.js";

// academy_research 스칼라 필드(courses/shuttle_routes/sources 제외)
const SCALAR_KEYS: Array<keyof ResearchResult> = [
  "name_researched", "address_researched", "phone_researched", "gu", "dong", "jibun_address",
  "hours", "night_class", "weekend", "closed_days", "shuttle_available", "shuttle_summary",
  "licenses", "self_test", "facilities", "fee_summary", "price_disclosed", "pass_rate",
  "pass_rate_scope", "established_year", "scale", "homepage_url", "naver_place_url", "kakao_url",
  "enrollment_prep", "booking_channel",
];
const SCALAR_KEY_SET = new Set<string>(SCALAR_KEYS as string[]);

// 학원 1곳의 처리 결과. 수집 저조의 원인을 화면에서 구분하려면 이 세 갈래가 필요하다.
// "빈 응답"(200 OK + 0건)과 "조회 실패"(예외)는 대응이 완전히 다르다 —
// 전자는 교체 정책상 기존 후기를 지우고, 후자는 손대지 않고 보존한다.
export type SyncOutcome = "data" | "empty" | "failed";
export interface SyncTally { done: number; reviews: number; with_data: number; empty: number; failed: number }
export interface SyncResult extends SyncTally { matched: number; total: number; cancelled: boolean }

export interface SyncOptions {
  reviewLimit?: number;
  blogReviewLimit?: number;
  /** 학원 간 동시 처리 수. 학원 1곳당 원천 왕복이 있어 순차로 돌면 곳수에 비례해 느려진다. */
  concurrency?: number;
  /** 전체 학원 수를 알게 된 시점(목록 조회 직후) 1회 호출. */
  onTotal?: (total: number) => void;
  /** 학원 1곳 처리마다 호출. */
  onProgress?: (tally: SyncTally) => void;
  /** 매 학원 직전에 확인. true 면 남은 학원을 처리하지 않고 멈춘다. */
  shouldCancel?: () => boolean;
}

// 원천 서버를 몰아치지 않으면서 순차 대기를 없애는 선. 환경변수로 조절 가능.
// 자체 후기(/v1/review/list) 기준이다 — 2026-07-27 운영 실측으로 동시 8에 80건 1.0초, 실패 0.
const DEFAULT_SYNC_CONCURRENCY = 8;
function syncConcurrency(requested?: number): number {
  const raw = requested ?? Number(process.env.ACADEMY_SYNC_CONCURRENCY ?? DEFAULT_SYNC_CONCURRENCY);
  return Math.max(1, Math.min(16, Number.isFinite(raw) ? Math.trunc(raw) : DEFAULT_SYNC_CONCURRENCY));
}

/**
 * 블로그리뷰는 같은 서버인데도 감당 능력이 전혀 다르다(2026-07-27 운영 실측).
 * 동시 1이면 60건 전건 성공(건당 2.6초), 동시 2에서 절반, 동시 4에서 5/24 만 성공.
 * 초과분은 예외가 아니라 10초 뒤 code:200 + 빈 배열로 오고, 후기는 전량교체라 그대로 삭제가 된다.
 * 그래서 자체 후기와 기본값을 분리한다. 380곳 기준 동시 1은 약 12분(백그라운드 run 이라 문제없다).
 */
const DEFAULT_BLOG_SYNC_CONCURRENCY = 1;
function blogSyncConcurrency(): number {
  const raw = Number(process.env.ACADEMY_BLOG_SYNC_CONCURRENCY ?? DEFAULT_BLOG_SYNC_CONCURRENCY);
  return Math.max(1, Math.min(16, Number.isFinite(raw) ? Math.trunc(raw) : DEFAULT_BLOG_SYNC_CONCURRENCY));
}

// 고정 개수의 작업자가 목록을 나눠 가져가는 단순 풀. 순서는 보장하지 않는다(동기화에 순서는 의미가 없다).
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      const item = items[index];
      if (item === undefined) return;
      await worker(item);
    }
  });
  await Promise.all(workers);
}

// DrivingPlus 동기화 + AI 심층조사 오케스트레이터.
// 동기화: 원본을 academy_base/academy_reviews 에 미러링(덮어쓰기 아님, 조사값과 병존).
@Injectable()
export class AcademyResearchService {
  private readonly logger = new Logger(AcademyResearchService.name);

  constructor(
    @Inject(AcademyResearchDbService) private readonly db: AcademyResearchDbService,
    @Inject(DrivingplusApiService) private readonly drivingplus: DrivingplusApiService,
  ) {}

  // 학원 기본정보 + 자체 후기. 블로그리뷰는 뺐다 — 원천의 블로그리뷰 조회가 학원당 10초라
  // (자체 후기는 0.06초) 같이 돌리면 급한 기본정보 갱신까지 그 속도에 묶인다. syncBlogReviews 로 분리.
  async syncAll(opts: SyncOptions = {}): Promise<SyncResult> {
    const all = await this.drivingplus.fetchAcademies();
    // 이번 목록이 곧 최신 기준이다. 여기서 빠진 학원은 비활성으로 내려 목록·후속 동기화·조사 대상에서 뺀다.
    // 취소로 중간에 끊겨도 어긋나지 않도록 학원별 처리 전에 한 번에 반영한다.
    const activity = this.db.setActiveByExternalIds(all.map((academy) => String(academy.id)));
    if (activity.inactive) this.logger.log(`원천 목록에 없는 학원 ${activity.inactive}곳을 비활성 처리했습니다.`);
    opts.onTotal?.(all.length);
    return this.runSyncPool(all, opts, async (academy) => {
      const externalId = this.upsertBaseRow(academy);
      const page = await this.pullReviews(academy.id, opts.reviewLimit ?? 5);
      return this.storeReviewPlatform(externalId, page);
    });
  }

  // 블로그리뷰만. 이미 동기화된 학원을 대상으로 하므로 4MB 짜리 학원 목록을 다시 받지 않는다.
  async syncBlogReviews(opts: SyncOptions = {}): Promise<SyncResult> {
    const targets = this.db.listBase({ limit: 5000 })
      .map((row) => ({ external_id: String(row.external_id), academy_id: Number(row.external_id) }))
      .filter((row) => Number.isFinite(row.academy_id));
    opts.onTotal?.(targets.length);
    // 자체 후기 기본값(8)을 그대로 쓰면 안 된다. 블로그리뷰 엔드포인트는 동시요청에 무너져
    // 대부분이 빈 응답으로 돌아오고, 전량교체 정책과 겹쳐 멀쩡한 후기가 삭제된다(blogSyncConcurrency 주석).
    return this.runSyncPool(targets, { ...opts, concurrency: opts.concurrency ?? blogSyncConcurrency() }, async (target) => {
      const page = await this.pullBlogReviews(target.academy_id, opts.blogReviewLimit ?? 5);
      return this.storeBlogPlatform(target.external_id, page);
    });
  }

  // 동시 처리 + 취소 확인 + 진행률 보고를 한 곳에 모은다(두 동기화가 같은 규칙을 따르도록).
  private async runSyncPool<T>(items: T[], opts: SyncOptions, work: (item: T) => Promise<{ stored: number; outcome: SyncOutcome }>): Promise<SyncResult> {
    const tally: SyncTally = { done: 0, reviews: 0, with_data: 0, empty: 0, failed: 0 };
    let cancelled = false;
    await runPool(items, syncConcurrency(opts.concurrency), async (item) => {
      // 이미 처리 중이던 학원은 끝까지 마친다 — 후기 교체가 트랜잭션 중간에 끊기지 않게.
      if (cancelled) return;
      if (opts.shouldCancel?.()) { cancelled = true; return; }
      // `x += await f()` 는 좌변을 await 전에 읽어 동시 실행 시 증가분이 서로 덮인다.
      // 반드시 await 를 끝낸 뒤 읽고-더하고-쓴다.
      const res = await work(item);
      tally.reviews += res.stored;
      tally.done += 1;
      if (res.outcome === "data") tally.with_data += 1;
      else if (res.outcome === "empty") tally.empty += 1;
      else tally.failed += 1;
      opts.onProgress?.({ ...tally });
    });
    return { ...tally, matched: tally.done, total: items.length, cancelled };
  }

  // 동기화를 백그라운드로 시작하고 run_id 를 즉시 반환한다.
  // 학원 수백 곳을 한 HTTP 응답 안에서 기다리면, 그 사이 API 가 재시작하거나
  // 브라우저를 닫는 순간 요청이 끊겨 "fetch failed" 로만 보인다(작업 자체는 서버에서 계속 돌았다).
  startSync(opts: { reviewLimit?: number; concurrency?: number } = {}): { ok: boolean; run_id?: string; error?: string } {
    return this.startSyncRun("sync", "drivingplus_sync", (runOpts) => this.syncAll({ ...opts, ...runOpts }));
  }

  startBlogSync(opts: { blogReviewLimit?: number; concurrency?: number } = {}): { ok: boolean; run_id?: string; error?: string } {
    // 수집 스위치는 서버가 최종 판단한다. 화면에서 버튼을 감춰도 직접 호출은 막지 못한다.
    if (!blogReviewSyncEnabled()) {
      return { ok: false, error: "블로그리뷰 수집은 현재 꺼져 있습니다. 원천이 학원명을 느슨하게 매칭해 다른 학원 글이 섞이기 때문이며, 글 생성에도 쓰지 않습니다. 블로그 글 검증 방식이 정해지면 다시 켭니다." };
    }
    if (!this.db.countBase()) return { ok: false, error: "동기화된 학원이 없습니다. 학원정보 동기화를 먼저 실행하세요." };
    return this.startSyncRun("sync_blog", "drivingplus_blog_sync", (runOpts) => this.syncBlogReviews({ ...opts, ...runOpts }));
  }

  // 두 동기화는 같은 원천을 두드리므로 동시에 돌리지 않는다.
  private startSyncRun(scope: string, method: string, work: (runOpts: SyncOptions) => Promise<SyncResult>): { ok: boolean; run_id?: string; error?: string } {
    const running = this.db.findRunningRun("sync") ?? this.db.findRunningRun("sync_blog");
    if (running) {
      return { ok: false, error: running.scope === "sync_blog" ? "이미 진행 중인 블로그리뷰 동기화가 있습니다." : "이미 진행 중인 학원정보 동기화가 있습니다." };
    }
    const runId = this.db.createRun({ scope, method });
    void work({
      onTotal: (total) => this.db.updateRun(runId, { count_total: total }),
      onProgress: (tally) => this.db.updateRun(runId, { count_done: tally.done, result: tally }),
      shouldCancel: () => this.db.isCancelRequested(runId),
    })
      .then((res) => this.db.updateRun(runId, { status: res.cancelled ? "cancelled" : "done", count_done: res.matched, result: res, finished: true }))
      .catch((error) => {
        this.logger.error(`${method} failed: ${error?.message || error}`);
        this.db.updateRun(runId, { status: "error", error: String(error?.message || error), finished: true });
      });
    return { ok: true, run_id: runId };
  }

  // 단건(외부 id) 동기화 — 기본정보/리뷰/블로그리뷰 전부 새로고침. 한 곳뿐이라 블로그 10초를 감수한다.
  async syncOne(externalId: string, opts: { reviewLimit?: number; blogReviewLimit?: number } = {}): Promise<{ external_id: string; found: boolean; reviews: number }> {
    const all = await this.drivingplus.fetchAcademies();
    const academy = all.find((a) => String(a.id) === String(externalId));
    if (!academy) return { external_id: externalId, found: false, reviews: 0 };
    const id = this.upsertBaseRow(academy);
    const [reviewPage, blogPage] = await Promise.all([
      this.pullReviews(academy.id, opts.reviewLimit ?? 5),
      this.pullBlogReviews(academy.id, opts.blogReviewLimit ?? 5),
    ]);
    const reviews = this.storeReviewPlatform(id, reviewPage).stored + this.storeBlogPlatform(id, blogPage).stored;
    return { external_id: externalId, found: true, reviews };
  }

  private upsertBaseRow(academy: DrivingplusAcademy): string {
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
    return externalId;
  }

  // 후기는 원천이 준 목록으로 통째 교체하므로 조회 성공 여부를 반드시 구분해야 한다.
  // 실패를 빈 목록으로 폴백하면 일시적인 원천 장애가 그대로 후기 전멸이 된다.
  private pullReviews(academyId: number, limit: number) {
    return this.drivingplus.fetchReviews(academyId, limit)
      .then((page) => ({ ok: true, reviews: page.reviews }))
      .catch(() => ({ ok: false, reviews: [] as DrivingplusAcademy["reviews"] }));
  }

  // 블로그리뷰는 예외로 실패하지 않는다. 원천이 처리 한계를 넘으면 10초 뒤 code:200 + 빈 배열을
  // 돌려주기 때문에, catch 만으로는 "후기 없는 학원"과 구분되지 않아 그대로 전량교체 → 삭제가 된다.
  // fetchBlogReviewsResilient 가 재시도와 "느린 0건" 판정까지 마친 뒤 null(=못 가져옴)로 알려준다.
  private pullBlogReviews(academyId: number, limit: number) {
    return this.drivingplus.fetchBlogReviewsResilient(academyId, limit)
      .then((page) => page
        ? { ok: true, reviews: page.reviews }
        : { ok: false, reviews: [] as DrivingplusAcademy["blogReviews"] })
      .catch(() => ({ ok: false, reviews: [] as DrivingplusAcademy["blogReviews"] }));
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
      const error = "공개 소스를 찾지 못했습니다(검색/페치 실패). 값은 저장하지 않았습니다.";
      this.db.recordResearchAttempt(externalId, "no_sources", error);
      this.bumpRun(opts.runId);
      return { ok: false, external_id: externalId, provider: providers[0], no_sources: true, error };
    }

    // 2) 소스 본문에서만 추출(웹툴 불필요 → Opus 지정).
    // 원천이 이미 준 필드는 스키마에서 빼고 [이미 확정된 사실]로 넘긴다 — 겹치는 영역에서는
    // 웹 조사가 원천을 이기지 못하는데(파일럿 실측: 수강료 23% vs 87%), 그걸 다시 캐느라
    // 학원당 1분을 쓰고 있었다.
    const known = knownFactsFromSource(safeJsonParse(base.raw_json));
    const prompt = buildExtractionPrompt(ref, sources, known);
    let lastError = "";
    for (const provider of providers) {
      const out = await runResearchCli(prompt, { provider, model: provider === "claude" ? "opus" : undefined });
      if (!out.ok) { lastError = `${provider}: ${out.error || "CLI 실행 실패"}`; continue; }
      const parsed = parseResearchJson(out.text);
      if (!parsed) { lastError = `${provider}: JSON 파싱 실패(응답이 스키마와 다름)`; continue; }

      // 기계적으로 확정되는 값은 모델 답을 덮는다. 홈페이지·플레이스 URL 은 플레이스 JSON 에
      // 구조화돼 있어 추론할 이유가 없는데, 모델에 맡겼더니 채움률이 58% 였다(파일럿 26곳).
      this.applyStructuredFacts(parsed, sources);

      // 근거 URL이 비어있는 필드는 수집 소스 첫 URL로 보완(추적성 확보)
      const grounding = this.persistResearch(externalId, parsed, { engine: provider, method }, sources, known);
      this.bumpRun(opts.runId);
      return { ok: true, external_id: externalId, provider, sources: sources.length, ...grounding };
    }

    const error = lastError || "CLI 실행 실패";
    this.db.recordResearchAttempt(externalId, "failed", error);
    return { ok: false, external_id: externalId, provider: providers[providers.length - 1], error };
  }

  // 소스에서 기계적으로 확정되는 값을 모델 답 위에 덮고, 근거 URL 도 그 소스로 맞춘다.
  private applyStructuredFacts(parsed: ResearchResult, sources: Array<{ url: string; text: string }>): void {
    const facts = structuredFactsFromSources(sources);
    const placeUrl = facts.naver_place_url;
    if (!placeUrl) return;
    const sourceMap: Record<string, string> = { ...(parsed.sources ?? {}) };
    if (facts.homepage_url) { parsed.homepage_url = facts.homepage_url; sourceMap.homepage_url = placeUrl; }
    parsed.naver_place_url = placeUrl;
    sourceMap.naver_place_url = placeUrl;
    parsed.sources = sourceMap;
  }

  private bumpRun(runId?: string): void {
    if (!runId) return;
    const run = this.db.getRun(runId);
    this.db.updateRun(runId, { count_done: Number(run?.count_done ?? 0) + 1 });
  }

  // a: 전체 배치 조사. 백그라운드로 실행하고 runId 를 즉시 반환.
  //
  // 기본은 아직 조사되지 않은 학원만 대상으로 한다. 배치는 API 프로세스 안의 루프라
  // 파일 저장 한 번에 사라지는데, 그때 다시 실행하면 이어서 진행되게 하려는 것이다.
  // 이미 조사한 곳을 갱신하려면 refreshAll 을 켠다.
  async startRegionResearch(
    region?: string,
    opts: { provider?: ResearchProviderPreference; refreshAll?: boolean; limit?: number; offset?: number } = {},
  ): Promise<{ ok: boolean; run_id?: string; error?: string; count?: number }> {
    if (this.db.findRunningRun("all")) return { ok: false, error: "이미 진행 중인 전체 조사가 있습니다." };
    const providers = await this.resolveProviders(opts.provider);
    if (!providers.length) return { ok: false, error: "claude/codex CLI를 찾을 수 없습니다." };
    const targets = this.db.listBase({
      region,
      limit: opts.limit ?? 5000,
      onlyUnresearched: !opts.refreshAll,
      offset: opts.offset,
      // 재조사도 허용할 때는 아직 조사하지 않은 곳부터, 그다음 가장 오래된 조사부터 갱신한다.
      // 따라서 성공한 30곳씩 연달아 실행하면 직전 묶음 대신 다음 묶음으로 진행된다.
      // UI가 offset으로 페이지를 넘길 때는 고정된 이름순을 유지해야 한다. 조사 완료 시각은
      // 첫 배치가 끝날 때 바뀌므로, 그 상태에서 가변 순서 + offset을 같이 쓰면 중간 묶음을 건너뛴다.
      oldestResearchFirst: opts.refreshAll === true && opts.offset == null,
    });
    if (!targets.length) {
      return {
        ok: false,
        error: opts.refreshAll
          ? "동기화된 학원이 없습니다. 먼저 동기화하세요."
          : "조사할 학원이 없습니다(대상이 모두 조사됨). 이미 조사한 곳을 다시 조사하려면 '조사한 곳도 다시'를 켜세요.",
      };
    }

    const runId = this.db.createRun({ scope: "all", region, engine: opts.provider && opts.provider !== "auto" ? opts.provider : "auto", method: "a_batch", count_total: targets.length });
    // 백그라운드 실행(HTTP 응답을 막지 않음). 진행 상황은 research_runs 로 추적.
    void this.runRegionBatch(runId, targets.map((t) => String(t.external_id)), opts.provider ?? "auto")
      .catch((error) => { this.logger.error(`batch research failed: ${error?.message || error}`); this.db.updateRun(runId, { status: "error", error: String(error?.message || error), finished: true }); });
    return { ok: true, run_id: runId, count: targets.length };
  }

  /**
   * 학원 1곳 조사를 **백그라운드로** 시작하고 run_id 를 즉시 돌려준다.
   *
   * 예전에는 요청 안에서 끝까지 기다렸다. 그런데 조사 1곳은 평균 85초, 소스를 많이 따라가면
   * 388초까지 걸린다(실측). 관리자 프록시의 fetch 는 기본 300초에 끊으므로, 오래 걸린 조사는
   * **서버는 완주해 저장했는데 화면에는 실패로 뜬다.** 학원 동기화에서 이미 겪은 문제라
   * 같은 해법(run 행 + 폴링)을 쓴다.
   *
   * 배치와 겹쳐 도는 것은 막지 않는다 — 운영자가 특정 학원 하나를 지금 고치고 싶을 수 있다.
   * 다만 같은 학원을 두 번 겹쳐 돌리는 것은 막는다(서로의 값을 덮는다).
   */
  async startSingleResearch(
    externalId: string,
    opts: { provider?: ResearchProviderPreference } = {},
  ): Promise<{ ok: boolean; run_id?: string; error?: string }> {
    if (!this.db.getBase(externalId)) return { ok: false, error: "학원(base)이 없습니다. 먼저 동기화하세요." };
    if (this.db.findRunningRunForAcademy(externalId)) return { ok: false, error: "이 학원은 이미 조사 중입니다." };
    const providers = await this.resolveProviders(opts.provider);
    if (!providers.length) return { ok: false, error: "claude/codex CLI를 찾을 수 없습니다." };

    const runId = this.db.createRun({
      scope: "single",
      external_id: externalId,
      engine: opts.provider && opts.provider !== "auto" ? opts.provider : "auto",
      method: "b_single",
      count_total: 1,
    });
    void this.researchOne(externalId, { method: "b_single", provider: opts.provider ?? "auto" })
      .then((result) => {
        // 소스 없음은 예외가 아니라 명시적 상태다(값을 지어내지 않으려는 설계). 그래도 성공은
        // 아니므로 error 로 끝낸다 — 화면이 "완료" 로 읽으면 빈 결과를 성공으로 오해한다.
        this.db.updateRun(runId, {
          status: result.ok ? "done" : "error",
          count_done: 1,
          result: { saved: result.ok ? 1 : 0, no_sources: result.no_sources ? 1 : 0, sources: result.sources ?? 0, provider: result.provider },
          error: result.ok ? undefined : (result.error || "조사 실패"),
          finished: true,
        });
      })
      .catch((error) => {
        this.logger.error(`single research failed: ${error?.message || error}`);
        this.db.recordResearchAttempt(externalId, "failed", String(error?.message || error));
        this.db.updateRun(runId, { status: "error", count_done: 1, error: String(error?.message || error), finished: true });
      });
    return { ok: true, run_id: runId };
  }

  // 조사는 학원 1곳당 웹 수집 + LLM 호출이라 동시 실행하지 않는다(CLI 서브프로세스가 곱절로 뜬다).
  // 취소는 학원 사이에서만 확인하므로, 진행 중이던 1곳은 마치고 멈춘다.
  //
  // 결과를 반드시 집계한다. researchOne 은 소스를 못 찾으면 예외가 아니라 no_sources 로
  // 정상 반환하는데(값을 지어내지 않으려는 설계), 이걸 버리면 전건 실패한 배치도
  // "done 380/380" 으로 끝나 운영자는 성공으로 읽는다. 실제로 검색이 막혔던 동안
  // 그렇게 돌고 있었다.
  private async runRegionBatch(runId: string, externalIds: string[], provider: ResearchProviderPreference): Promise<void> {
    // last_error 를 집계에 함께 싣는다. 예전에는 부분 실패일 때 사유가 버려져,
    // 100곳 중 56곳이 연속 실패해도(2026-07-28, 토큰 한도 추정) 원인이 어디에도 남지 않았다.
    // 실패 곳수만 보이고 왜인지 모르면 "조용한 실패" 를 숫자로 바꾼 것에 지나지 않는다.
    const tally = { done: 0, saved: 0, no_sources: 0, failed: 0, last_error: "" };
    let cancelled = false;
    for (const externalId of externalIds) {
      if (this.db.isCancelRequested(runId)) { cancelled = true; break; }
      try {
        const result = await this.researchOne(externalId, { method: "a_batch", provider });
        if (result.ok) tally.saved += 1;
        else if (result.no_sources) tally.no_sources += 1;
        else {
          tally.failed += 1;
          tally.last_error = result.error || tally.last_error;
          // CLI(research:once) 로그에 그대로 찍힌다. 배치가 왜 무너졌는지 그 자리에서 보여야 한다.
          this.logger.warn(`researchOne(${externalId}) 실패: ${result.error ?? "사유 없음"}`);
        }
      } catch (error: any) {
        tally.failed += 1;
        tally.last_error = String(error?.message || error);
        this.db.recordResearchAttempt(externalId, "failed", tally.last_error);
        this.logger.warn(`researchOne(${externalId}) 예외: ${tally.last_error}`);
      }
      tally.done += 1;
      this.db.updateRun(runId, { count_done: tally.done, result: tally });
    }
    // 한 건도 저장하지 못했으면 완료가 아니라 실패다. 초록색 "완료"가 수집 0건을 덮지 않게 한다.
    const barren = tally.done > 0 && tally.saved === 0;
    this.db.updateRun(runId, {
      status: cancelled ? "cancelled" : barren ? "error" : "done",
      result: tally,
      error: barren ? `${tally.done}곳 모두 저장 실패(소스 없음 ${tally.no_sources} · 조사 실패 ${tally.failed})${tally.last_error ? ` — ${tally.last_error}` : ""}` : undefined,
      finished: true,
    });
  }

  private persistResearch(
    externalId: string,
    parsed: ResearchResult,
    meta: { engine: ResearchProvider; method: string },
    collected: WebSource[] = [],
    known: KnownFacts = baseKnownFacts(),
  ): { checked: number; flagged: number } {
    // 덮어쓰기 전에 이전 값·검증상태를 읽어 둔다. 사람이 검증완료로 올린 값을 재조사가
    // 무조건 풀어버리면, 검토에 들인 노동이 조사 한 번에 전부 날아간다.
    const previousValues = this.db.getResearch(externalId) ?? {};
    const previousStatus = new Map<string, string>(
      this.db.listFieldMeta(externalId).map((row) => [String(row.field_key), String(row.status ?? "")]),
    );

    const scalar: Record<string, unknown> = {};
    for (const key of SCALAR_KEYS) {
      const value = parsed[key];
      if (value !== undefined) scalar[key as string] = value ?? null;
    }
    // 원천이 답을 가진 필드는 비운다. 스키마에서 뺐으니 모델은 값을 보내지 않고,
    // upsertResearch 는 안 보낸 키를 건드리지 않아 예전 조사값이 그대로 남는다.
    // 그러면 원천값과 모순되는 낡은 값이 DB 에 남아 어느 쪽이 쓰일지 알 수 없게 된다.
    for (const key of known.skipFields) if (SCALAR_KEY_SET.has(key)) scalar[key] = null;
    this.db.upsertResearch(externalId, scalar, { engine: meta.engine, method: meta.method });
    this.db.clearWebBlocked(externalId); // 이전 CLI-웹 조사의 web_blocked 흔적 정리

    // 그라운딩 대조용 소스 본문. 지금 이 자리에서만 원문을 볼 수 있다 — 수집 결과는
    // 저장하지 않고, 나중에 다시 수집하면 다른 페이지가 나온다(실측: 3건 → 0건).
    const haystack = sourceHaystack(collected);

    // 원천이 수강료·노선을 가진 학원은 배열도 비운다(요구하지 않았으므로 예전 행이 남는다).
    if (known.skipCourses) this.db.replaceCourses(externalId, []);
    else if (Array.isArray(parsed.courses)) this.db.replaceCourses(externalId, gradeCoursePrices(parsed.courses, haystack));
    if (known.skipShuttleRoutes) this.db.replaceShuttleRoutes(externalId, []);
    else if (Array.isArray(parsed.shuttle_routes)) this.db.replaceShuttleRoutes(externalId, parsed.shuttle_routes as Array<Record<string, unknown>>);

    // 값이 채워진 스칼라 필드는 출처 URL 기록(모델 sources → 없으면 수집소스 첫 URL) + 그라운딩 검사.
    // 걸린 값도 버리지 않고 needs_review 로 낮춰 사유를 남긴다. 표기 차이로 인한 오탈락이
    // 얼마나 나는지 관측한 뒤에 게이트로 조일지 정한다.
    const sources = parsed.sources && typeof parsed.sources === "object" ? parsed.sources : {};
    const fallbackUrl = collected[0]?.url;
    let checked = 0;
    let flagged = 0;
    for (const key of known.skipFields) {
      // 조사 대상이 아니었음을 남긴다 — 값이 빈 것과 "원천이 답을 가졌다"는 다르다.
      if (SCALAR_KEY_SET.has(key)) {
        this.db.setFieldMeta(externalId, key, { status: "unverified", note: known.skipReasons.get(key) ?? "조사 대상이 아님" });
      }
    }
    for (const key of SCALAR_KEYS) {
      if (known.skipFields.has(key as string)) continue;
      const value = parsed[key];
      if (value == null || value === "") continue;
      const sourceUrl = sources[key as string] ?? fallbackUrl;
      const report = inspectResearchValue(key as string, String(value), haystack);
      checked += 1;
      if (hasFinding(report)) flagged += 1;
      const status = nextFieldStatus({
        wasVerified: previousStatus.get(key as string) === "verified",
        unchanged: String(previousValues[key as string] ?? "") === String(value),
        hasFinding: hasFinding(report),
      });
      this.db.setFieldMeta(externalId, key as string, {
        status,
        source_url: sourceUrl,
        source_name: sourceUrl ? undefined : `${meta.engine} 조사`,
        // 빈 문자열로 덮는다. setFieldMeta 가 note 를 COALESCE 로 유지하므로 undefined 를 넘기면
        // 지난 실행의 지적 사유가 그대로 남아, 이제 깨끗해진 값 옆에 옛 사유가 붙는다.
        note: findingNote(report) ?? "",
      });
    }
    return { checked, flagged };
  }

  private async resolveProviders(preference: ResearchProviderPreference | undefined): Promise<ResearchProvider[]> {
    if (preference && preference !== "auto") return [preference];
    return detectResearchProviders();
  }

  // 후기는 플랫폼 단위로 통째 교체한다 — 원천에서 내려간(삭제·비공개 처리된) 후기가
  // 근거로 남지 않게 하기 위함. 조회에 실패했으면 손대지 않고 기존 행을 그대로 둔다.
  private storeReviewPlatform(externalId: string, page: { ok: boolean; reviews: DrivingplusAcademy["reviews"] }): { stored: number; outcome: SyncOutcome } {
    if (!page.ok) return { stored: 0, outcome: "failed" };
    const rows = (page.reviews ?? []).flatMap((item, i) => {
      const content = String(item.content ?? "").trim();
      if (!content) return [];
      return [{
        external_id: externalId,
        platform: "drivingplus_review",
        source_key: item.id != null ? String(item.id) : `r${i}`,
        rating: item.point ?? null,
        quote_text: content,
        author_masked: maskAuthor(item.author),
        posted_at: item.date ?? null,
        collect_method: "drivingplus_api",
      }];
    });
    this.db.replaceReviews(externalId, "drivingplus_review", rows);
    return { stored: rows.length, outcome: rows.length ? "data" : "empty" };
  }

  private storeBlogPlatform(externalId: string, page: { ok: boolean; reviews: DrivingplusAcademy["blogReviews"] }): { stored: number; outcome: SyncOutcome } {
    if (!page.ok) return { stored: 0, outcome: "failed" };
    const rows = (page.reviews ?? []).flatMap((item, i) => {
      const content = String(item.content ?? item.title ?? "").trim();
      if (!content) return [];
      return [{
        external_id: externalId,
        platform: "drivingplus_blog",
        source_key: item.link ? item.link : `b${i}`,
        title: item.title ?? null,
        quote_text: content,
        source_url: item.link ?? null,
        posted_at: item.postdate ?? null,
        images: item.images ?? null,
        collect_method: "drivingplus_api",
      }];
    });
    this.db.replaceReviews(externalId, "drivingplus_blog", rows);
    return { stored: rows.length, outcome: rows.length ? "data" : "empty" };
  }
}

/**
 * 재조사 뒤 필드가 가질 검증상태.
 *
 * 사람이 검증완료로 올린 값은 **그 값 그대로일 때만** 승인을 유지한다.
 * - 값이 바뀌었으면 사람이 확인한 적 없는 값이므로 다시 검토 대상으로 내린다.
 * - 값이 그대로면 그라운딩 검사에 걸리더라도 승인을 유지한다. 사람이 그 문자열을 보고
 *   판단한 결과가 자동 검사보다 우선이다. 다만 사유(note)는 남겨 화면에 보이게 한다.
 */
export function nextFieldStatus(input: { wasVerified: boolean; unchanged: boolean; hasFinding: boolean }): string {
  if (input.wasVerified && input.unchanged) return "verified";
  return input.hasFinding ? "needs_review" : "ai_draft";
}

// 과정별 가격은 날조 시 피해가 가장 큰 값이라 소스 대조 결과를 행에 남긴다.
// 가격이 비어 있는 과정(이번 파일럿에선 44건 중 39건)은 검사 대상이 아니다.
function gradeCoursePrices(courses: ResearchResult["courses"], haystack: string): Array<Record<string, unknown>> {
  return (courses ?? []).map((course) => {
    const row = course as Record<string, unknown>;
    const price = row.price == null ? "" : String(row.price);
    if (!price.trim()) return row;
    // 필드 타입 규칙은 요금과 같으므로 fee_summary 규칙을 빌려 쓴다(개인거래 가격 등).
    const report = inspectResearchValue("fee_summary", price, haystack);
    return hasFinding(report) ? { ...row, verified_status: "needs_review" } : row;
  });
}

// academy_base.raw_json 은 TEXT 컬럼이라 문자열로 돌아온다. 손상된 값은 조사를 막지 않고 무시한다.
function safeJsonParse(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return null; }
}

// 작성자 식별정보 최소화: 첫 글자만 남기고 마스킹.
function maskAuthor(author: string | null | undefined): string | null {
  const name = String(author ?? "").trim();
  if (!name) return null;
  const first = [...name][0] ?? "";
  return `${first}${"*".repeat(Math.max(1, [...name].length - 1))}`;
}
