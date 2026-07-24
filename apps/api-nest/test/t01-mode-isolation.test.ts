import { describe, expect, it } from "vitest";
import { getArchetype } from "../src/archetypes.js";
import { shouldUseT01LegacyPlusMode, T01_LEGACY_PLUS_MODE } from "../src/t01-legacy-plus.js";
import { buildPrompt, disambiguateAcademyNames, readerFacingModifierLabels } from "../src/worker.service.js";

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

  it("T16(local_axis)은 스코프 제한은 유지하되 '비교글' 프레이밍을 '소개·안내글'로 바꾼다", () => {
    const t16Prompt = buildPrompt({ display_name: "테스트" }, {
      template_id: "T16", slot_id: "T16_test", region: "테스트시", primary_keyword: "테스트시 운전면허학원",
      persona: "가성비 좋은 학원을 찾는 수강생", intent: "과정선택", modifier_1: "주말반",
    }, "facts", "comparison", getArchetype("local_axis"), "독자에게 말을 거는 친근한 블로그 대화체", true, null, { t01Comparison: true, readerFlow: true });

    // 스코프 제한(도로교통공단 일반 절차·외부 공식 링크 제외)은 T01 과 동일하게 유지된다.
    expect(t16Prompt).toContain("외부 공식 절차 링크는 다루지 않는다");
    expect(t16Prompt).not.toContain("https://www.safedriving.or.kr");
    // '비교글' 프레이밍은 '소개·안내글'로 바뀐다(t16-axis-comparison 계약과 정합).
    expect(t16Prompt).toContain("소개·안내하는 글이다");
    expect(t16Prompt).toContain("학원 소개 범위:");
    expect(t16Prompt).not.toContain("이 글은 지역 운전면허학원 비교글이다");
    expect(t16Prompt).not.toContain("비교글 범위:");

    // 표 지시도 요약표(로스터)로 바뀐다 — 비교 매트릭스 예시/‘비교표’ 지칭을 쓰지 않는다.
    expect(t16Prompt).toContain("각 학원을 행으로 두는 요약표");
    expect(t16Prompt).toContain("요약표의 중심 열");
    expect(t16Prompt).not.toContain("| 비교 항목 | 후보 A | 후보 B |");
    expect(t16Prompt).not.toContain("비교표의 중심 열");
  });

  it("T01 표 지시는 비교표(매트릭스)를 유지한다", () => {
    const t01Prompt = buildPrompt({ display_name: "테스트" }, {
      template_id: "T01", slot_id: "T01_test", region: "테스트시", primary_keyword: "테스트시 운전면허학원",
    }, "facts", "comparison", getArchetype("local"), "", true, null, { t01Comparison: true, readerFlow: true });
    expect(t01Prompt).toContain("| 비교 항목 | 후보 A | 후보 B |");
    expect(t01Prompt).toContain("비교표의 중심 열");
    expect(t01Prompt).not.toContain("각 학원을 행으로 두는 요약표");
  });

  it("동명 학원이 함께 뽑히면 시·군·구로 구분하고, 겹치지 않으면 원래 이름을 유지한다", () => {
    // 겹치지 않는 일반 경우 — 기존 동작 그대로(이름 변형 없음).
    expect(disambiguateAcademyNames([
      { name: "영동자동차운전전문학원", region: "강원특별자치도 강릉시" },
      { name: "강릉자동차운전전문학원", region: "강원특별자치도 강릉시" },
    ])).toEqual(["영동자동차운전전문학원", "강릉자동차운전전문학원"]);

    // 동명이 함께 뽑힌 경우 — 겹치는 이름에만 시·군·구를 붙인다.
    expect(disambiguateAcademyNames([
      { name: "대성자동차운전전문학원", region: "경상남도 양산시" },
      { name: "대성자동차운전전문학원", region: "부산광역시 사상구" },
      { name: "부산자동차운전전문학원", region: "부산광역시 사상구" },
    ])).toEqual([
      "대성자동차운전전문학원(양산시)",
      "대성자동차운전전문학원(사상구)",
      "부산자동차운전전문학원",
    ]);

    // 시·군·구가 여러 토큰이면 그대로 이어 붙인다(청주시 흥덕구).
    expect(disambiguateAcademyNames([
      { name: "삼성자동차운전전문학원", region: "충청북도 청주시 흥덕구" },
      { name: "삼성자동차운전전문학원", region: "충청남도 아산시" },
    ])).toEqual(["삼성자동차운전전문학원(청주시 흥덕구)", "삼성자동차운전전문학원(아산시)"]);
  });

  it("'가까운'·'근처'는 독자용 수식어 라벨에서 빼고 나머지는 유지한다", () => {
    // 후보를 직선거리로 뽑는 선택 힌트일 뿐이라 프롬프트 '수식어:' 줄에 노출하지 않는다.
    expect(readerFacingModifierLabels({ modifier_1: "주말반", modifier_2: "가까운" })).toEqual(["주말반"]);
    expect(readerFacingModifierLabels({ modifier_1: "근처", modifier_2: "" })).toEqual([]);
    expect(readerFacingModifierLabels({ modifier_1: "비용절약", modifier_2: "셔틀편리" })).toEqual(["비용절약", "셔틀편리"]);
  });

  it("내부링크는 facts에 '관련 글 후보'가 없으면 금지하고, 있으면(재개 시) 유도한다", () => {
    const promptFor = (facts: string) => buildPrompt({ display_name: "테스트" }, {
      template_id: "T16", slot_id: "T16_x", region: "테스트시", primary_keyword: "테스트시 운전면허학원", modifier_1: "주말반",
    }, facts, "comparison", getArchetype("local_axis"), "", true, null, { t01Comparison: true, readerFlow: true });
    // 현재 기본: 후보 미제공 → 내부 링크 '금지'. 근거 없는 유도(→ 죽은 링크)를 걸지 않는다.
    const off = promptFor("소개 가능한 후보 수: 2곳");
    expect(off).not.toContain("관련 내부링크 2~4개 권장");
    expect(off).toContain("자사 사이트의 다른 글로 연결하는 내부 링크는 넣지 않는다");
    // 재개(관련 글 후보 복원) 시엔 자동으로 유도 분기로 전환된다.
    const on = promptFor("관련 글 후보(...): \n- 글: https://x/community/y");
    expect(on).toContain("관련 내부링크 2~4개 권장");
    expect(on).not.toContain("자사 사이트의 다른 글로 연결하는 내부 링크는 넣지 않는다");
  });
});
