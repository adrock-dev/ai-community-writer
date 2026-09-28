import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadGuideRules, parseGuide, renderGuideRules } from "../src/guides.ts";

describe("parseGuide", () => {
  it("목록 항목을 규칙으로, ## 제목을 묶음으로 읽는다 (BOM·CRLF 허용)", () => {
    const md =
      "\uFEFF# 제목\r\n설명 문장\r\n\r\n## 교육 운영\r\n- 규칙 하나\r\n  이어지는 줄\r\n* 규칙 둘\r\n";
    expect(parseGuide(md, "a.md")).toEqual([
      { source: "a.md", group: "교육 운영", text: "규칙 하나 이어지는 줄" },
      { source: "a.md", group: "교육 운영", text: "규칙 둘" },
    ]);
  });
});

describe("loadGuideRules", () => {
  it("공통 → 브랜드 → 채널 순으로 모으고 없는 파일은 건너뛴다", () => {
    const dir = mkdtempSync(join(tmpdir(), "guides-"));
    mkdirSync(join(dir, "channels"));
    writeFileSync(join(dir, "common.md"), "- 공통 규칙\n");
    writeFileSync(join(dir, "drivingzone.md"), "## 교육 운영\n- 브랜드 규칙\n");
    writeFileSync(join(dir, "channels", "dztraining-blog.md"), "- 채널 규칙\n");

    const rules = loadGuideRules("dztraining-blog", dir);
    expect(rules.map((r) => r.text)).toEqual(["공통 규칙", "브랜드 규칙", "채널 규칙"]);
    expect(loadGuideRules("drivingplus-community", dir).map((r) => r.text)).toEqual(["공통 규칙"]);
    expect(renderGuideRules(rules)).toBe(
      "[기본 규칙]\n- 공통 규칙\n\n[교육 운영]\n- 브랜드 규칙\n\n[기본 규칙]\n- 채널 규칙",
    );
  });

  it("저장소의 드라이빙존 가이드를 드라이빙존 채널에만 적용한다", () => {
    const zone = loadGuideRules("drivingzone-cafe").map((r) => r.text);
    const plus = loadGuideRules("drivingplus-community").map((r) => r.text);
    expect(zone.some((t) => t.includes("1시간 30분"))).toBe(true);
    expect(plus.some((t) => t.includes("1시간 30분"))).toBe(false);
  });
});
