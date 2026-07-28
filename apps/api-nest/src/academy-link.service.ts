import { Inject, Injectable, Logger } from "@nestjs/common";
import { AcademyResearchDbService } from "./academy-research-db.service.js";
import { DbService } from "./db.service.js";
import { parseResearchUsage, researchValueUsable } from "./academy-research-usage.js";

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
    linked: number; skipped: number; reviews: number; blog_reviews: number;
    research_applied: number; research_usage: string; warnings: string[];
  } {
    const usage = parseResearchUsage(this.db.getDomain(domain)?.research_usage);
    const bases = this.researchDb.listBase({ limit: 5000 });

    const rows: Array<Record<string, unknown>> = [];
    let reviewCount = 0;
    let blogCount = 0;
    let researchApplied = 0;

    for (const base of bases) {
      const externalId = String(base.external_id ?? "").trim();
      if (!externalId) continue;
      const raw = parseJson(base.raw_json);
      if (!raw || typeof raw !== "object") continue;

      // 후기는 행 단위로 보관돼 있어 원천 응답 형태로 되돌린다(upsert 가 그 형태를 기대한다).
      const stored = this.researchDb.listReviews(externalId);
      const reviews = stored
        .filter((r) => r.platform === "drivingplus_review")
        .map((r) => ({ id: numeric(r.source_key), author: r.author_masked, point: r.rating, content: r.quote_text, date: r.posted_at, images: parseJson(r.images) ?? [] }));
      const blogReviews = stored
        .filter((r) => r.platform === "drivingplus_blog")
        .map((r) => ({ title: r.title, content: r.quote_text, link: r.source_url, postdate: r.posted_at, images: parseJson(r.images) ?? [] }));
      reviewCount += reviews.length;
      blogCount += blogReviews.length;

      const research = this.researchValuesFor(externalId, usage);
      if (Object.keys(research).length) researchApplied += 1;

      rows.push({
        ...(raw as Record<string, unknown>),
        reviews,
        // 블로그리뷰 수집이 꺼져 있으면 빈 배열이 오는데, undefined 로 넘겨야 upsert 가 기존 값을 보존한다.
        blogReviews: blogReviews.length ? blogReviews : undefined,
        // 조사값은 원천 필드와 섞지 않고 별도 키로 넣는다. 화면·글에서 출처를 구분할 수 있어야 한다.
        __research: Object.keys(research).length ? research : undefined,
      });
    }

    const result = this.db.upsertDrivingplusAcademies(domain, rows, { blogReviewsAttempted: blogCount > 0, applyResearch: true });
    return {
      linked: result.upserted,
      skipped: result.skipped,
      reviews: result.review_count,
      blog_reviews: result.blog_review_count,
      research_applied: researchApplied,
      research_usage: usage,
      warnings: result.warnings,
    };
  }

  /**
   * 이 학원의 조사값 중 **글에 쓸 수 있는 것만** 추린다.
   *
   * 관문은 도메인 설정(research_usage) × 필드 검증상태다 — off 면 아무것도 넘기지 않고,
   * verified 면 사람이 승인한 값만, draft 면 AI 초안까지. 검토 필요·웹조사 차단·미확인은
   * 어느 설정에서도 빠진다. 연결이 관문을 우회하는 뒷문이 되면 안 된다.
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
