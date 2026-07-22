import { describe, expect, it } from "vitest";
import {
  buildT16AxisPlan, isConflictingAxisPair, normalizeT16ReviewAttribution,
  t16FactsForPrompt, t16PromptContract, T16_INTENTS, T16_MODIFIERS,
} from "../src/t16-axis-comparison.js";
import { TEMPLATE_SPECS, TITLE_RULES, DEFAULT_EXPOSED_BUILTIN_TEMPLATE_IDS } from "../src/constants.js";
import { getArchetype } from "../src/archetypes.js";
import { resolveTitleFromRule } from "../src/worker.service.js";

// T16 은 축(persona/modifier/intent)이 글의 내용을 실제로 바꾸는 첫 글유형이다.
// 축이 라벨로만 전달되던 T01 의 실패를 반복하지 않도록, 축 → 산출물 연결을 잠근다.

const academy = (extra: Record<string, unknown> = {}) => ({
  name: "가나다자동차운전전문학원", address: "경기도 남양주시 어딘가로 1", academy_type: "exam_academy",
  extra: JSON.stringify({ license_types: [{ code: "type1_normal_auto" }] }), ...extra,
});
const withPrice = [academy({ price: "1종 보통 수동 700,000원 (부가세 별도)" }), academy({ price: "2종 보통 자동 680,000원 (부가세 별도)" })];
const noEvidence = [academy({ extra: "{}" }), academy({ extra: "{}" })];

describe("T16 빌트인 등록", () => {
  it("빌트인 글유형으로 등록되고 기본 노출 목록에 들어 있다", () => {
    expect(TEMPLATE_SPECS).toHaveProperty("T16");
    expect(DEFAULT_EXPOSED_BUILTIN_TEMPLATE_IDS).toContain("T16");
  });

  it("축 3개를 모두 켠다 — T01 은 intent 가 꺼져 있어 축 하나가 영구 공백이었다", () => {
    const spec = TEMPLATE_SPECS.T16 as any;
    expect(spec.use_persona).toBe(true);
    expect(spec.with_intent).toBe(true);
    expect(spec.modifier_count).toBeGreaterThan(0);
    expect(spec.axis_values.intent.length).toBeGreaterThan(1);
  });

  it("전용 아키타입 local_axis 를 쓴다", () => {
    expect((TEMPLATE_SPECS.T16 as any).kind).toBe("local_axis");
    expect(getArchetype("local_axis")?.academy_centric).toBe(true);
  });
});

describe("축 계획", () => {
  it("modifier 가 비교표 열과 강조 섹션을, intent 가 필수 질문을 정한다", () => {
    const plan = buildT16AxisPlan({ modifier_1: "비용절약", intent: "학원유형" }, withPrice);
    expect(plan.modifier).toBe("비용절약");
    expect(plan.columns).toEqual(T16_MODIFIERS.비용절약!.columns);
    expect(plan.focus).toBe(T16_MODIFIERS.비용절약!.focus);
    expect(plan.intent).toBe("학원유형");
    expect(plan.question).toBe(T16_INTENTS.학원유형!.question);
  });

  it("근거가 없으면 글을 막지 않고 근거 있는 축으로 강등한다", () => {
    const plan = buildT16AxisPlan({ modifier_1: "셔틀편리", intent: "후기확인" }, noEvidence);
    expect(plan.modifier).not.toBe("셔틀편리");
    expect(plan.intent).not.toBe("후기확인");
    expect(plan.demoted).toContain("셔틀편리");
    expect(plan.demoted).toContain("후기확인");
    expect(plan.subtitle.length).toBeGreaterThan(0);
  });

  it("축 값이 비어도 안전한 기본 계획을 만든다", () => {
    const plan = buildT16AxisPlan({}, withPrice);
    expect(plan.columns.length).toBeGreaterThan(0);
    expect(plan.question.length).toBeGreaterThan(0);
  });

  it("같은 데이터를 가리키는 modifier×intent 조합은 충돌로 판정한다", () => {
    expect(isConflictingAxisPair("비용절약", "비용구성")).toBe(true);
    expect(isConflictingAxisPair("야간반", "일정확인")).toBe(true);
    expect(isConflictingAxisPair("비용절약", "학원유형")).toBe(false);
  });
});

describe("제목", () => {
  it("부제가 축에서 나오고 제목에 합쳐진다", () => {
    const plan = buildT16AxisPlan({ modifier_1: "비용절약", intent: "학원유형" }, withPrice);
    const resolved = resolveTitleFromRule(TITLE_RULES.T16, {
      region: "경기도 남양주시", count: 5, keyword: "경기도 남양주시 운전면허학원", academyName: "가나다", subtitle: plan.subtitle,
    });
    expect(resolved.title).toBe(`경기도 남양주시 운전면허학원 BEST 5! ${plan.subtitle}`);
  });

  it("부제가 없으면 구분 기호까지 지워 제목이 깨지지 않는다", () => {
    const resolved = resolveTitleFromRule(TITLE_RULES.T16, {
      region: "경기도 남양주시", count: 5, keyword: "k", academyName: "가나다",
    });
    expect(resolved.title).toBe("경기도 남양주시 운전면허학원 BEST 5");
  });

  it("후보가 최소치 미만이면 생성하지 않는다", () => {
    const resolved = resolveTitleFromRule(TITLE_RULES.T16, { region: "r", count: 1, keyword: "k", academyName: "a" });
    expect(resolved.skip).toBe(true);
  });
});

describe("facts 가공", () => {
  const facts = [
    "작성 주제 지역: 경기도 남양주시",
    "[1] 가나다학원 / 주소: 경기도 남양주시 1 / SEO 설명: 남양주·전주·군산 일대 수강생을 위한 / SEO 키워드: 전주운전학원, 군산운전학원 / 수강생 리뷰: “친절합니다” / 좌표: 37.1, 127.1 / 수강료: 70만원",
  ].join("\n");

  it("SEO 설명·키워드·좌표를 걷어낸다 — 타 지역 유입과 원천 홍보 문구 차단", () => {
    const out = t16FactsForPrompt(facts);
    expect(out).not.toContain("SEO 설명:");
    expect(out).not.toContain("SEO 키워드:");
    expect(out).not.toContain("좌표:");
    expect(out).not.toContain("군산운전학원");
  });

  it("수강생 리뷰는 유지한다 — intent=후기확인 이 리뷰를 근거로 쓴다", () => {
    const out = t16FactsForPrompt(facts);
    expect(out).toContain("수강생 리뷰:");
    expect(out).toContain("수강료: 70만원");
    expect(out).toContain("작성 주제 지역: 경기도 남양주시");
  });
});

describe("리뷰 출처 정규화", () => {
  // 게이트는 "출처: DrivingPlus 수강생 리뷰" 완전 일치만 내부 유출 검사에서 면제한다.
  // 한 글자만 달라도 글 전체가 하드 실패하므로 생성 뒤 표기를 맞춘다.
  it("표기 변형을 표준형으로 맞춘다", () => {
    for (const variant of ["출처: DrivingPlus 리뷰", "출처:DrivingPlus 수강생 후기", "출처 : DrivingPlus 수강생 리뷰"]) {
      expect(normalizeT16ReviewAttribution(`> “좋아요” — ${variant}`)).toContain("출처: DrivingPlus 수강생 리뷰");
    }
  });

  it("이미 표준형이면 그대로 둔다", () => {
    const line = "> “좋아요” — 출처: DrivingPlus 수강생 리뷰";
    expect(normalizeT16ReviewAttribution(line)).toBe(line);
  });
});

describe("프롬프트 계약문", () => {
  it("축이 정한 열·주제·질문과 거리 표현 금지를 명시한다", () => {
    const plan = buildT16AxisPlan({ modifier_1: "비용절약", intent: "학원유형", persona: "야간반을 찾는 직장인" }, withPrice);
    const contract = t16PromptContract(plan, { persona: "야간반을 찾는 직장인" });
    expect(contract).toContain("수강료");
    expect(contract).toContain(plan.question);
    expect(contract).toContain("야간반을 찾는 직장인");
    expect(contract).toContain("거리 수치");
    expect(contract).toContain("대중교통");
  });
});
