import { Injectable } from "@nestjs/common";
import { drivingplusApiBaseUrl } from "./runtime-config.js";

export type SeoRegionLevel = "all" | "2" | "3";
export type DrivingplusReviewSort = "new" | "point";

/** 사용자가 동기화를 멈춘 경우. 실패(원천 장애)와 구분해야 실행 이력이 오해를 안 만든다. */
export class CancelledError extends Error {
  constructor() {
    super("사용자가 동기화를 취소했습니다.");
    this.name = "CancelledError";
  }
}

/**
 * 원천 조회 노브. 엔드포인트별 감당 능력이 전혀 다르다(2026-07-27 운영 실측).
 * - `/v1/review/list`      : 동시 8로 80건 1.0초, 실패 0.
 * - `/v1/blog-review/list` : 동시 1이면 60건 전건 성공(건당 2.6초, 최대 4.2초).
 *   동시 2에서 절반, 동시 4에서 5/24 만 성공. 외부 블로그 검색을 경유하는 탓으로 보인다.
 *
 * 까다로운 점은 초과분이 **예외가 아니라 10초 뒤 `code:200` + 빈 배열**로 온다는 것이다.
 * 그래서 "느린 0건"을 실패로 판정한다 — 정상 응답 최대치(4.2초)와 타임아웃(10초) 사이가
 * 넉넉히 벌어져 있어 구분이 선다. 이 간격이 좁아지면 판정을 다시 봐야 한다.
 *
 * 값은 실행 시점에 읽는다(모듈 로드 시점이 아니라). 테스트가 덮어쓸 수 있어야 하고,
 * 원천이 개선되면 재배포 없이 조정해 재측정하기 위해서다. 380곳 기준 동시 1은 약 12분.
 */
function blogReviewKnobs() {
  return {
    concurrency: intEnv("DRIVINGPLUS_BLOG_REVIEW_CONCURRENCY", 1, 1, 16),
    attempts: intEnv("DRIVINGPLUS_BLOG_REVIEW_ATTEMPTS", 3, 1, 5),
    retryDelayMs: intEnv("DRIVINGPLUS_BLOG_REVIEW_RETRY_DELAY_MS", 700, 0, 10_000),
    slowEmptyMs: intEnv("DRIVINGPLUS_BLOG_REVIEW_SLOW_EMPTY_MS", 8_000, 0, 60_000),
    // 실패가 이 정도로 번지면 부분 반영 없이 동기화를 통째로 중단한다.
    abortMinFailures: intEnv("DRIVINGPLUS_BLOG_REVIEW_ABORT_MIN_FAILURES", 10, 1, 10_000),
    abortRatio: 0.2,
  };
}

export interface DrivingplusAcademy {
  id: number;
  title: string;
  seoTitle?: string | null;
  seoKeywords?: string | null;
  seoDescription?: string | null;
  roadAddress?: string | null;
  phone?: string | null;
  vphone?: string | null;
  /** 원천이 만든 학원 소개 본문(마케팅 문구). 근거 자료로만 보관하고 본문에 그대로 옮기지 않는다. */
  seoContent?: string | null;
  roadLatitude?: number | null;
  roadLongitude?: number | null;
  thumbSavePath?: string | null;
  type?: string | null;
  photos?: string[];
  reviews?: DrivingplusReview[];
  blogReviews?: DrivingplusBlogReview[];
  /** 리뷰 목록 endpoint 의 집계값. includeReviews/includeBlogReviews 로 조회했을 때만 채워진다. */
  reviewStats?: DrivingplusReviewStats | null;
  blogReviewStats?: DrivingplusBlogReviewStats | null;
  // 아래 필드는 dev·운영 endpoint 모두 내려준다(2026-07-27 실측, 운영 380곳 중 값 보유 수):
  // licenseTypes 336 · educationPerformance 331 · roadCourses 275 · priceObservations 208 ·
  // seoContent 380 · shuttleBuses 212 · operateHour 256. 예전 주석은 "seoContent·셔틀·영업시간은
  // 운영에 키 자체가 없다"였는데 사실이 아니었다. 필드별 현황은 docs/source-field-usage.md 참고.
  licenseTypes?: DrivingplusLicenseType[];
  educationPerformance?: DrivingplusEducationPerformance | null;
  priceObservations?: DrivingplusPriceObservation[];
  /** 값이 없는 학원도 많다(운영·dev 모두 212/380 수준) — 없으면 빈 값으로 흘러간다. */
  shuttleBuses?: DrivingplusShuttleBus[];
  /** shuttleBuses 노선표와 별개로 내려오는 셔틀 안내 필드(안내 URL·설명·안내 이미지). */
  shuttleBusUrl?: string | null;
  shuttleBusDetail?: string | null;
  shuttleBusImageUrl?: string | null;
  operateHour?: DrivingplusOperateHour | null;
  roadCourses?: DrivingplusRoadCourse[];
}

/**
 * 리뷰 목록 응답의 집계값.
 * totalCount/averagePoint 는 원천 전체 기준(부정 리뷰 필터 이전)이고 sourceCount 는 이번 페이지가 준 개수다.
 * 저장만 하고 본문에서 단정하지 않는다(평점·리뷰 수를 그대로 쓰면 근거 없는 신뢰도 주장이 된다).
 */
export interface DrivingplusReviewStats {
  totalCount: number | null;
  averagePoint: number | null;
  sourceCount: number;
}

/** 블로그 리뷰 집계. totalCount 는 원천 검색엔진의 총 노출 건수라 학원 언급 글 수가 아니다(과대). */
export interface DrivingplusBlogReviewStats {
  searchTotalCount: number | null;
  sourceCount: number;
}

export interface DrivingplusReviewPage extends DrivingplusReviewStats {
  reviews: DrivingplusReview[];
}

export interface DrivingplusBlogReviewPage extends DrivingplusBlogReviewStats {
  reviews: DrivingplusBlogReview[];
}

export interface DrivingplusLicenseType {
  code: string;
  label: string;
}

/**
 * 분기 단위 교육실적. fees 는 공시 성격의 수강료다.
 * accidentRate 는 '교통사고율'이고 graduates 는 '수료생 수'이며, 둘 다 합격률이 아니다.
 * 합격률 원천은 어디에도 없으므로 academies.pass_rate 는 계속 비워 둔다.
 */
export interface DrivingplusEducationPerformance {
  year: number | null;
  quarter: number | null;
  fees: {
    type1Manual: number | null;
    type1Auto: number | null;
    type2Auto: number | null;
    vatIncluded: boolean | null;
    examFeeIncluded: boolean | null;
  } | null;
  capacity: number | null;
  graduates: number | null;
  injuryAccidents: number | null;
  accidentRate: number | null;
}

/** 외부 수집 가격 관측치(naver_place 등). 신뢰도·수집시점이 제각각이라 본문 단정에는 쓰지 않는다. */
export interface DrivingplusPriceObservation {
  source: string | null;
  sourceUrl: string | null;
  licenseType: string | null;
  courseType: string | null;
  gearType: string | null;
  applicantType: string | null;
  priceUnit: string | null;
  priceKind: string | null;
  amount: number | null;
  amountMax: number | null;
  amountVatIncluded: number | null;
  vatIncluded: boolean | null;
  vatFlagSource: string | null;
  examFeeIncluded: boolean | null;
  rawLabel: string | null;
  confidence: string | null;
  collectedAt: string | null;
}

export interface DrivingplusShuttleStop {
  time: string | null;
  runDirection: string | null;
}

export interface DrivingplusShuttleBus {
  title: string | null;
  runDirection: string | null;
  content: string | null;
  footContent: string | null;
  phone: string | null;
  /** 원천 UI 의 노선 배지 색상. 콘텐츠 근거는 아니고 원문 보존용이다. */
  backgroundColor: string | null;
  times?: DrivingplusShuttleStop[];
}

export interface DrivingplusOperateHour {
  monOpenTime: string | null; monCloseTime: string | null; monIsHoliday: boolean | null;
  tueOpenTime: string | null; tueCloseTime: string | null; tueIsHoliday: boolean | null;
  wedOpenTime: string | null; wedCloseTime: string | null; wedIsHoliday: boolean | null;
  thuOpenTime: string | null; thuCloseTime: string | null; thuIsHoliday: boolean | null;
  friOpenTime: string | null; friCloseTime: string | null; friIsHoliday: boolean | null;
  satOpenTime: string | null; satCloseTime: string | null; satIsHoliday: boolean | null;
  sunOpenTime: string | null; sunCloseTime: string | null; sunIsHoliday: boolean | null;
  holidayOpenTime: string | null; holidayCloseTime: string | null; holidayIsHoliday?: boolean | null;
  notice: string | null;
}

export interface DrivingplusRoadCourse {
  title: string | null;
  subtitle: string | null;
  content: string | null;
  imageUrl: string | null;
  youtubeVideoId: string | null;
  /** 원천 스키마에는 있으나 현재 전 건 null 이다(값이 채워지면 그대로 보관된다). */
  difficulty: string | null;
}

export interface DrivingplusReview {
  id?: number | null;
  author?: string | null;
  point?: number | null;
  content: string;
  date?: string | null;
  images?: string[];
  numLike?: number | null;
}

export interface DrivingplusBlogReview {
  title: string;
  content?: string | null;
  link?: string | null;
  postdate?: string | null;
  images?: string[];
}

export interface DrivingplusSeoRegion {
  level: number;
  region: string;
  latitude: number | null;
  longitude: number | null;
}

@Injectable()
export class DrivingplusApiService {
  readonly baseUrl = drivingplusApiBaseUrl();
  private readonly timeoutMs = Number(process.env.DRIVINGPLUS_API_TIMEOUT_MS || 30000);

  /**
   * 학원 목록 + (선택) 자체 후기 + (선택) 블로그리뷰.
   *
   * 블로그리뷰를 포함하면 학원 380곳 기준 12분 넘게 걸린다(순차 조회). 그래서 호출부가
   * 진행 상황을 보여주고 중간에 멈출 수 있도록 onStep/onProgress/shouldCancel 을 받는다.
   * 취소되면 그때까지 모은 결과를 반환하지 않고 CancelledError 를 던진다 — 절반만 받은
   * 목록으로 upsert 하면 나머지 학원의 후기가 "0건"으로 지워지기 때문이다.
   */
  async fetchAcademies(opts: {
    includeReviews?: boolean;
    reviewLimit?: number;
    reviewSort?: DrivingplusReviewSort;
    includeBlogReviews?: boolean;
    blogReviewLimit?: number;
    onStep?: (step: string, total?: number) => void;
    onProgress?: (done: number, total: number) => void;
    shouldCancel?: () => boolean;
  } = {}): Promise<DrivingplusAcademy[]> {
    opts.onStep?.("학원 목록 조회 중");
    const payload = await this.get<{ code?: number; message?: string; data?: unknown }>("/v1/academy/get-all-academy");
    const rows = requireArray(payload, "academy data");
    const academies = rows.map(normalizeAcademy).filter((row): row is DrivingplusAcademy => Boolean(row));
    if (!opts.includeReviews && !opts.includeBlogReviews) return academies;
    const reviewLimit = Math.max(1, Math.min(10, Math.trunc(Number(opts.reviewLimit ?? 5))));
    const reviewSort = opts.reviewSort === "new" ? "new" : "point";
    const blogReviewLimit = Math.max(1, Math.min(10, Math.trunc(Number(opts.blogReviewLimit ?? 3))));

    // 1단계: 자체 후기. 이 엔드포인트는 동시 요청에 강하다(2026-07-27 운영 실측: 동시 8로 80건을
    // 1.0초, 실패 0). 블로그리뷰와 같은 루프에 두면 블로그리뷰 속도에 발이 묶이므로 분리한다.
    let enriched: DrivingplusAcademy[] = academies;
    if (opts.includeReviews) {
      opts.onStep?.("자체 후기 조회 중", academies.length);
      let reviewDone = 0;
      enriched = await mapLimit(enriched, intEnv("DRIVINGPLUS_REVIEW_CONCURRENCY", 8, 1, 16), async (academy) => {
        if (opts.shouldCancel?.()) throw new CancelledError();
        const next: DrivingplusAcademy = { ...academy };
        try {
          const page = await this.fetchReviews(academy.id, reviewLimit, reviewSort);
          next.reviews = page.reviews.length ? page.reviews : academy.reviews;
          next.reviewStats = { totalCount: page.totalCount, averagePoint: page.averagePoint, sourceCount: page.sourceCount };
        } catch {
          next.reviews = academy.reviews;
        }
        opts.onProgress?.(++reviewDone, academies.length);
        return next;
      });
    }
    if (!opts.includeBlogReviews) return enriched;

    // 2단계: 블로그리뷰. 원천이 지속 동시요청을 못 버티므로 기본 순차다(위 blogReviewKnobs 주석).
    const knobs = blogReviewKnobs();
    opts.onStep?.("블로그리뷰 조회 중", enriched.length);
    let missing = 0;
    let blogDone = 0;
    const withBlogReviews = await mapLimit(enriched, knobs.concurrency, async (academy) => {
      if (opts.shouldCancel?.()) throw new CancelledError();
      const page = await this.fetchBlogReviewsResilient(academy.id, blogReviewLimit, knobs);
      opts.onProgress?.(++blogDone, enriched.length);
      // 못 가져온 경우 blogReviews 를 undefined 로 남긴다. upsertDrivingplusAcademies 가 이때
      // 기존 blog_reviews 컬럼을 보존한다(빈 배열로 덮으면 전량교체 정책상 삭제가 된다).
      if (!page) {
        missing++;
        return academy;
      }
      return {
        ...academy,
        blogReviews: page.reviews,
        blogReviewStats: { searchTotalCount: page.searchTotalCount, sourceCount: page.sourceCount },
      };
    });

    // 개별 보존만으로는 부족하다. 원천이 통째로 흔들리는 날에는 "정상 0건"이 대량으로 섞여 들어와
    // 후기가 대규모 삭제된다(실제로 453 → 342건으로 줄어든 적이 있다). 실패가 임계를 넘으면
    // 부분 동기화로 진행하지 않고 통째로 중단해, 호출부가 DB 를 건드리지 못하게 한다.
    const failureRatio = withBlogReviews.length ? missing / withBlogReviews.length : 0;
    if (missing >= knobs.abortMinFailures && failureRatio >= knobs.abortRatio) {
      throw new Error(
        `DrivingPlus 블로그리뷰 조회가 ${withBlogReviews.length}곳 중 ${missing}곳에서 실패했습니다(${Math.round(failureRatio * 100)}%). ` +
        `기존 후기가 대량 삭제되는 것을 막기 위해 동기화를 중단했습니다. 원천 상태 확인 후 다시 실행하세요.`,
      );
    }
    return withBlogReviews;
  }

  /**
   * 블로그리뷰 1건 조회.
   *
   * 반환값의 의미가 호출부 계약이다:
   * - 페이지  → 원천이 확인해준 결과. 0건이면 정말 0건이므로 기존 후기를 지워도 된다.
   * - `null`  → 못 가져왔다. 기존 후기를 유지해야 한다.
   *
   * 원천이 실패를 `code:200` + 빈 배열로 감추므로 0건은 그 자체로는 판단 근거가 못 된다.
   * 두 가지를 함께 본다. (1) 0건이면 일단 재시도한다. (2) **느린 0건은 실패로 본다** —
   * 과부하 응답은 10초 타임아웃 뒤 오고 정상 응답은 최대 4.2초였다(실측). 빠른 0건만
   * 진짜 0건으로 인정한다.
   */
  async fetchBlogReviewsResilient(
    academyId: number,
    limit: number,
    knobs: { attempts: number; retryDelayMs: number; slowEmptyMs: number } = blogReviewKnobs(),
  ): Promise<DrivingplusBlogReviewPage | null> {
    let confirmedEmpty: DrivingplusBlogReviewPage | null = null;
    for (let attempt = 0; attempt < knobs.attempts; attempt++) {
      if (attempt > 0 && knobs.retryDelayMs > 0) await sleep(knobs.retryDelayMs * attempt);
      const startedAt = Date.now();
      try {
        const page = await this.fetchBlogReviews(academyId, limit);
        if (page.sourceCount > 0) return page;
        if (Date.now() - startedAt < knobs.slowEmptyMs) confirmedEmpty = page;
      } catch {
        // 다음 시도로
      }
    }
    return confirmedEmpty;
  }

  async fetchReviews(academyId: number, limit = 5, sort: "new" | "point" = "point"): Promise<DrivingplusReviewPage> {
    const payload = await this.get<{ code?: number; message?: string; data?: unknown }>(`/v1/review/list/${encodeURIComponent(String(academyId))}?sort=${sort}&limit=${encodeURIComponent(String(limit))}`);
    const data = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : {};
    const rows = Array.isArray(data.reviews) ? data.reviews : [];
    return {
      reviews: rows.map(normalizeReview).filter((row): row is DrivingplusReview => Boolean(row)).slice(0, Math.max(1, limit)),
      totalCount: num(data.totalCount),
      averagePoint: num(data.point),
      sourceCount: rows.length,
    };
  }

  async fetchBlogReviews(academyId: number, limit = 3): Promise<DrivingplusBlogReviewPage> {
    const payload = await this.get<{ code?: number; message?: string; data?: unknown }>(`/v1/blog-review/list/${encodeURIComponent(String(academyId))}?limit=${encodeURIComponent(String(limit))}`);
    const data = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : {};
    const rows = Array.isArray(data.reviews) ? data.reviews : [];
    return {
      reviews: rows.map(normalizeBlogReview).filter((row): row is DrivingplusBlogReview => Boolean(row)).slice(0, Math.max(1, limit)),
      searchTotalCount: num(data.totalCount),
      sourceCount: rows.length,
    };
  }

  async fetchSeoRegions(level: SeoRegionLevel = "2"): Promise<DrivingplusSeoRegion[]> {
    const suffix = level === "all" ? "?level=all" : `?level=${encodeURIComponent(level)}`;
    const payload = await this.get<{ code?: number; message?: string; data?: unknown }>(`/v1/zipcode/search-seo${suffix}`);
    const rows = requireArray(payload, "seo region data");
    return rows.map(normalizeSeoRegion).filter((row): row is DrivingplusSeoRegion => Boolean(row));
  }

  private async get<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`DrivingPlus API ${path} failed: ${res.status} ${res.statusText} ${text.slice(0, 300)}`);
      const payload = JSON.parse(text) as T & { code?: number; message?: string };
      if (payload && typeof payload === "object" && payload.code !== undefined && Number(payload.code) !== 200) {
        throw new Error(`DrivingPlus API ${path} returned code ${payload.code}: ${payload.message || ""}`);
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }
}

function requireArray(payload: { data?: unknown }, label: string): unknown[] {
  if (!Array.isArray(payload.data)) throw new Error(`DrivingPlus ${label} is not an array`);
  return payload.data;
}

/** 원천 응답 1건 → 내부 타입. 여기서 빠뜨린 필드는 DB 까지 못 가므로 테스트가 필드 보존을 잠근다. */
export function normalizeAcademy(value: unknown): DrivingplusAcademy | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = Number(row.id);
  const title = str(row.title);
  if (!Number.isFinite(id) || !title) return null;
  return {
    id,
    title,
    seoTitle: str(row.seoTitle),
    seoKeywords: str(row.seoKeywords),
    seoDescription: str(row.seoDescription),
    seoContent: str(row.seoContent),
    roadAddress: str(row.roadAddress),
    phone: str(row.phone),
    vphone: str(row.vphone),
    roadLatitude: num(row.roadLatitude),
    roadLongitude: num(row.roadLongitude),
    thumbSavePath: str(row.thumbSavePath),
    type: str(row.type),
    photos: Array.isArray(row.photos) ? row.photos.map(str).filter(Boolean) : [],
    reviews: Array.isArray(row.reviews) ? row.reviews.map(normalizeReview).filter((review): review is DrivingplusReview => Boolean(review)) : [],
    licenseTypes: Array.isArray(row.licenseTypes) ? row.licenseTypes.map(normalizeLicenseType).filter((type): type is DrivingplusLicenseType => Boolean(type)) : [],
    educationPerformance: normalizeEducationPerformance(row.educationPerformance),
    priceObservations: Array.isArray(row.priceObservations) ? row.priceObservations.map(normalizePriceObservation) : [],
    shuttleBuses: Array.isArray(row.shuttleBuses) ? row.shuttleBuses.map(normalizeShuttleBus) : [],
    shuttleBusUrl: str(row.shuttleBusUrl) || null,
    shuttleBusDetail: str(row.shuttleBusDetail) || null,
    shuttleBusImageUrl: str(row.shuttleBusImageUrl) || null,
    operateHour: normalizeOperateHour(row.operateHour),
    roadCourses: Array.isArray(row.roadCourses) ? row.roadCourses.map(normalizeRoadCourse) : [],
  };
}

function normalizeLicenseType(value: unknown): DrivingplusLicenseType | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const label = str(row.label);
  if (!label) return null;
  return { code: str(row.code), label };
}

function normalizeEducationPerformance(value: unknown): DrivingplusEducationPerformance | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const feesRow = row.fees && typeof row.fees === "object" ? row.fees as Record<string, unknown> : null;
  return {
    year: num(row.year),
    quarter: num(row.quarter),
    fees: feesRow
      ? {
        type1Manual: num(feesRow.type1Manual),
        type1Auto: num(feesRow.type1Auto),
        type2Auto: num(feesRow.type2Auto),
        vatIncluded: bool(feesRow.vatIncluded),
        examFeeIncluded: bool(feesRow.examFeeIncluded),
      }
      : null,
    capacity: num(row.capacity),
    graduates: num(row.graduates),
    injuryAccidents: num(row.injuryAccidents),
    accidentRate: num(row.accidentRate),
  };
}

function normalizePriceObservation(value: unknown): DrivingplusPriceObservation {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    source: str(row.source) || null,
    sourceUrl: str(row.sourceUrl) || null,
    licenseType: str(row.licenseType) || null,
    courseType: str(row.courseType) || null,
    gearType: str(row.gearType) || null,
    applicantType: str(row.applicantType) || null,
    priceUnit: str(row.priceUnit) || null,
    priceKind: str(row.priceKind) || null,
    amount: num(row.amount),
    amountMax: num(row.amountMax),
    amountVatIncluded: num(row.amountVatIncluded),
    vatIncluded: bool(row.vatIncluded),
    vatFlagSource: str(row.vatFlagSource) || null,
    examFeeIncluded: bool(row.examFeeIncluded),
    rawLabel: str(row.rawLabel) || null,
    confidence: str(row.confidence) || null,
    collectedAt: str(row.collectedAt) || null,
  };
}

function normalizeShuttleBus(value: unknown): DrivingplusShuttleBus {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    title: str(row.title) || null,
    runDirection: str(row.runDirection) || null,
    content: str(row.content) || null,
    footContent: str(row.footContent) || null,
    phone: str(row.phone) || null,
    backgroundColor: str(row.backgroundColor) || null,
    times: Array.isArray(row.times)
      ? row.times.map((stop) => {
        const cell = stop && typeof stop === "object" ? stop as Record<string, unknown> : {};
        return { time: str(cell.time) || null, runDirection: str(cell.runDirection) || null };
      })
      : [],
  };
}

function normalizeOperateHour(value: unknown): DrivingplusOperateHour | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const day = (prefix: string) => ({
    [`${prefix}OpenTime`]: str(row[`${prefix}OpenTime`]) || null,
    [`${prefix}CloseTime`]: str(row[`${prefix}CloseTime`]) || null,
    [`${prefix}IsHoliday`]: bool(row[`${prefix}IsHoliday`]),
  });
  return {
    ...day("mon"), ...day("tue"), ...day("wed"), ...day("thu"),
    ...day("fri"), ...day("sat"), ...day("sun"), ...day("holiday"),
    notice: str(row.notice) || null,
  } as DrivingplusOperateHour;
}

function normalizeRoadCourse(value: unknown): DrivingplusRoadCourse {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    title: str(row.title) || null,
    subtitle: str(row.subtitle) || null,
    content: str(row.content) || null,
    imageUrl: str(row.imageUrl) || null,
    youtubeVideoId: str(row.youtubeVideoId) || null,
    difficulty: str(row.difficulty) || null,
  };
}

function bool(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  return null;
}

function normalizeReview(value: unknown): DrivingplusReview | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const content = cleanText(row.content);
  const point = num(row.point);
  if (!isPositiveReviewText(content, point)) return null;
  return {
    id: num(row.id),
    author: str(row.author),
    point,
    content: content.slice(0, 500),
    date: str(row.date),
    images: Array.isArray(row.images) ? row.images.map(str).filter(Boolean).slice(0, 3) : [],
    numLike: num(row.numLike),
  };
}

function normalizeBlogReview(value: unknown): DrivingplusBlogReview | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const title = cleanText(row.title);
  const content = cleanText(row.content);
  const link = str(row.link);
  if (!title || !link) return null;
  if (!isPositiveReviewText(`${title} ${content}`, null)) return null;
  return {
    title: title.slice(0, 160),
    content: content ? content.slice(0, 500) : null,
    link,
    postdate: str(row.postdate),
    images: Array.isArray(row.images) ? row.images.map(str).filter(Boolean).slice(0, 3) : [],
  };
}

function normalizeSeoRegion(value: unknown): DrivingplusSeoRegion | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const level = Number(row.level);
  const region = str(row.region);
  if (!Number.isFinite(level) || !region) return null;
  return { level, region, latitude: num(row.latitude), longitude: num(row.longitude) };
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();
}

function cleanText(value: unknown): string {
  return str(value)
    .replace(/<[^>]+>/g, "")
    .replace(/#[0-9A-Za-z_가-힣]+/g, " ")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulKoreanReview(text: string): boolean {
  if (!text || text.length < 12) return false;
  const korean = (text.match(/[가-힣]/g) || []).length;
  const digits = (text.match(/\d/g) || []).length;
  if (korean < 6) return false;
  if (digits > korean + 8) return false;
  if (/^(\d|[ㅋㅎㅠㅜ\s.,!?])+$/u.test(text)) return false;
  return true;
}

const NEGATIVE_REVIEW_RE = /불친절|최악|비추|별로|환불|짜증|화남|불만|실망|안\s*좋|안좋|문제\s*있|대기\s*길|너무\s*늦|엉망|후회/u;
const POSITIVE_REVIEW_RE = /친절|합격|좋|추천|감사|만족|편하|꼼꼼|잘\s*가르|빠르|한\s*번에|한번에|쉬웠|도움|최고|강추|자세히|설명|안심|쾌적|체계/u;
const RISKY_REVIEW_CLAIM_RE = /\d+\s*일\s*(?:만|컷|완성)|삼\s*일\s*(?:만|컷|완성)|하루\s*만|당일\s*합격|무조건|보장|\d{2,3}\s*만\s*(?:원|뤈|웜)?|\d{3},\d{3}\s*원/u;

function isPositiveReviewText(text: string, point: number | null): boolean {
  if (!isUsefulKoreanReview(text)) return false;
  if (NEGATIVE_REVIEW_RE.test(text)) return false;
  if (RISKY_REVIEW_CLAIM_RE.test(text)) return false;
  if (point !== null && point !== undefined && point < 4) return false;
  if (point !== null && point !== undefined && point >= 4) return true;
  return POSITIVE_REVIEW_RE.test(text);
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Math.trunc(Number(raw));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]!, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}
