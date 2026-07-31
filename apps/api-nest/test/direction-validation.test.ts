import { describe, expect, it } from "vitest";
import { buildDirectionValidatePrompt, directionValidationWithWarnings, parseDirectionValidation } from "../src/admin.controller.js";
import { effectiveWritingGuide, commonToneGuide } from "../src/worker.service.js";
import { getArchetype, writingGuideForArchetype } from "../src/archetypes.js";
import { t16WritingGuide, t16ToneFromDirection } from "../src/t16-axis-comparison.js";
import { DRIVING_ABSOLUTE_PRINCIPLES, TEMPLATE_SPECS } from "../src/constants.js";

// 「방향성 검증」이 사용자가 쓴 방향성보다 나쁜 안을 제안하던 원인 네 가지를 잠근다.
//
// 방향성은 그대로 생성 프롬프트에 들어가고, T16 계열에서는 **문자열 자체가 문체 스위치**다.
// 그래서 검증이 (a) 실제와 다른 지침과 대조하거나 (b) 요약을 시키거나 (c) 톤 어휘를 건드리거나
// (d) "바꿀 것 없음"을 못 내면, 그 결과가 곧 글 품질 하락으로 이어진다.

describe("검증이 대조하는 지침 = 생성이 주입하는 지침", () => {
  const t16Direction = String((TEMPLATE_SPECS as Record<string, any>).T16.default_direction);

  it("T16 계열은 아키타입 writing_guide 가 아니라 T16 전용 지침을 받는다", () => {
    const archetype = getArchetype("local_axis");
    const guide = effectiveWritingGuide({ archetype, direction: t16Direction, isRegionPrimary: true, isT16: true });
    expect(guide).toBe(t16WritingGuide({}, "conversational"));
    // 아키타입 지침과 같아지면 검증이 다시 엉뚱한 것과 대조하게 된다.
    expect(guide).not.toBe(writingGuideForArchetype(archetype, true));
  });

  it("T16 지침은 방향성이 정한 톤을 따라 갈린다 — 검증도 검증 대상 방향성으로 만들어야 한다", () => {
    const archetype = getArchetype("local_axis");
    const expert = effectiveWritingGuide({ archetype, direction: "차분한 전문가 설명 톤으로 쓴다.", isRegionPrimary: true, isT16: true });
    expect(expert).toBe(t16WritingGuide({}, "expert"));
    expect(expert).not.toBe(effectiveWritingGuide({ archetype, direction: t16Direction, isRegionPrimary: true, isT16: true }));
  });

  it("지역형 아키타입은 region_overlay 까지 포함한다(예전 검증은 이걸 빠뜨렸다)", () => {
    const archetype = getArchetype("local_single");
    const withOverlay = effectiveWritingGuide({ archetype, direction: "", isRegionPrimary: true, isT16: false });
    const withoutOverlay = effectiveWritingGuide({ archetype, direction: "", isRegionPrimary: false, isT16: false });
    expect(withOverlay).toBe(writingGuideForArchetype(archetype, true));
    expect(withOverlay.length).toBeGreaterThan(withoutOverlay.length);
  });
});

describe("검증 프롬프트", () => {
  const prompt = () => buildDirectionValidatePrompt({
    name: "지역 운전학원 축 기반 소개", kind: "local_axis",
    direction: "옆자리 선배가 이야기해 주듯 친근한 대화체로 쓴다.",
    commonPrinciples: "쉬운 표현을 쓴다.",
    writingGuide: t16WritingGuide({}, "conversational"),
    toneGuide: commonToneGuide(),
    absolutePrinciples: DRIVING_ABSOLUTE_PRINCIPLES,
  });

  it("요약을 시키지 않는다 — 길이 제한 지시가 없어야 한다", () => {
    expect(prompt()).not.toMatch(/1~3문장|한\s*두\s*문장으로\s*줄여|간결하게\s*요약/);
  });

  it("남기는 문장은 원문 그대로 쓰게 하고, 바꿀 것 없으면 no_change 를 낼 수 있게 한다", () => {
    const p = prompt();
    expect(p).toContain("원문 그대로");
    expect(p).toContain("no_change");
  });

  it("문체 규칙(commonToneGuide)까지 대조 대상으로 넣는다", () => {
    // 이 블록이 빠져 있어 종결어미·이모지 규칙의 진짜 중복을 놓쳤다.
    expect(prompt()).toContain("모든 글에 들어가는 문체 규칙");
  });

  it("톤 지시를 중복으로 판정하지 말라고 못박는다", () => {
    expect(prompt()).toMatch(/중복으로 판정하지 마라/);
  });
});

describe("응답 파싱", () => {
  it("no_change 면 제안 없이도 성공으로 받는다", () => {
    const parsed = parseDirectionValidation('{"redundant":[],"conflicting":[],"no_change":true,"suggested_direction":"","summary":"덜어낼 중복이 없습니다."}');
    expect(parsed?.no_change).toBe(true);
    expect(parsed?.suggested_direction).toBe("");
  });

  it("지적도 제안도 없으면 no_change 로 본다", () => {
    expect(parseDirectionValidation('{"redundant":[],"conflicting":[],"suggested_direction":""}')?.no_change).toBe(true);
  });

  it("중복을 지적했는데 제안이 비면 해석 실패로 본다(모델이 답을 덜 낸 것이다)", () => {
    expect(parseDirectionValidation('{"redundant":[{"text":"날조 금지","overlaps":"절대원칙"}],"suggested_direction":""}')).toBeNull();
  });

  it("JSON 이 아니면 null", () => {
    expect(parseDirectionValidation("죄송합니다, 판단할 수 없습니다.")).toBeNull();
  });
});

describe("적용하면 무엇이 달라지는지 서버가 계산한다", () => {
  const base = { redundant: [], conflicting: [], summary: "", no_change: false };
  const t16Direction = String((TEMPLATE_SPECS as Record<string, any>).T16.default_direction);

  it("T16 제안이 톤 어휘를 들이면 문체 뒤집힘을 경고한다", () => {
    const suggested = "각 학원을 축이 지목한 관점으로 차분하게 해석해 독자의 선택 판단을 돕는다.";
    expect(t16ToneFromDirection(t16Direction)).toBe("conversational");
    const out = directionValidationWithWarnings({ ...base, suggested_direction: suggested }, t16Direction, true);
    expect(out.tone_shift).toEqual({ from: "conversational", to: "expert" });
  });

  it("전문가판에서 톤 문장이 빠져도 경고한다", () => {
    const direction = "필기·기능 단계별 핵심을 정리한다. 문체는 신뢰감 있는 전문가 설명 톤으로 차분하게 쓴다.";
    const out = directionValidationWithWarnings({ ...base, suggested_direction: "필기·기능 단계별 핵심을 정리한다." }, direction, true);
    expect(out.tone_shift).toEqual({ from: "expert", to: "conversational" });
  });

  it("T16 계열이 아니면 이 스위치가 없으므로 계산하지 않는다", () => {
    const out = directionValidationWithWarnings({ ...base, suggested_direction: "차분하게 정리한다." }, "친근하게 쓴다.", false);
    expect(out.tone_shift).toBeNull();
  });

  it("톤이 그대로면 경고하지 않고, 길이 변화는 항상 싣는다", () => {
    const out = directionValidationWithWarnings({ ...base, suggested_direction: "친근한 대화체로 쓴다." }, t16Direction, true);
    expect(out.tone_shift).toBeNull();
    expect(out.length_before).toBe(t16Direction.length);
    expect(out.length_after).toBeLessThan(out.length_before);
  });

  it("no_change 면 제안이 없으니 톤 경고도 없다", () => {
    const out = directionValidationWithWarnings({ ...base, no_change: true, suggested_direction: "" }, t16Direction, true);
    expect(out.tone_shift).toBeNull();
    expect(out.length_after).toBe(0);
  });
});
