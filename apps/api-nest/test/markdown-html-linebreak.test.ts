import { describe, expect, it } from "vitest";
import { normalizeGeneratedMarkdown } from "../src/worker.service.js";

// 렌더러가 HTML 을 이스케이프하므로 `<br>` 은 화면에 글자 그대로 찍힌다.
// 실측(2026-07-27): 발행 글 6건 중 2건이 표의 수강료 열에서 이 태그를 썼다.
describe("normalizeGeneratedMarkdown — HTML 줄바꿈 태그", () => {
  const render = (markdown: string) => normalizeGeneratedMarkdown(markdown, {});

  it("표 셀 안의 <br> 는 값 구분자 ' · ' 로 바꾼다", () => {
    const out = render([
      "# 제목",
      "",
      "본문 문단입니다. 표 아래 설명을 덧붙입니다.",
      "",
      "| 학원 | 수강료 |",
      "| --- | --- |",
      "| 영동자동차운전전문학원 | 1종 수동 730,000원<br>1종 자동 710,000원<br>2종 자동 680,000원 |",
    ].join("\n"));
    expect(out).toContain("| 1종 수동 730,000원 · 1종 자동 710,000원 · 2종 자동 680,000원 |");
    expect(out).not.toContain("<br");
  });

  it("표 밖의 <br> 와 자기닫힘·대문자 변형도 제거한다", () => {
    const out = render("# 제목\n\n첫 줄<br/>둘째 줄<BR />셋째 줄입니다. 문장을 이어 씁니다.");
    expect(out).not.toMatch(/<br/i);
    expect(out).toContain("첫 줄 둘째 줄 셋째 줄입니다.");
  });

  it("표가 아닌 줄에서는 구분자를 넣지 않는다(문장이 ' · ' 로 끊기면 어색하다)", () => {
    const out = render("# 제목\n\n평일 08:00~20:00<br>주말 08:00~17:00 운영입니다. 상담으로 확인해 보세요.");
    expect(out).not.toContain("·");
  });
});
