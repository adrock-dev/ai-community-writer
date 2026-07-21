import { describe, expect, it } from "vitest";
import { getArchetype } from "../src/archetypes.js";
import { shouldUseT01LegacyPlusMode, T01_LEGACY_PLUS_MODE } from "../src/t01-legacy-plus.js";
import { buildPrompt } from "../src/worker.service.js";

describe("T01 generation mode isolation", () => {
  it("Legacy Plus는 T01 계보에서만 선택되고 명시 legacy는 기존 경로를 유지한다", () => {
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

  it("T01 학원 비교글에는 범용 시험 절차 링크와 준비 서류 안내를 주입하지 않는다", () => {
    const t01Prompt = buildPrompt({ display_name: "테스트" }, {
      template_id: "T01", slot_id: "T01_test", region: "테스트시", primary_keyword: "테스트시 운전면허학원",
    }, "facts", "comparison", getArchetype("local"), "", true);
    const guidePrompt = buildPrompt({ display_name: "테스트" }, {
      template_id: "T14", slot_id: "T14_test", region: "테스트시", primary_keyword: "테스트시 학원",
    }, "facts", "editorial", getArchetype("local_single"), "", true);
    const t01ClonePrompt = buildPrompt({ display_name: "테스트" }, {
      template_id: "C123", slot_id: "C123_test", region: "테스트시", primary_keyword: "테스트시 운전면허학원",
    }, "facts", "comparison", getArchetype("local"), "", true, null, { t01Comparison: true });

    expect(t01Prompt).toContain("외부 공식 절차 링크는 다루지 않는다");
    expect(t01Prompt).not.toContain("https://www.safedriving.or.kr");
    expect(t01Prompt).not.toContain("운전면허 시험 접수·응시·발급");
    expect(t01ClonePrompt).toContain("외부 공식 절차 링크는 다루지 않는다");
    expect(t01ClonePrompt).not.toContain("https://www.safedriving.or.kr");
    expect(guidePrompt).toContain("https://www.safedriving.or.kr");
  });
});
