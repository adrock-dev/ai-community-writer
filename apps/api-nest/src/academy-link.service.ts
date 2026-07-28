import { Inject, Injectable, Logger } from "@nestjs/common";
import { AcademyResearchDbService } from "./academy-research-db.service.js";
import { DbService } from "./db.service.js";
import { parseResearchUsage, researchValueUsable } from "./academy-research-usage.js";
import { usableInArticle } from "./academy-research-article-fields.js";

/**
 * 조사 DB(운전학원 자료) → admin.db(도메인 원천 데이터) 연결.
 *
 * 지금까지 같은 원천 API 를 두 경로가 각각 쳤다 — 도메인 동기화가 academies 를,
 * 조사 동기화가 academy_base 를 채웠다. 학원 목록(4MB)과 후기를 두 번 받는 셈이다.
 *
 * 수집은 조사 DB 한 곳으로 모으고, 도메인은 **이미 받아 둔 자료를 연결**만 한다.
 * academy_base.raw_json 이 원천 응답 원본이라 API 를 다시 칠 이유가 없고,
 * upsertDrivingplusAcademies 가 하던 매핑(수강료·셔틀·운영시간 포맷팅)을 그대로 재사용한다.
 *
 * 그래서 academies 를 **읽는 8곳은 하나도 바뀌지 않는다.** 같은 테이블에 같은 형태로 들어간다.
 *
 * 이 서비스만 두 DB 를 함께 안다. AcademyResearchService 는 admin.db 를 계속 모른다
 * (분리 원칙 유지 — 조사는 도메인을 몰라야 한다).
 */
@Injectable()
export class AcademyLinkService {
  private readonly logger = new Logger(AcademyLinkService.name);

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AcademyResearchDbService) private readonly researchDb: AcademyResearchDbService,
  ) {}

  linkToDomain(domain: string): {
    linked: number; skipped: number; removed: number; excluded: number; reviews: number; blog_reviews: number;
    research_applied: number; research_usage: string; warnings: string[];
  } {
    const usage = parseResearchUsage(this.db.getDomain(domain)?.research_usage);
    const bases = this.researchDb.listBase({ limit: 5000 });
    // 이 도메인에서 빼기로 한 학원. 연결은 조사 DB 전량을 밀어넣으므로, 여기서 걸러내지 않으면
    // 운영자가 뺀 학원이 연결을 누를 때마다 되살아난다.
    const excluded = this.db.excludedAcademyIds(domain);
    let excludedCount = 0;

    const rows: Array<Record<string, unknown>> = [];
    let blogCount = 0;
    let researchApplied = 0;

    for (const base of bases) {
      const externalId = String(base.external_id ?? "").trim();
      if (!externalId) continue;
      if (excluded.has(externalId)) { excludedCount += 1; continue; }
      const built = this.buildRow(base, usage);
      if (!built) continue;
      blogCount += built.blogReviewCount;
      if (built.hasResearch) researchApplied += 1;
      rows.push(built.row);
    }

    const result = this.db.upsertDrivingplusAcademies(domain, rows, { blogReviewsAttempted: blogCount > 0, applyResearch: true });
    const removed = this.removeStale(domain, rows, result.warnings);
    return {
      linked: result.upserted,
      skipped: result.skipped,
      removed,
      excluded: excludedCount,
      reviews: result.review_count,
      blog_reviews: result.blog_review_count,
      research_applied: researchApplied,
      research_usage: usage,
      warnings: result.warnings,
    };
  }

  /**
   * 학원 1곳만 연결한다.
   *
   * 제외를 해제할 때 쓴다. 해제가 제외 목록에서 빼기만 하면 학원은 돌아오지 않고, 운영자가
   * 「학원자료 연결」을 따로 눌러야 한다 — 실제로 해제해 놓고 안 돌아온다고 본 사례가 있었다.
   * 전량 연결은 380곳을 다시 쓰는 일이라 1곳 때문에 부르기엔 과하다.
   */
  linkOneToDomain(domain: string, externalId: string): { linked: boolean; reason?: string } {
    const base = this.researchDb.getBase(externalId);
    if (!base) return { linked: false, reason: "학원 자료를 찾지 못했습니다." };
    if (this.db.excludedAcademyIds(domain).has(externalId)) return { linked: false, reason: "아직 제외 목록에 있습니다." };
    const built = this.buildRow(base, parseResearchUsage(this.db.getDomain(domain)?.research_usage));
    if (!built) return { linked: false, reason: "원천 자료가 비어 있어 연결할 수 없습니다." };
    const result = this.db.upsertDrivingplusAcademies(domain, [built.row], {
      blogReviewsAttempted: built.blogReviewCount > 0,
      applyResearch: true,
    });
    return result.upserted > 0 ? { linked: true } : { linked: false, reason: result.warnings[0] ?? "연결하지 못했습니다." };
  }

  /**
   * 원천 목록에서 내려간 학원을 이 도메인에서 지운다.
   *
   * upsert 는 더하기만 한다 — 이번 연결에 없는 학원은 admin.db 에 영원히 남아 폐업한 학원이
   * 계속 글 후보로 쓰인다. 그래서 연결이 곧 "원천 목록과 맞추기"가 되도록 여기서 정리한다.
   *
   * 다만 **한 번에 대량으로 사라지면 지우지 않고 경고만 남긴다.** 원천이 일시적으로 부실한
   * 목록을 내려주는 날 학원이 통째로 증발하는 사고를 막기 위함이다(블로그리뷰에서 같은 유형의
   * 사고를 겪었다 — 원천 장애를 정상 응답으로 오인해 후기를 전멸시킬 뻔했다).
   * 진짜로 많이 줄어든 것이라면 운영자가 확인하고 「제외」로 하나씩 판단하면 된다.
   */
  private removeStale(domain: string, rows: Array<Record<string, unknown>>, warnings: string[]): number {
    const keep = new Set(rows.map((r) => String(r.id ?? "").trim()).filter(Boolean));
    // external_id 가 없는 행은 원천과 대조할 열쇠가 없다. 판단할 수 없는 것은 건드리지 않는다.
    const stale = this.db.academyExternalIds(domain).filter((id) => !keep.has(id));
    if (!stale.length) return 0;

    const total = keep.size + stale.length;
    const limit = Math.max(5, Math.floor(total * 0.1));
    if (stale.length > limit) {
      warnings.unshift(
        `원천 목록에서 ${stale.length}곳이 빠졌습니다(전체 ${total}곳 중). 한 번에 사라진 수가 많아 자동 삭제하지 않았습니다 — 원천 자료가 정상인지 확인한 뒤 「제외」로 정리하세요.`,
      );
      this.logger.warn(`${domain}: 원천 이탈 ${stale.length}/${total}곳 — 안전장치로 삭제 보류`);
      return 0;
    }
    const removed = this.db.deleteAcademiesByExternalIds(domain, stale);
    if (removed > 0) warnings.push(`원천 목록에서 내려간 학원 ${removed}곳을 이 도메인에서 정리했습니다.`);
    return removed;
  }

  /** 조사 DB 한 행을 원천 응답 형태로 되돌린다(upsert 가 그 형태를 기대한다). */
  private buildRow(base: Record<string, any>, usage: string): { row: Record<string, unknown>; blogReviewCount: number; hasResearch: boolean } | null {
    const externalId = String(base.external_id ?? "").trim();
    const raw = parseJson(base.raw_json);
    if (!externalId || !raw || typeof raw !== "object") return null;

    // 후기는 행 단위로 보관돼 있어 원천 응답 형태로 되돌린다.
    const stored = this.researchDb.listReviews(externalId);
    const reviews = stored
      .filter((r) => r.platform === "drivingplus_review")
      .map((r) => ({ id: numeric(r.source_key), author: r.author_masked, point: r.rating, content: r.quote_text, date: r.posted_at, images: parseJson(r.images) ?? [] }));
    const blogReviews = stored
      .filter((r) => r.platform === "drivingplus_blog")
      .map((r) => ({ title: r.title, content: r.quote_text, link: r.source_url, postdate: r.posted_at, images: parseJson(r.images) ?? [] }));

    const research = this.researchValuesFor(externalId, usage);
    return {
      blogReviewCount: blogReviews.length,
      hasResearch: Object.keys(research).length > 0,
      row: {
        ...(raw as Record<string, unknown>),
        reviews,
        // 블로그리뷰 수집이 꺼져 있으면 빈 배열이 오는데, undefined 로 넘겨야 upsert 가 기존 값을 보존한다.
        blogReviews: blogReviews.length ? blogReviews : undefined,
        // 조사값은 원천 필드와 섞지 않고 별도 키로 넣는다. 화면·글에서 출처를 구분할 수 있어야 한다.
        __research: Object.keys(research).length ? research : undefined,
      },
    };
  }

  /**
   * 이 학원의 조사값 중 **글에 쓸 수 있는 것만** 추린다.
   *
   * 관문은 **두 겹**이다.
   *
   * 1) 필드 자체가 글에 실릴 수 있는가(usableInArticle) — 허용 목록이다. 합격률처럼 절대 안 되는
   *    항목과 원천 교차검증용 항목이 여기서 걸린다. 검증상태와 무관하게 나가지 않는다.
   * 2) 값을 믿을 수 있는가 — 도메인 설정(research_usage) × 필드 검증상태. off 면 아무것도,
   *    verified 면 사람이 승인한 값만, draft 면 AI 초안까지. 검토 필요·미확인은
   *    어느 설정에서도 빠진다.
   *
   * 1번을 프롬프트 지시로 대신하지 않는 이유: 강제력이 없다는 것을 블로그리뷰에서 확인했다.
   * 연결이 관문을 우회하는 뒷문이 되면 안 된다.
   */
  private researchValuesFor(externalId: string, usage: string): Record<string, string> {
    if (usage === "off") return {};
    const row = this.researchDb.getResearch(externalId);
    if (!row) return {};
    const status = new Map<string, string>(
      this.researchDb.listFieldMeta(externalId).map((m) => [String(m.field_key), String(m.status ?? "")]),
    );
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      if (value == null || String(value).trim() === "") continue;
      if (!usableInArticle(key)) continue;
      if (!researchValueUsable(usage as never, status.get(key))) continue;
      out[key] = String(value);
    }
    return out;
  }
}

function parseJson(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return null; }
}

function numeric(value: unknown): number | null {
  const n = Number(String(value ?? "").replace(/\D/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}
