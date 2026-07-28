import { describe, expect, it } from "vitest";
import { DEFAULT_RESEARCH_USAGE, parseResearchUsage, researchValueUsable } from "../src/academy-research-usage.js";

// 조사값은 공개 웹에서 모은 미검증 자료다. "저장한다"와 "글에 쓴다"를 분리하고,
// 승인 도구는 새로 만들지 않고 필드 검증상태를 그대로 관문으로 쓴다.

describe("parseResearchUsage — 알 수 없는 값은 안전한 기본값으로", () => {
  it("정상 값은 그대로 통과", () => {
    expect(parseResearchUsage("off")).toBe("off");
    expect(parseResearchUsage("verified")).toBe("verified");
    expect(parseResearchUsage("draft")).toBe("draft");
  });

  it("빈 값·오타·다른 타입은 '사용 안 함'으로 떨어진다", () => {
    for (const bad of [null, undefined, "", "  ", "on", "true", 1, {}]) {
      expect(parseResearchUsage(bad)).toBe(DEFAULT_RESEARCH_USAGE);
    }
    expect(DEFAULT_RESEARCH_USAGE).toBe("off");
  });
});

describe("researchValueUsable — 설정 × 필드 검증상태", () => {
  it("off 면 무엇도 쓰지 않는다", () => {
    for (const status of ["verified", "ai_draft", "unverified", "needs_review"]) {
      expect(researchValueUsable("off", status)).toBe(false);
    }
  });

  it("verified 는 사람이 검증한 값만 쓴다", () => {
    expect(researchValueUsable("verified", "verified")).toBe(true);
    expect(researchValueUsable("verified", "ai_draft")).toBe(false);
  });

  it("draft 는 AI 초안까지 넓힌다", () => {
    expect(researchValueUsable("draft", "verified")).toBe(true);
    expect(researchValueUsable("draft", "ai_draft")).toBe(true);
  });

  it("검토 필요·미확인은 어느 설정에서도 쓰이지 않는다", () => {
    for (const mode of ["verified", "draft"] as const) {
      expect(researchValueUsable(mode, "needs_review")).toBe(false);
      // 폐지된 상태·알 수 없는 코드도 보수적으로 제외한다(허용 목록 판정).
      expect(researchValueUsable(mode, "web_blocked")).toBe(false);
      expect(researchValueUsable(mode, "unverified")).toBe(false);
    }
  });

  it("알 수 없는 상태는 보수적으로 제외한다", () => {
    // 상태 코드는 코드 테이블이라 나중에 늘 수 있다. 모르는 코드를 통과시키면
    // 새 상태를 추가하는 것만으로 미검증 값이 글에 새어 들어간다.
    expect(researchValueUsable("draft", "some_future_status")).toBe(false);
    expect(researchValueUsable("draft", null)).toBe(false);
  });
});
