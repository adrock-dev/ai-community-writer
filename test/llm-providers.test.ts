import { describe, expect, it } from "vitest";
import {
  claudeArgs,
  codexArgs,
  codexUsageFromRateLimits,
  parseClaudeStream,
  parseCodexStream,
} from "../src/llm/providers.ts";

const iso = (sec: number) => new Date(sec * 1000).toISOString();

// 실제 CLI 출력(codex-cli 0.157, Claude Code 2.1)에서 가져온 형태
const CLAUDE_OK = [
  '{"type":"system","subtype":"init","session_id":"s1","tools":[]}',
  '{"type":"assistant","message":{"model":"claude-opus-5-5","content":[{"type":"text","text":"파랑"}]}}',
  '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1790592000,"rateLimitType":"five_hour","unifiedWindows":{"five_hour":{"utilization":0.03,"resetsAt":1790592000},"seven_day":{"utilization":0.18,"resetsAt":1790654400}}}}',
  '{"type":"result","subtype":"success","is_error":false,"result":"파랑","session_id":"s1"}',
].join("\n");

const CODEX_OK = [
  '{"type":"thread.started","thread_id":"01a0e696-4320-7c11-abaf-7c75499eebb4"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"파란색"}}',
  '{"type":"turn.completed","usage":{"input_tokens":15744,"output_tokens":7}}',
].join("\n");

describe("claude", () => {
  it("도구·MCP·세션 저장을 끈 인자로 실행한다", () => {
    const args = claudeArgs("");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--no-session-persistence");
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(claudeArgs("sonnet").slice(-2)).toEqual(["--model", "sonnet"]);
  });

  it("본문·모델·사용률을 읽는다", () => {
    const parsed = parseClaudeStream(CLAUDE_OK);
    expect(parsed.text).toBe("파랑");
    expect(parsed.model).toBe("claude-opus-5-5");
    expect(parsed.rejected).toBe(false);
    expect(parsed.usage).toEqual([
      { name: "five_hour", usedPercent: 3, resetsAt: iso(1790592000) },
      { name: "seven_day", usedPercent: 18, resetsAt: iso(1790654400) },
    ]);
  });

  it("한도 거절 이벤트를 알아본다", () => {
    const parsed = parseClaudeStream(
      '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1790592000}}\n{"type":"result","is_error":true,"result":"usage limit"}',
    );
    expect(parsed.rejected).toBe(true);
    expect(parsed.isError).toBe(true);
    expect(parsed.resetsAt).toBe(iso(1790592000));
  });
});

describe("codex", () => {
  it("마지막 메시지 파일을 받고 stdin으로 프롬프트를 넘긴다", () => {
    const args = codexArgs("", "/tmp/last.txt");
    expect(args[0]).toBe("exec");
    expect(args[args.indexOf("--output-last-message") + 1]).toBe("/tmp/last.txt");
    expect(args.at(-1)).toBe("-");
  });

  it("본문과 스레드 id를 읽는다", () => {
    expect(parseCodexStream(CODEX_OK)).toEqual({
      text: "파란색",
      threadId: "01a0e696-4320-7c11-abaf-7c75499eebb4",
      errorText: "",
    });
    expect(
      parseCodexStream('{"type":"turn.failed","error":{"message":"usage limit"}}').errorText,
    ).toBe("usage limit");
  });

  it("세션 로그의 rate_limits를 사용률로 바꾼다", () => {
    expect(
      codexUsageFromRateLimits({
        primary: { used_percent: 4.0, window_minutes: 300, resets_at: 1790570498 },
        secondary: { used_percent: 1.0, window_minutes: 10080, resets_at: 1791068420 },
      }),
    ).toEqual([
      { name: "primary(300m)", usedPercent: 4, resetsAt: new Date(1790570498000).toISOString() },
      {
        name: "secondary(10080m)",
        usedPercent: 1,
        resetsAt: new Date(1791068420000).toISOString(),
      },
    ]);
  });
});
