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

describe("sources", () => {
  it("기본은 운영 주소, profile=dev면 개발 주소를 쓴다", () => {
    expect(parseConfig({}).sources).toEqual({
      profile: "prod",
      drivingplusApi: "https://api.drivingplus.me",
      drivingzoneApi: "https://api.drivingzone.co.kr",
    });
    expect(parseConfig({ sources: { profile: "dev" } }).sources.drivingzoneApi).toBe(
      "https://adrock.duckdns.org:18099",
    );
  });

  it("직접 지정한 주소가 profile보다 우선하고 끝 슬래시는 뗀다", () => {
    const config = parseConfig({ sources: { drivingplusApi: "http://localhost:8000/" } });
    expect(config.sources.drivingplusApi).toBe("http://localhost:8000");
    expect(config.sources.drivingzoneApi).toBe("https://api.drivingzone.co.kr");
  });
});
