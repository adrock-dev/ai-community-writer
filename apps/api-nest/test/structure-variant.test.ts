import { describe, expect, it } from "vitest";
import { getArchetype, structureGuideForArchetype } from "../src/archetypes.js";

// 구조 변형(섹션 순서) 시드 회전 — 결정론·다양성·하위호환. 학원형 3종(local/local_single/local_hub)에 변형 보유.
const WITH_VARIANTS = ["local", "local_single", "local_hub"];

describe.each(WITH_VARIANTS)("%s 아키타입 structure_variants", (kind) => {
  const arch = getArchetype(kind);

  it("변형 3종을 갖는다", () => {
    expect(arch?.writing_guide.structure_variants).toHaveLength(3);
  });

  it("변형 A(첫 변형) == 기본 structure (비시드/하위호환)", () => {
    expect(arch!.writing_guide.structure_variants![0]).toEqual(arch!.writing_guide.structure);
  });

  it("모든 변형이 표(비교표/요약표/표)를 포함한다(표 게이트 방지)", () => {
    for (const v of arch!.writing_guide.structure_variants!) {
      expect(v.join(" ")).toMatch(/비교표|요약표|표로|표/);
    }
  });

  it("같은 시드는 항상 같은 구조(재현성)", () => {
    expect(structureGuideForArchetype(arch, "slot-abc")).toBe(structureGuideForArchetype(arch, "slot-abc"));
  });

  it("여러 시드에서 2개 이상 변형이 등장(다양성)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) seen.add(structureGuideForArchetype(arch, `slot-${i}`));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("하위호환·비변형 아키타입", () => {
  it("시드 없으면 기본 structure 로 폴백", () => {
    const local = getArchetype("local");
    const base = local!.writing_guide.structure!.map((l) => `- ${l}`).join("\n");
    expect(structureGuideForArchetype(local)).toBe(base);
  });

  it("structure_variants 없는 아키타입(compare)은 시드 무관 동일", () => {
    const compare = getArchetype("compare");
    expect(compare?.writing_guide.structure_variants).toBeUndefined();
    expect(structureGuideForArchetype(compare, "x")).toBe(structureGuideForArchetype(compare, "y"));
  });
});
