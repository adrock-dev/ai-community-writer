import { describe, expect, it } from "vitest";
import { getArchetype, structureGuideForArchetype } from "../src/archetypes.js";

// 구조 변형(섹션 순서) 시드 회전 — 결정론·다양성·하위호환.
const local = getArchetype("local");

describe("local 아키타입 structure_variants", () => {
  it("변형 3종을 갖는다", () => {
    expect(local?.writing_guide.structure_variants).toHaveLength(3);
  });

  it("모든 변형이 비교표를 포함한다(비교표 누락 게이트 방지)", () => {
    for (const v of local!.writing_guide.structure_variants!) {
      expect(v.join(" ")).toMatch(/비교표|요약표/);
    }
  });
});

describe("structureGuideForArchetype 시드 선택", () => {
  it("같은 시드는 항상 같은 구조(재현성)", () => {
    const a = structureGuideForArchetype(local, "slot-123");
    const b = structureGuideForArchetype(local, "slot-123");
    expect(a).toBe(b);
  });

  it("여러 시드에서 2개 이상 변형이 등장(다양성)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) seen.add(structureGuideForArchetype(local, `slot-${i}`));
    expect(seen.size).toBeGreaterThan(1);
  });

  it("시드 없으면 기본 structure(=변형 A)로 폴백(하위호환)", () => {
    const noSeed = structureGuideForArchetype(local);
    const variantA = local!.writing_guide.structure!.map((l) => `- ${l}`).join("\n");
    expect(noSeed).toBe(variantA);
  });

  it("structure_variants 없는 아키타입은 자기 structure 를 그대로 쓴다", () => {
    const compare = getArchetype("compare");
    expect(compare?.writing_guide.structure_variants).toBeUndefined();
    // 시드를 줘도 변형이 없으니 항상 동일
    expect(structureGuideForArchetype(compare, "x")).toBe(structureGuideForArchetype(compare, "y"));
  });
});
