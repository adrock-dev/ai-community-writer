import { describe, expect, it } from "vitest";
import { CHANNELS, findSection, resolveFilterCodes } from "../src/channels.ts";

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
      "운전학원 찾기·비교·추천·비용",
    );
    expect(findSection("drivingplus-community", "unknown")).toBeUndefined();
  });
});

describe("resolveFilterCodes", () => {
  const section = (code: string) => findSection("drivingplus-community", code)!;

  it("유형·키워드 규칙을 위에서부터 보고, 맞는 게 없으면 기본 칸", () => {
    expect(resolveFilterCodes(section("drive_story"), "academy", "운전학원추천")).toEqual([
      "driving_info",
    ]);
    expect(
      resolveFilterCodes(section("exam_procedure_guide"), "exam", "운전면허 필기시험"),
    ).toEqual(["theory_exam"]);
    expect(resolveFilterCodes(section("exam_procedure_guide"), "exam", "도로주행시험")).toEqual([
      "road_test",
    ]);
    expect(resolveFilterCodes(section("exam_procedure_guide"), "howto", "운전면허따는법")).toEqual([
      "examinee_guide",
    ]);
    expect(resolveFilterCodes(section("license_tips"), "test_center", "강남면허시험장")).toEqual([
      "test_center",
    ]);
    expect(resolveFilterCodes(section("license_tips"), "license_admin", "적성검사")).toEqual([
      "license_care",
    ]);
  });

  it("칸이 없는 채널 섹션은 빈 배열", () => {
    expect(resolveFilterCodes(findSection("drivingzone-blog", "blog")!, "exam", "필기")).toEqual(
      [],
    );
  });
});
