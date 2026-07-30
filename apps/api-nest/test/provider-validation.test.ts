import { describe, expect, it } from "vitest";
import { parseLlmProvider } from "../src/admin.controller.js";

// 생성 잡·축 제안·방향성 검증 세 곳이 공유하는 provider 관문.
//
// 이 관문이 없던 동안에는 `codx` 같은 오타가 그대로 잡 payload 에 들어가 큐를 한 바퀴 돈 뒤
// 러너에서 `unknown_provider` 로 실패했다 — 슬롯은 failed 로 남고 원인은 작업 상세를 열어야 보였다.
// 요청 시점에 400 으로 끊는 것이 이 테스트가 지키는 계약이다.
describe("provider 검증", () => {
  it("비어 있으면 기본 codex", () => {
    expect(parseLlmProvider(undefined)).toBe("codex");
    expect(parseLlmProvider("")).toBe("codex");
    expect(parseLlmProvider("   ")).toBe("codex");
  });

  it("러너가 아는 값은 그대로 통과한다", () => {
    expect(parseLlmProvider("codex")).toBe("codex");
    expect(parseLlmProvider("claude")).toBe("claude");
    // openai_responses 는 화면(/options.providers)에 없지만 API 직접 호출은 의도적으로 열어 둔다.
    expect(parseLlmProvider("openai_responses")).toBe("openai_responses");
    expect(parseLlmProvider(" claude ")).toBe("claude");
  });

  it("모르는 값은 400 으로 끊는다", () => {
    for (const bad of ["codx", "openai", "gpt", "claude-3", "1"]) {
      expect(() => parseLlmProvider(bad)).toThrow(/알 수 없는 provider/);
    }
  });
});
