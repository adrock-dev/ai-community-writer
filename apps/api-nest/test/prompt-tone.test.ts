import { afterEach, describe, expect, it } from "vitest";
import { buildPrompt } from "../src/worker.service.js";

// 전 글유형 공통 문체 지침. 되돌릴 수단(SEO_PROMPT_STYLE=formal)이 살아 있는지 함께 잠근다.
//
// 기존 지침은 금지 목록에 "여러분"을 넣고 있었다. 품질 게이트에서는 반복 금지로 완화했는데
// 프롬프트가 계속 금지해서, 모델이 독자에게 말 거는 표현을 통째로 피했다(표본 4건 질문형 0·2인칭 0).

const slot = { template_id: "T01", region: "경기도 남양주시", primary_keyword: "남양주 운전면허학원", slot_id: "s1" };
const prompt = () => buildPrompt({ display_name: "테스트" }, slot, "facts", "comparison", undefined, "", true);

afterEach(() => { delete process.env.SEO_PROMPT_STYLE; });

describe("공통 문체 지침", () => {
  it("기본은 대화체 — 2인칭 호칭을 허용하고 어떤 문체를 쓸지 지시한다", () => {
    const p = prompt();
    expect(p).toContain("독자에게 말을 거는 블로그 문체");
    expect(p).toContain('독자를 "여러분"으로 부르거나');
    expect(p).toContain("문단마다 반복하지 않는다");
    expect(p).toContain("같은 종결을 세 문장 이상 연속으로 쓰지 않는다");
  });

  it("문체 격식 수준을 글유형 방향성에 위임하고, 대화체는 종결어미를 넓게 허용한다", () => {
    const p = prompt();
    expect(p).toContain("글유형 방향성을 우선한다");
    // 대화체에서 확장된 종결어미(전문가 톤에서는 -습니다 위주로 절제)
    for (const ending of ["-거예요", "-네요", "-답니다"]) {
      expect(p).toContain(ending);
    }
  });

  it("기본에서도 실제 AI 상투구는 계속 금지한다", () => {
    const p = prompt();
    for (const banned of ["이번 글에서는", "살펴보겠습니다", "도움이 되셨기를", "이번 포스팅"]) {
      expect(p).toContain(banned);
    }
    // 이모지: 대화체는 자유, 전문가 톤은 체크리스트 ✅ 외 제한. 어느 톤이든 목록 내 혼용만 막는다.
    expect(p).toContain("전문가 톤에서는 체크리스트 ✅");
    expect(p).toContain("서로 다른 이모지를 섞지 않는다");
  });

  it("대화체 톤에 마케팅 에너지(감탄·응원)를 허용하되 전문가 톤은 차분하게 유지한다(#3)", () => {
    const p = prompt();
    // 대화체 에너지 허용
    expect(p).toContain("느낌표와 가벼운 감탄");
    expect(p).toContain("따뜻하게 응원해도 된다");
    // 안전 경계: 활기는 확인된 사실 위에서만, 과장·합격보장 금지
    expect(p).toContain("확인된 사실 위에서만");
    expect(p).toContain("합격 보장");
    // 전문가 톤은 감탄·응원 없이 차분
    expect(p).toContain("전문가 톤에서는 감탄·응원 없이 차분하게 맺는다");
  });

  it("SEO_PROMPT_STYLE=formal 로 기존 격식체 지침을 되돌릴 수 있다", () => {
    process.env.SEO_PROMPT_STYLE = "formal";
    const p = prompt();
    expect(p).toContain('"~살펴보았습니다", "여러분"');
    expect(p).not.toContain("독자에게 말을 거는 블로그 문체");
  });

  it("알 수 없는 값은 기본(대화체)으로 취급한다", () => {
    process.env.SEO_PROMPT_STYLE = "unknown";
    expect(prompt()).toContain("독자에게 말을 거는 블로그 문체");
  });
});
