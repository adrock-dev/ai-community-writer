import { describe, expect, it } from "vitest";
import { normalizeBrandName, publicBrandName } from "../src/brand.js";
import { buildPrompt } from "../src/worker.service.js";

// `display_name`(관리자 라벨)과 `brand_name`(공개 브랜드명)의 분리를 잠근다.
// 두 값이 한 컬럼을 공유하던 시절 "○○ 샘플" 라벨이 글 본문까지 흘러가 품질 게이트에 걸렸고,
// 그때 들어간 접미사 정규식이 폴백 경로에 그대로 살아 있어야 한다.

const slot = { template_id: "T01", region: "경기도 평택시", primary_keyword: "평택 운전면허학원", slot_id: "s1" };
const promptFor = (domain: Record<string, unknown>) => buildPrompt(domain, slot, "facts", "comparison", undefined, "", true);

describe("공개 브랜드명 해석", () => {
  it("brand_name 이 있으면 display_name 라벨을 이긴다", () => {
    expect(publicBrandName({ brand_name: "운전면허플러스", display_name: "평택 운영본" })).toBe("운전면허플러스");
  });

  it("brand_name 이 비면 display_name 으로 폴백한다(기존 동작 보존)", () => {
    expect(publicBrandName({ brand_name: null, display_name: "운전면허플러스" })).toBe("운전면허플러스");
    expect(publicBrandName({ brand_name: "   ", display_name: "운전면허플러스" })).toBe("운전면허플러스");
  });

  it("둘 다 없으면 domain, 그마저 없으면 기본값으로 내려간다", () => {
    expect(publicBrandName({ domain: "app.example.com" })).toBe("app.example.com");
    expect(publicBrandName({})).toBe("서비스");
  });

  it("라벨용 접미사는 폴백 경로에서도 잘라낸다 — 공개 글 유출 방지", () => {
    expect(publicBrandName({ display_name: "운전면허플러스 샘플" })).toBe("운전면허플러스");
    expect(publicBrandName({ brand_name: "운전면허플러스 데모" })).toBe("운전면허플러스");
  });

  it("접미사만 남는 이름은 원문을 지킨다(빈 브랜드명을 만들지 않는다)", () => {
    expect(normalizeBrandName("샘플")).toBe("샘플");
  });
});

describe("프롬프트의 브랜드 주입 지점", () => {
  it("brand_name 이 선언·CTA 지침에 반영된다", () => {
    const p = promptFor({ brand_name: "운전면허플러스", display_name: "평택 운영본" });
    expect(p).toContain("브랜드: 운전면허플러스");
    expect(p).toContain("운전면허플러스에서 비교·상담·예약으로 이어지는");
    expect(p).not.toContain("평택 운영본");
  });

  it("역할·톤 문장은 브랜드명을 쓰지 않는다 — 모델이 모르는 대상은 톤 앵커가 못 된다", () => {
    const p = promptFor({ brand_name: "운전면허플러스" });
    expect(p).toContain("너는 한국어 SEO 블로그 에디터다");
    expect(p).not.toContain("운전면허플러스 블로그를 쓰는");
    expect(p).not.toContain("운전면허플러스 블로그처럼");
    expect(p).toContain("사람이 쓴 블로그처럼 자연스럽게 시작한다");
  });
});
