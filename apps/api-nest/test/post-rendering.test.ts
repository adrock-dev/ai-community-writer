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

// 발행 글 21건 중 7건에서 체크리스트 마지막 항목이 `<p>- ✅ …</p>` 로 새고 있었다. 원인은 마크다운이
// 아니라 렌더러였다: 빈 줄에서 블록을 끊은 뒤(loose list) 남은 1줄짜리 블록을 리스트로 인정하지 않았다.
describe("loose list rendering", () => {
  it("keeps blank-line separated items in one list", () => {
    const html = renderMarkdown("- 첫째 항목\n- 둘째 항목\n\n- 셋째 항목");
    expect(html).toBe("<ul><li>첫째 항목</li><li>둘째 항목</li><li>셋째 항목</li></ul>");
    expect(html).not.toContain("<p>-");
  });

  it("renders a standalone list item as a list, not a paragraph with a raw marker", () => {
    expect(renderMarkdown("본문 문단\n\n- 유일한 항목")).toContain("<ul><li>유일한 항목</li></ul>");
    expect(renderMarkdown("본문 문단\n\n1. 유일한 항목")).toContain("<ol><li>유일한 항목</li></ol>");
  });

  it("leaves a single ✅ sentence as a paragraph", () => {
    // isListLine 은 ✅ 로 시작하는 줄도 항목으로 보지만, 한 줄뿐이면 일반 문장일 수 있어 문단으로 남긴다.
    expect(renderMarkdown("본문\n\n✅ 확인이 필요합니다")).toContain("<p>✅ 확인이 필요합니다</p>");
  });

  it("does not merge a list with the paragraph that follows a blank line", () => {
    const html = renderMarkdown("- 항목\n\n이어지는 문단입니다");
    expect(html).toBe("<ul><li>항목</li></ul>\n<p>이어지는 문단입니다</p>");
  });

  it("does not merge two paragraphs separated by a blank line", () => {
    expect(renderMarkdown("첫 문단\n\n둘째 문단")).toBe("<p>첫 문단</p>\n<p>둘째 문단</p>");
  });
});
