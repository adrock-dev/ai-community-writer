import { describe, expect, it } from "vitest";
import { CHANNELS, findSection } from "../src/channels.ts";

describe("CHANNELS", () => {
  it("채널 id와 채널 안의 섹션 코드는 중복되지 않는다", () => {
    const ids = CHANNELS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const channel of CHANNELS) {
      const codes = channel.sections.map((s) => s.code);
      expect(new Set(codes).size, channel.id).toBe(codes.length);
      expect(codes.length, channel.id).toBeGreaterThan(0);
    }
  });

  it("drivingplus 커뮤니티 섹션을 찾는다", () => {
    expect(findSection("drivingplus-community", "drive_story")?.focus).toContain(
      "운전학원 찾기·비교·추천",
    );
    expect(findSection("drivingplus-community", "unknown")).toBeUndefined();
  });
});
