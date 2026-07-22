import { describe, expect, it } from "vitest";
import { normalizeImageSlotMarkup, renderMarkdown, stripPseudoSlotsForRender } from "../src/post-rendering.js";
import { normalizeGeneratedMarkdown } from "../src/worker.service.js";

describe("image slot rendering", () => {
  const wrappedSlot = "![동해자동차운전전문학원 사진]( [IMAGE:academy_1] )";

  it("normalizes a model-wrapped image token without changing ordinary links", () => {
    expect(normalizeImageSlotMarkup(wrappedSlot)).toBe("[IMAGE:academy_1]");
    expect(normalizeImageSlotMarkup("![외부 사진](https://example.test/a.jpg)")).toBe("![외부 사진](https://example.test/a.jpg)");
  });

  it("renders historical wrapped slots as source images rather than broken Markdown", () => {
    const html = renderMarkdown(`${wrappedSlot}\n\n본문`, { academy_1: "image/example.jpg" });
    expect(html).toContain('<img src="image/example.jpg"');
    expect(html).not.toContain("![동해자동차운전전문학원 사진]");
    expect(stripPseudoSlotsForRender(wrappedSlot)).toBe("[IMAGE:academy_1]");
  });

  it("normalizes wrapped slots before newly generated articles reach the quality gate", () => {
    const markdown = normalizeGeneratedMarkdown(`# 제목\n\n${wrappedSlot}\n\n본문`, { academy_1: "image/example.jpg" });
    expect(markdown).toContain("[IMAGE:academy_1]");
    expect(markdown).not.toContain("![동해자동차운전전문학원 사진]");
  });
});
