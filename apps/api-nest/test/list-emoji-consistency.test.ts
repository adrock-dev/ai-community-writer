import { describe, expect, it } from "vitest";
import { inconsistentListEmojiIssues } from "../src/quality-gate.js";

// 이모지는 허용하되(체크리스트 ✅ 등) 같은 목록 안에서는 같은 이모지로 통일해야 한다.
// "계열"의 정성 판단 없이 '한 목록 내 이모지 2종 이상 섞임'만 기계적으로 잡는다(오탐 최소).

describe("목록 이모지 일관성", () => {
  it("통일된 ✅ 체크리스트는 통과한다", () => {
    expect(inconsistentListEmojiIssues("- ✅ 하나\n- ✅ 둘\n- ✅ 셋")).toEqual([]);
  });

  it("한 목록에서 이모지가 섞이면 실패한다", () => {
    expect(inconsistentListEmojiIssues("- ✅ 하나\n- 🚗 둘\n- ⭐ 셋")).toEqual(["inconsistent_list_emoji"]);
  });

  it("이모지 없는 일반 불릿은 무관하다", () => {
    expect(inconsistentListEmojiIssues("- 하나\n- 둘\n1. 셋")).toEqual([]);
  });

  it("헤딩·문단으로 나뉜 별개 목록은 각각 검사한다", () => {
    // 두 목록이 각각 한 종류로 통일 → 통과
    expect(inconsistentListEmojiIssues("- ✅ 체크\n\n## 다른 섹션\n\n- 🚗 다른목록\n- 🚗 또")).toEqual([]);
  });

  it("화살표(→)로 시작하는 항목은 이모지로 세지 않는다", () => {
    expect(inconsistentListEmojiIssues("- → 하나\n- ✅ 둘")).toEqual([]);
  });

  it("변이 선택자가 붙어도 같은 이모지로 본다", () => {
    expect(inconsistentListEmojiIssues("- ✅️ 하나\n- ✅ 둘")).toEqual([]);
  });
});
