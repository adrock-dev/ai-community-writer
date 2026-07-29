import { describe, expect, it } from "vitest";
import { DRIVING_AUTHORITATIVE_SOURCES, DRIVING_AUTHORITATIVE_SOURCES_GUIDE } from "../src/constants.js";

// P5: 공신력 출처 화이트리스트는 공개 글에 나가는 외부 링크다. URL 날조 금지 원칙에 따라
// 검증된 도로교통공단 URL 만 코드 상수로 고정하고, 프롬프트 지침이 이를 정확히 담는지 고정한다.

describe("EEAT 공신력 출처(P5)", () => {
  it("검증된 도로교통공단 2곳만 화이트리스트에 있다", () => {
    const urls = DRIVING_AUTHORITATIVE_SOURCES.map((s) => s.url);
    expect(urls).toEqual(["https://www.safedriving.or.kr", "https://www.koroad.or.kr"]);
  });

  it("모든 출처는 https 이고 or.kr 공식 도메인이다", () => {
    for (const s of DRIVING_AUTHORITATIVE_SOURCES) {
      expect(s.url).toMatch(/^https:\/\/www\.[a-z]+\.or\.kr$/);
      expect(s.name.length).toBeGreaterThan(1);
      expect(s.use.length).toBeGreaterThan(1);
    }
  });

  it("프롬프트 지침에 모든 출처 URL 이 그대로 들어 있다", () => {
    for (const s of DRIVING_AUTHORITATIVE_SOURCES) {
      expect(DRIVING_AUTHORITATIVE_SOURCES_GUIDE).toContain(s.url);
      expect(DRIVING_AUTHORITATIVE_SOURCES_GUIDE).toContain(s.name);
    }
  });

  it("프롬프트 지침이 날조 금지·인라인 원칙을 명시한다", () => {
    expect(DRIVING_AUTHORITATIVE_SOURCES_GUIDE).toMatch(/지어내지 않는다|글자 그대로/);
    expect(DRIVING_AUTHORITATIVE_SOURCES_GUIDE).toMatch(/인라인/);
  });
});
