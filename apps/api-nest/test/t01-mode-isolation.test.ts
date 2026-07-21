import { describe, expect, it } from "vitest";
import { getArchetype } from "../src/archetypes.js";
import { shouldUseT01LegacyPlusMode, T01_LEGACY_PLUS_MODE } from "../src/t01-legacy-plus.js";
import { buildPrompt } from "../src/worker.service.js";

describe("T01 generation mode isolation", () => {
  it("Legacy Plus는 T01에서만 명시적으로 선택되고 기존 legacy를 바꾸지 않는다", () => {
    expect(shouldUseT01LegacyPlusMode("T01", T01_LEGACY_PLUS_MODE)).toBe(true);
    expect(shouldUseT01LegacyPlusMode("T01", "legacy")).toBe(false);
    expect(shouldUseT01LegacyPlusMode("T14", T01_LEGACY_PLUS_MODE)).toBe(false);
  });

  it("비T01 legacy prompt는 v2 structured contract를 받지 않고 기존 modifier 문자열을 유지한다", () => {
    const prompt = buildPrompt({ display_name: "테스트" }, {
      template_id: "T14", slot_id: "T14_test", region: "테스트시", primary_keyword: "테스트시 학원", modifier_1: "가까운", modifier_2: "상담전확인",
    }, "facts", "editorial", getArchetype("local_single"), "", true);
    expect(prompt).toContain("수식어: 가까운, 상담전확인");
    expect(prompt).not.toContain("T01 데이터 기반 비교 계약");
  });
});
