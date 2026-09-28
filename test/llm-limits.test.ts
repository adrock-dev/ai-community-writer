import { describe, expect, it } from "vitest";
import { looksRateLimited, parseResetTime, pauseUntilForUsage } from "../src/llm/limits.ts";

const NOW = new Date(2026, 8, 28, 14, 0, 0); // 로컬 2026-09-28 14:00

describe("looksRateLimited", () => {
  it("한도 문구를 알아본다", () => {
    expect(looksRateLimited("You've hit your usage limit. Try again in 2 hours.")).toBe(true);
    expect(looksRateLimited("Claude AI usage limit reached|1790592000")).toBe(true);
    expect(looksRateLimited("HTTP 429 Too Many Requests")).toBe(true);
    expect(looksRateLimited("Invalid model name")).toBe(false);
  });
});

describe("parseResetTime", () => {
  it("epoch 형식", () => {
    expect(parseResetTime("Claude AI usage limit reached|1790592000", NOW)?.getTime()).toBe(
      1790592000 * 1000,
    );
  });

  it("상대 시간 (days/hours/minutes)", () => {
    const at = parseResetTime("Try again in 1 day 2 hours 30 minutes.", NOW);
    expect(at?.getTime()).toBe(NOW.getTime() + (26 * 60 + 30) * 60_000);
    expect(parseResetTime("limit reached, resets in 45m", NOW)?.getTime()).toBe(
      NOW.getTime() + 45 * 60_000,
    );
  });

  it("시각 (오늘 지났으면 내일)", () => {
    expect(parseResetTime("usage limit. Try again at 4:41 PM.", NOW)).toEqual(
      new Date(2026, 8, 28, 16, 41),
    );
    expect(parseResetTime("usage limit reached, resets at 9:00 AM", NOW)).toEqual(
      new Date(2026, 8, 29, 9, 0),
    );
    expect(parseResetTime("rate limit, resets 5pm", NOW)).toEqual(new Date(2026, 8, 28, 17, 0));
  });

  it("알 수 없으면 undefined", () => {
    expect(parseResetTime("usage limit reached", NOW)).toBeUndefined();
  });
});

describe("pauseUntilForUsage", () => {
  const fallback = new Date(NOW.getTime() + 3_600_000);
  it("기준 이상인 창 중 가장 늦게 풀리는 시각", () => {
    const usage = [
      { name: "five_hour", usedPercent: 85, resetsAt: "2026-09-28T08:00:00.000Z" },
      { name: "seven_day", usedPercent: 90, resetsAt: "2026-10-01T00:00:00.000Z" },
    ];
    expect(pauseUntilForUsage(usage, 80, fallback)?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("기준 미만이면 undefined, 해제 시각이 없으면 fallback", () => {
    expect(pauseUntilForUsage([{ name: "a", usedPercent: 10 }], 80, fallback)).toBeUndefined();
    expect(pauseUntilForUsage([{ name: "a", usedPercent: 95 }], 80, fallback)).toBe(fallback);
  });
});
