import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.ts";
import { Database } from "../src/db/database.ts";
import { LlmClient, LlmUnavailableError } from "../src/llm/client.ts";
import type { ProviderOutcome, ProviderRunner } from "../src/llm/providers.ts";

function setup(outcomes: Record<string, ProviderOutcome[]>, llm: object = {}) {
  const db = new Database(":memory:");
  const calls: string[] = [];
  const runner: ProviderRunner = async (provider) => {
    calls.push(provider);
    const next = outcomes[provider]?.shift();
    if (!next) throw new Error(`예상하지 못한 ${provider} 호출`);
    return next;
  };
  const client = new LlmClient(db, parseConfig({ llm }).llm, runner);
  return { db, client, calls };
}

const ok = (text: string, usedPercent = 10): ProviderOutcome => ({
  kind: "ok",
  text,
  model: "m",
  usage: [{ name: "five_hour", usedPercent, resetsAt: "2099-01-01T00:00:00.000Z" }],
});

describe("LlmClient", () => {
  it("첫 프로바이더가 성공하면 그 결과를 쓴다", async () => {
    const { client, calls } = setup({ codex: [ok("글")] });
    expect((await client.generate("p")).text).toBe("글");
    expect(calls).toEqual(["codex"]);
  });

  it("한도에 걸리면 해제 시각까지 쉬고 다음 프로바이더로 넘어간다", async () => {
    const until = new Date(Date.now() + 3_600_000);
    const { client, calls } = setup({
      codex: [{ kind: "rate_limited", message: "usage limit", until, usage: [] }],
      claude: [ok("대체"), ok("다시")],
    });
    expect((await client.generate("p")).provider).toBe("claude");
    expect(client.status()[0]).toMatchObject({
      provider: "codex",
      blockedUntil: until.toISOString(),
    });
    await client.generate("p");
    expect(calls).toEqual(["codex", "claude", "claude"]);
  });

  it("사용률이 기준 이상이면 성공했어도 리셋 시각까지 쉰다", async () => {
    const { client } = setup({ codex: [ok("글", 85)] }, { order: ["codex"] });
    await client.generate("p");
    expect(client.nextAvailableAt()?.toISOString()).toBe("2099-01-01T00:00:00.000Z");
    await expect(client.generate("p")).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  it("해제 시각을 모르면 limitCooldownMin 동안 쉰다", async () => {
    const { client } = setup(
      { codex: [{ kind: "rate_limited", message: "usage limit", usage: [] }] },
      { order: ["codex"], limitCooldownMin: 30 },
    );
    const before = Date.now();
    await expect(client.generate("p")).rejects.toBeInstanceOf(LlmUnavailableError);
    const until = client.nextAvailableAt()!.getTime();
    expect(until - before).toBeGreaterThanOrEqual(30 * 60_000 - 1000);
    expect(until - before).toBeLessThanOrEqual(30 * 60_000 + 1000);
  });

  it("CLI가 없거나 오류면 다음으로 넘어가고, 모두 실패하면 일반 오류", async () => {
    const { client, db } = setup({
      codex: [{ kind: "not_found", message: "codex 없음" }],
      claude: [{ kind: "error", message: "login required" }],
    });
    await expect(client.generate("p")).rejects.toThrow(/codex 없음.*login required/);
    expect(db.all("SELECT outcome FROM llm_calls ORDER BY id")).toEqual([
      { outcome: "not_found" },
      { outcome: "error" },
    ]);
  });
});
