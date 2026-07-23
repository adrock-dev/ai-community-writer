import { describe, expect, it } from "vitest";
import {
  buildT16AxisPlan, isConflictingAxisPair, normalizeT16ReviewAttribution,
  t16FactsForPrompt, t16PromptContract, t16ToneFromDirection, t16WritingGuide, T16_INTENTS, T16_MODIFIERS,
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
  it("modifier 가 소개 관점·강조 섹션을, intent 가 필수 질문을 정한다", () => {
    const plan = buildT16AxisPlan({ modifier_1: "비용절약", intent: "학원유형" }, withPrice);
    expect(plan.modifier).toBe("비용절약");
    expect(plan.angle).toBe(T16_MODIFIERS.비용절약!.angle);
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
    expect(plan.angle.length).toBeGreaterThan(0);
    expect(plan.question.length).toBeGreaterThan(0);
  });

  it("요약표 열에 실제 소재지·학원명·운영 과정을 넣지 않는다 — 계약문이 항상 붙여 중복되기 때문", () => {
    for (const modifier of Object.keys(T16_MODIFIERS)) {
      const plan = buildT16AxisPlan({ modifier_1: modifier }, withPrice);
      expect(plan.summaryColumns).not.toContain("실제 소재지");
      expect(plan.summaryColumns).not.toContain("학원명");
      expect(plan.summaryColumns).not.toContain("운영 과정");
    }
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
  // 공개 표준형은 "출처: 운전면허PLUS 실제 수강생 리뷰". 모델이 원천명 DrivingPlus 나 한글/공백 변형을
  // 써도 표준형으로 맞춘다(DrivingPlus 는 그대로 두면 내부 유출 하드 실패이므로 정규화가 흡수한다).
  it("원천명·한글·공백 변형을 모두 표준형으로 맞춘다", () => {
    const variants = [
      "출처: DrivingPlus 리뷰",
      "출처:DrivingPlus 수강생 후기",
      "출처 : 운전면허플러스 수강생 리뷰",
      "출처: 운전면허 PLUS 실제 수강생 후기",
    ];
    for (const variant of variants) {
      expect(normalizeT16ReviewAttribution(`> “좋아요” — ${variant}`)).toContain("출처: 운전면허PLUS 실제 수강생 리뷰");
    }
  });

  it("정규화 뒤에는 원천명 DrivingPlus 가 남지 않는다", () => {
    expect(normalizeT16ReviewAttribution("> “좋아요” — 출처: DrivingPlus 수강생 리뷰")).not.toContain("DrivingPlus");
  });

  it("이미 표준형이면 그대로 둔다", () => {
    const line = "> “좋아요” — 출처: 운전면허PLUS 실제 수강생 리뷰";
    expect(normalizeT16ReviewAttribution(line)).toBe(line);
  });
});

describe("프롬프트 계약문", () => {
  it("소개 중심 프레이밍과 축이 정한 관점·질문, 거리 표현 금지를 명시한다", () => {
    const plan = buildT16AxisPlan({ modifier_1: "비용절약", intent: "학원유형", persona: "야간반을 찾는 직장인" }, withPrice);
    const contract = t16PromptContract(plan, { persona: "야간반을 찾는 직장인" }, 5);
    // '비교'가 아니라 '소개' 중심임을 명시한다.
    expect(contract).toContain("소개·안내하는 것이다");
    expect(contract).toContain("정량 비교하려 애쓰지 말고");
    expect(contract).toContain(plan.angle);
    expect(contract).toContain(plan.question);
    expect(contract).toContain("야간반을 찾는 직장인");
    expect(contract).toContain("거리 수치");
    expect(contract).toContain("대중교통");
  });

  it("후보 4곳 이상이면 요약표를 두라고, 그 이하면 짧은 요약표로 안내한다", () => {
    const plan = buildT16AxisPlan({ modifier_1: "비용절약" }, withPrice);
    const many = t16PromptContract(plan, {}, 5);
    const few = t16PromptContract(plan, {}, 2);
    expect(many).toContain("정보가 많으므로");
    expect(few).toContain("짧은 요약표");
    // 어느 경우도 '우열을 매기는 비교표'가 아님을 명시한다.
    expect(many).toContain("우열을 매기는 비교표가 아니라");
    expect(few).toContain("우열을 매기는 비교표로 만들지 않는다");
  });
});

describe("문체 지침", () => {
  it("스토리텔링·친절 톤 요소와 persona 를 도입 예시에 엮는다", () => {
    const guide = t16WritingGuide({ persona: "야간반을 찾는 직장인" });
    expect(guide).toContain("야간반을 찾는 직장인");
    expect(guide).toContain("궁금");
    expect(guide).toContain("친근한 블로그 에디터");
    expect(guide).toContain("사실만 나열하지 않는다");
  });

  it("persona 가 없어도 안전한 도입 예시를 준다", () => {
    const guide = t16WritingGuide({});
    expect(guide).toContain("무엇부터 봐야 할지");
    expect(guide.length).toBeGreaterThan(100);
  });

  it("가상 경험 날조는 계속 금지한다", () => {
    const guide = t16WritingGuide({ persona: "초보자" });
    expect(guide).toContain("가상의 수강생");
    expect(guide).toContain("직접 다녀온 것처럼");
  });

  it("여러 학원 공통 조건(수강료 단서 등)은 한 번만 밝히도록 지시한다 — 후보마다 반복 = repeated_sentence 격리 원인", () => {
    const guide = t16WritingGuide({ persona: "초보자" });
    expect(guide).toContain("공통 조건");
    expect(guide).toContain("후보마다 되풀이하지 않는다");
  });

  it("톤은 파라미터로 갈리고, 콘텐츠·상세도 지침은 두 톤이 공유한다", () => {
    const conv = t16WritingGuide({ persona: "초보자" }, "conversational");
    const expert = t16WritingGuide({ persona: "초보자" }, "expert");
    // 대화체는 친근 어투, 전문가는 설명 톤 — 어투만 갈린다.
    expect(conv).toContain("친근한 블로그 에디터");
    expect(conv).toContain("고민되는 경우가 많죠");
    expect(expert).toContain("전문가 설명 톤");
    expect(expert).not.toContain("친근한 블로그 에디터");
    expect(expert).not.toContain("고민되는 경우가 많죠");
    // 콘텐츠·상세도·날조 금지는 톤과 무관하게 양쪽에 있다.
    for (const shared of ["최소 3~4문장", "공통 조건", "가상의 수강생"]) {
      expect(conv).toContain(shared);
      expect(expert).toContain(shared);
    }
    // 격식 수준(종결어미·이모지)은 여기서 하드코딩하지 않는다 — commonToneGuide 소관.
    expect(expert).not.toContain("이 글은 대화체다");
  });

  it("t16ToneFromDirection: 방향성 텍스트로 톤을 판정한다(기본 대화체)", () => {
    expect(t16ToneFromDirection("문체는 신뢰감 있는 전문가 설명 톤으로 차분하게 쓴다.")).toBe("expert");
    expect(t16ToneFromDirection("독자에게 말을 거는 친근한 블로그 에디터의 대화체로 쓴다.")).toBe("conversational");
    expect(t16ToneFromDirection("")).toBe("conversational");
  });
});
