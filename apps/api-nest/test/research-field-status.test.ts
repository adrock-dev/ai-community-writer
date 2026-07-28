import { describe, expect, it } from "vitest";
import { nextFieldStatus } from "../src/academy-research.service.js";

// 재조사가 사람의 승인을 무조건 풀던 문제. 검토 대기 100건을 승인해 두고 전체 조사를 돌리면
// 그 노동이 전부 날아갔다. 승인은 "그 값" 에 대한 것이므로 값이 그대로일 때만 유지한다.

describe("nextFieldStatus — 재조사 뒤 검증상태", () => {
  it("승인된 값이 그대로면 승인을 유지한다", () => {
    expect(nextFieldStatus({ wasVerified: true, unchanged: true, hasFinding: false })).toBe("verified");
  });

  it("승인된 값이 그대로면 그라운딩에 걸려도 승인을 유지한다", () => {
    // 사람이 그 문자열을 보고 판단한 결과가 자동 검사보다 우선이다.
    // 자동 검사가 사람의 승인을 되돌리면, 수집 소스가 바뀔 때마다 검토가 원점으로 간다.
    expect(nextFieldStatus({ wasVerified: true, unchanged: true, hasFinding: true })).toBe("verified");
  });

  it("승인된 값이 바뀌었으면 다시 검토 대상으로 내린다", () => {
    // 사람이 확인한 적 없는 값이 verified 로 남으면 관문이 무의미해진다.
    expect(nextFieldStatus({ wasVerified: true, unchanged: false, hasFinding: false })).toBe("ai_draft");
    expect(nextFieldStatus({ wasVerified: true, unchanged: false, hasFinding: true })).toBe("needs_review");
  });

  it("승인된 적 없으면 검사 결과대로 정한다", () => {
    expect(nextFieldStatus({ wasVerified: false, unchanged: true, hasFinding: false })).toBe("ai_draft");
    expect(nextFieldStatus({ wasVerified: false, unchanged: true, hasFinding: true })).toBe("needs_review");
    expect(nextFieldStatus({ wasVerified: false, unchanged: false, hasFinding: false })).toBe("ai_draft");
  });
});
