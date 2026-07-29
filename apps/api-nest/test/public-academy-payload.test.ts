import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 공개 학원 API(`GET /api/v1/:domain/academies`)의 노출 범위를 잠근다.
 *
 * 이 엔드포인트는 academies 행을 통째로 반환하고 있었다. 그래서 원천 동기화 endpoint(source_url),
 * 원천 내부 ID(external_id), 가격 수집 출처 URL 이 들어 있는 extra 가 그대로 외부로 나갔다.
 * "공개물에 내부 API·원천 시스템 흔적을 남기지 않는다"는 원칙과 정면으로 어긋나므로
 * 화이트리스트를 두고, 새 컬럼이 추가돼도 자동으로 새어 나가지 않도록 여기서 고정한다.
 */

const REQ_QUERY = {} as any;
const domain = "public-academy.test";

let db: import("../src/db.service.js").DbService;
let ctl: import("../src/public.controller.js").PublicController;
let tmp: string;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "public-academy-"));
  process.env.SEO_DB_PATH = join(tmp, "admin.db");
  const { DbService } = await import("../src/db.service.js");
  const { PublicController } = await import("../src/public.controller.js");
  db = new DbService();
  db.init();
  ctl = new PublicController(db);
  db.createDomain({ domain, display_name: "public academy", vertical: "driving" });
  db.upsertDrivingplusAcademies(domain, [{
    id: 7001,
    title: "공개테스트자동차운전전문학원",
    roadAddress: "경기도 수원시 영통구 테스트로 1",
    seoContent: "원천이 작성한 홍보 성격의 학원 소개 문구",
    phone: "031-000-0000",
    photos: ["https://example.test/1.jpg"],
    reviews: [{ id: 1, point: 5, author: "익명닉네임", date: "2026-01-02", content: "강사님이 친절하게 설명해 주셔서 편하게 배웠습니다." }],
    blogReviews: [{ title: "후기 글", content: "친절했습니다", link: "https://blog.example.test/1", postdate: "20260102", images: [] }],
    priceObservations: [{ source: "external_place", sourceUrl: "https://places.example.test/place/1/price", amount: 627000 }],
  }] as never);
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("공개 학원 응답 화이트리스트", () => {
  function item() {
    const res = ctl.academies(domain, REQ_QUERY) as { count: number; items: Array<Record<string, unknown>> };
    expect(res.count).toBe(1);
    return res.items[0]!;
  }

  it("원천 시스템 흔적을 노출하지 않는다", () => {
    const row = item();
    for (const key of ["source_url", "source_name", "external_id", "extra", "domain"]) {
      expect(row, `${key} 가 공개 응답에 남아 있다`).not.toHaveProperty(key);
    }
    // 직렬화 전체에도 동기화 endpoint 문자열이 남으면 안 된다.
    expect(JSON.stringify(row)).not.toContain("get-all-academy");
    expect(JSON.stringify(row)).not.toContain("places.example.test");
  });

  it("리뷰 원문 페이로드와 원천 마케팅 문구를 노출하지 않는다", () => {
    const row = item();
    for (const key of ["review_json", "blog_reviews", "seo_content"]) {
      expect(row, `${key} 가 공개 응답에 남아 있다`).not.toHaveProperty(key);
    }
    expect(JSON.stringify(row)).not.toContain("익명닉네임");
    expect(JSON.stringify(row)).not.toContain("blog.example.test");
  });

  it("소비 사이트가 쓰는 표시용 필드는 그대로 유지한다", () => {
    const row = item();
    expect(row.name).toBe("공개테스트자동차운전전문학원");
    expect(row.address).toBe("경기도 수원시 영통구 테스트로 1");
    expect(row.phone).toBe("031-000-0000");
    expect(row.photos).toEqual(["https://example.test/1.jpg"]);
    expect(row).toHaveProperty("region");
    expect(row).toHaveProperty("academy_type");
  });
});
