import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.ts";
import { resolvePath } from "../src/paths.ts";

describe("parseConfig", () => {
  it("빈 설정이면 기본값을 채운다", () => {
    const config = parseConfig({});
    expect(config.server.port).toBe(8787);
    expect(config.llm.order).toEqual(["codex", "claude"]);
    expect(config.llm.codex.command).toBe("codex");
    expect(config.pacing.dailyLimit).toBe(10);
  });

  it("일부만 적으면 나머지는 기본값을 유지한다", () => {
    const config = parseConfig({ llm: { order: ["claude"] }, pacing: { dailyLimit: 3 } });
    expect(config.llm.order).toEqual(["claude"]);
    expect(config.llm.timeoutSec).toBe(600);
    expect(config.pacing.dailyLimit).toBe(3);
    expect(config.pacing.minIntervalSec).toBe(300);
  });

  it("잘못된 값은 경로가 담긴 오류를 낸다", () => {
    expect(() => parseConfig({ llm: { order: ["gpt"] } })).toThrow(/llm\.order/);
    expect(() => parseConfig({ pacing: { minIntervalSec: 900, maxIntervalSec: 10 } })).toThrow(
      /maxIntervalSec/,
    );
  });
});

describe("resolvePath", () => {
  it("~는 홈 디렉터리로 푼다 (Windows 구분자 포함)", () => {
    expect(resolvePath("~/.naver-searchad.env")).toBe(join(homedir(), ".naver-searchad.env"));
    expect(resolvePath("~\\.naver-searchad.env")).toBe(join(homedir(), ".naver-searchad.env"));
  });

  it("상대 경로는 기준 디렉터리에 붙인다", () => {
    expect(resolvePath("data/writer.db", join("/", "base"))).toBe(
      join("/", "base", "data", "writer.db"),
    );
  });
});
