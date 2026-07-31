import { describe, expect, it } from "vitest";
import { academyCardBulletLines, ensureT16CardBullets } from "../src/t16-card-bullets.js";

/**
 * T16 카드 기본 정보 불릿을 코드가 채우는 동작의 회귀 가드.
 *
 * 이 후처리가 생긴 이유는 프롬프트 계약이 지켜지지 않아서다 — 발행 5편 중 3편이 카드 불릿 0개였고
 * 계약을 「반드시」로 강화한 뒤 생성한 글도 0개였다(2026-07-31 실측). 여기서 지켜야 하는 성질은
 * 「빠진 카드만 채운다」와 「없는 값은 만들지 않는다」 둘이다.
 */

const label = (value: unknown) => ({ academy: "운전학원", exam_academy: "자동차운전전문학원" }[String(value)] ?? String(value ?? ""));

const 학원A = {
  name: "가나자동차운전전문학원",
  address: "대구광역시 북구 어딘가로 12",
  vphone: "0507-0000-0000",
  phone: "053-000-0000",
  price: "2종 보통 65만원",
  shuttle: "북구 칠성동, 동구 신암동 등",
  academy_type: "exam_academy",
  available_licenses: ["1종 보통", "2종 보통"],
};
const 학원B = {
  name: "다라운전학원",
  address: "대구광역시 북구 다른로 3",
  academy_type: "academy",
};

describe("T16 카드 기본 정보 불릿", () => {
  it("불릿이 없는 카드에 facts 값을 채운다", () => {
    const md = ["## 대구에서 살펴볼 운전면허학원 2곳", "", "### 가나자동차운전전문학원", "", "주말에도 문을 여는 곳이에요.", ""].join("\n");
    const out = ensureT16CardBullets(md, [학원A], label);
    expect(out).toContain("- **주소:** 대구광역시 북구 어딘가로 12");
    expect(out).toContain("- **수강료:** 2종 보통 65만원");
  });

  it("모델이 이미 쓴 카드는 건드리지 않는다", () => {
    const md = ["### 가나자동차운전전문학원", "", "소개 문장.", "", "- **주소:** 직접 쓴 주소", ""].join("\n");
    expect(ensureT16CardBullets(md, [학원A], label)).toBe(md);
  });

  it("리뷰 인용이 있으면 그 위에 넣는다 — 계약의 카드 순서(소개 → 불릿 → 인용)", () => {
    const md = ["### 가나자동차운전전문학원", "", "소개 문장.", "", "> 친절했어요.", ""].join("\n");
    const out = ensureT16CardBullets(md, [학원A], label).split("\n");
    const bullet = out.findIndex((l) => l.startsWith("- **주소:**"));
    const quote = out.findIndex((l) => l.startsWith(">"));
    expect(bullet).toBeGreaterThan(-1);
    expect(bullet).toBeLessThan(quote);
  });

  it("없는 값은 만들지 않는다", () => {
    const md = ["### 다라운전학원", "", "소개 문장.", ""].join("\n");
    const out = ensureT16CardBullets(md, [학원A, 학원B], label);
    expect(out).toContain("- **주소:** 대구광역시 북구 다른로 3");
    expect(out).not.toContain("- **수강료:**");
    expect(out).not.toContain("- **셔틀 운행 지역:**");
  });

  it("공개 연락처는 안심번호만 쓴다 — 실번호는 넣지 않는다", () => {
    const lines = academyCardBulletLines(학원A, false, label);
    expect(lines.some((l) => l.includes("0507-0000-0000"))).toBe(true);
    expect(lines.some((l) => l.includes("053-000-0000"))).toBe(false);
  });

  it("운영 형태는 학원마다 다를 때만 넣는다", () => {
    const md = ["### 가나자동차운전전문학원", "", "소개.", "", "### 다라운전학원", "", "소개.", ""].join("\n");
    expect(ensureT16CardBullets(md, [학원A, 학원B], label)).toContain("- **운영 형태:**");
    // 모두 같은 운영 형태면 공통 사실이라 카드마다 되풀이하지 않는다.
    const same = ensureT16CardBullets(md, [학원A, { ...학원B, academy_type: "exam_academy" }], label);
    expect(same).not.toContain("- **운영 형태:**");
  });

  it("수강료의 공통 단서는 카드 불릿에서 뗀다 — 글에서 한 번만 밝히는 것이 계약이다", () => {
    const lines = academyCardBulletLines(
      { ...학원A, price: "2종 보통 650,000원 (부가세 별도, 검정료 포함, 2026년 1분기 기준)" },
      false,
      label,
    );
    const fee = lines.find((l) => l.includes("수강료")) ?? "";
    expect(fee).toContain("650,000원");
    expect(fee).not.toContain("부가세");
    expect(fee).not.toContain("기준");
  });

  it("셔틀 운행 지역은 대표 몇 곳 + 등으로 줄인다 — 길이 게이트를 넘기던 자리", () => {
    const many = "북구 칠성동, 북구 산격동, 동구 신암동, 서구 내당동, 남구 대명동, 수성구 범어동";
    const lines = academyCardBulletLines({ ...학원A, shuttle: many }, false, label);
    const shuttle = lines.find((l) => l.includes("셔틀")) ?? "";
    expect(shuttle).toContain("등");
    expect(shuttle).not.toContain("수성구 범어동");
    // 적을 때는 그대로 둔다 — 굳이 "등"을 붙이면 더 있는 것처럼 읽힌다.
    const few = academyCardBulletLines({ ...학원A, shuttle: "북구 칠성동, 동구 신암동" }, false, label).find((l) => l.includes("셔틀")) ?? "";
    expect(few).not.toContain("등");
  });

  it("자료에 없는 학원의 카드는 건드리지 않는다 — 오배정이 빈 불릿보다 나쁘다", () => {
    const md = ["### 이름이 전혀 다른 학원", "", "소개 문장.", ""].join("\n");
    expect(ensureT16CardBullets(md, [학원A], label)).toBe(md);
  });

  it("H2 로 카드 묶음이 끝나면 그 뒤 문단은 카드로 보지 않는다", () => {
    const md = ["### 가나자동차운전전문학원", "", "- **주소:** 이미 있음", "", "## 상담 전 확인할 것", "", "본문.", ""].join("\n");
    expect(ensureT16CardBullets(md, [학원A], label)).toBe(md);
  });

  it("카드가 여러 개여도 각 카드에 자기 학원 값이 들어간다", () => {
    const md = ["### 가나자동차운전전문학원", "", "소개.", "", "### 다라운전학원", "", "소개.", ""].join("\n");
    const out = ensureT16CardBullets(md, [학원A, 학원B], label);
    const [first, second] = out.split("### 다라운전학원");
    expect(first).toContain("어딘가로 12");
    expect(second).toContain("다른로 3");
    expect(second).not.toContain("어딘가로 12");
  });
});
