import { describe, expect, it } from "vitest";
import { QualityGateError } from "../src/worker.service.js";
import { blockingClass, classifyIssues } from "../src/quality-gate-severity.js";

describe("QualityGateError(게이트 실패 → 격리 캡처)", () => {
  it("기존 실패 메시지 포맷을 그대로 유지한다(slots.last_error 회귀 방지)", () => {
    const article = new QualityGateError("article", ["too_short_100", "thin_sections"], {});
    expect(article.message).toBe("generated article quality gate failed: too_short_100, thin_sections");
    const surface = new QualityGateError("final_surface", ["exposes_internal_fact_language"], {});
    expect(surface.message).toBe("generated article final surface gate failed: exposes_internal_fact_language");
  });

  it("Error 를 상속해 기존 catch 흐름을 깨지 않는다", () => {
    const err = new QualityGateError("article", ["too_short_100"], {});
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("QualityGateError");
  });

  it("격리 저장에 필요한 초안 payload 와 단계·이슈를 실어 나른다", () => {
    const draft = { domain: "d1", title: "제목", body_markdown: "# 제목", facts_text: "학원 A" };
    const err = new QualityGateError("final_surface", ["too_short_100"], draft);
    expect(err.stage).toBe("final_surface");
    expect(err.issues).toEqual(["too_short_100"]);
    expect(err.draft).toBe(draft);
  });

  it("실린 이슈로 저장용 분류·차단등급을 계산할 수 있다", () => {
    const softOnly = new QualityGateError("article", ["too_short_100", "thin_sections"], {});
    expect(blockingClass(softOnly.issues)).toBe("A");
    const withSafety = new QualityGateError("article", ["too_short_100", "unverified_specific_price_claim"], {});
    expect(blockingClass(withSafety.issues)).toBe("B");
    expect(classifyIssues(withSafety.issues)).toEqual([
      { code: "too_short_100", class: "A" },
      { code: "unverified_specific_price_claim", class: "B" },
    ]);
  });
});
