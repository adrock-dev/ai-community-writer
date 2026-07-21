import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { A_ISSUE_STEMS, B_ISSUE_STEMS, blockingClass, classifyIssue, classifyIssues, isKnownIssueStem } from "../src/quality-gate-severity.js";

describe("이슈 심각도 분류(A/B)", () => {
  it("구조/문체 코드는 동적 접미사가 붙어도 A로 분류한다", () => {
    expect(classifyIssue("too_short_1500")).toBe("A");
    expect(classifyIssue("not_enough_h2_1")).toBe("A");
    expect(classifyIssue("missing_h1_title")).toBe("A");
    expect(classifyIssue("unknown_image_slots_hero_body")).toBe("A");
    expect(classifyIssue("hard_sentences_7")).toBe("A");
  });

  it("안전/사실 코드는 B로 분류한다", () => {
    expect(classifyIssue("exposes_internal_fact_language")).toBe("B");
    expect(classifyIssue("inflated_candidate_count_5_gt_3")).toBe("B");
    expect(classifyIssue("unverified_specific_price_claim")).toBe("B");
    expect(classifyIssue("missing_real_candidate_name")).toBe("B");
    expect(classifyIssue("t01_unverified_shuttle_claim")).toBe("B");
  });

  it("미분류(신규) 코드는 안전하게 B로 폴백한다", () => {
    expect(classifyIssue("brand_new_unknown_code")).toBe("B");
    expect(classifyIssue("")).toBe("B");
  });

  it("blockingClass는 B가 하나라도 있으면 B, 아니면 A", () => {
    expect(blockingClass(["too_short_100", "not_enough_h2_1"])).toBe("A");
    expect(blockingClass(["too_short_100", "exposes_internal_fact_language"])).toBe("B");
    expect(blockingClass([])).toBe("A");
  });

  it("classifyIssues는 code/class 쌍을 보존한다", () => {
    expect(classifyIssues(["too_short_100", "contains_pseudo_slot"])).toEqual([
      { code: "too_short_100", class: "A" },
      { code: "contains_pseudo_slot", class: "B" },
    ]);
  });

  it("A/B stem 집합은 서로 겹치지 않는다", () => {
    const overlap = A_ISSUE_STEMS.filter((stem) => B_ISSUE_STEMS.includes(stem));
    expect(overlap).toEqual([]);
  });
});

// 드리프트 가드: quality-gate.ts 가 내보내는 모든 이슈 코드 어간이 분류표에 명시돼 있는지 검사한다.
// 상대 세션이 게이트에 새 코드를 추가했는데 여기에 반영이 안 되면 이 테스트가 실패한다.
describe("게이트 이슈 분류 드리프트 가드", () => {
  const source = readFileSync(new URL("../src/quality-gate.ts", import.meta.url), "utf8");

  // push( ... ) 인자에서 이슈 코드 어간을 추출한다.
  //   - "literal_code"            → 그대로
  //   - `stem_${dynamic}...`      → ${ 앞의 stem (뒤 _ 제거)
  const stems = new Set<string>();
  for (const line of source.split("\n")) {
    if (!line.includes("push(")) continue;
    for (const m of line.matchAll(/"([a-z][a-z0-9_]+)"/g)) stems.add(m[1]!);
    for (const m of line.matchAll(/`([a-z][a-z0-9_]*?)_?\$\{/g)) {
      const stem = m[1]!.replace(/_+$/, "");
      if (stem) stems.add(stem);
    }
  }

  it("추출이 유효하다(회귀 방지: 최소 코드 수 확보)", () => {
    // 정규식이 깨져 아무것도 못 뽑으면 가드가 무력화되므로 하한선을 둔다.
    expect(stems.size).toBeGreaterThanOrEqual(15);
  });

  it("게이트가 내보내는 모든 코드 어간이 분류표에 존재한다", () => {
    const unclassified = [...stems].filter((stem) => !isKnownIssueStem(stem));
    // 실패 시 어떤 코드가 누락됐는지 메시지로 보여준다.
    expect(unclassified, `분류표에 없는 게이트 코드: ${unclassified.join(", ")}`).toEqual([]);
  });
});
