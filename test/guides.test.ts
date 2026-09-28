import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AppContext } from "../src/app.ts";
import { parseConfig } from "../src/config.ts";
import { Database } from "../src/db/database.ts";
import {
  addGuideRule,
  deleteGuideRule,
  importGuideFilesIfEmpty,
  listGuideRules,
  loadGuideRules,
  parseGuide,
  renderGuideRules,
  updateGuideRule,
} from "../src/guides.ts";
import { JobQueue } from "../src/queue/queue.ts";
import { createApp } from "../src/server.ts";

describe("parseGuide", () => {
  it("목록 항목을 규칙으로, ## 제목을 묶음으로 읽는다 (BOM·CRLF 허용)", () => {
    const md =
      "\uFEFF# 제목\r\n설명 문장\r\n\r\n## 교육 운영\r\n- 규칙 하나\r\n  이어지는 줄\r\n* 규칙 둘\r\n";
    expect(parseGuide(md)).toEqual([
      { group: "교육 운영", text: "규칙 하나 이어지는 줄" },
      { group: "교육 운영", text: "규칙 둘" },
    ]);
  });
});

describe("guide_rules", () => {
  it("공통 → 브랜드 → 채널 순으로 켜진 규칙만 모은다", () => {
    const db = new Database(":memory:");
    addGuideRule(db, { scope: "channel:dztraining-blog", text: "채널 규칙" });
    addGuideRule(db, { scope: "brand:drivingzone", group: "교육 운영", text: "브랜드 규칙" });
    addGuideRule(db, { scope: "common", text: "공통 규칙" });
    addGuideRule(db, { scope: "common", text: "꺼진 규칙", enabled: false });

    const rules = loadGuideRules(db, "dztraining-blog");
    expect(rules.map((r) => r.text)).toEqual(["공통 규칙", "브랜드 규칙", "채널 규칙"]);
    expect(loadGuideRules(db, "drivingplus-community").map((r) => r.text)).toEqual(["공통 규칙"]);
    expect(renderGuideRules(rules)).toBe(
      "[기본 규칙]\n- 공통 규칙\n\n[교육 운영]\n- 브랜드 규칙\n\n[기본 규칙]\n- 채널 규칙",
    );
  });

  it("수정·끄기·삭제, 잘못된 범위나 빈 내용은 거부한다", () => {
    const db = new Database(":memory:");
    const id = addGuideRule(db, { scope: "common", text: "처음" });
    updateGuideRule(db, id, { scope: "brand:drivingzone", text: "고침", enabled: false });
    expect(listGuideRules(db)[0]).toMatchObject({
      scope: "brand:drivingzone",
      text: "고침",
      enabled: false,
    });
    expect(deleteGuideRule(db, id)).toBe(true);
    expect(() => addGuideRule(db, { scope: "brand:unknown", text: "x" })).toThrow(/적용 범위/);
    expect(() => addGuideRule(db, { scope: "common", text: "  " })).toThrow(/비어/);
  });

  it("DB가 비어 있을 때만 guides/*.md를 가져온다", () => {
    const dir = mkdtempSync(join(tmpdir(), "guides-"));
    mkdirSync(join(dir, "channels"));
    writeFileSync(join(dir, "common.md"), "- 공통 규칙\n");
    writeFileSync(join(dir, "drivingzone.md"), "## 교육 운영\n- 브랜드 규칙\n");
    writeFileSync(join(dir, "channels", "dztraining-blog.md"), "- 채널 규칙\n");
    const db = new Database(":memory:");
    expect(importGuideFilesIfEmpty(db, dir)).toBe(3);
    expect(importGuideFilesIfEmpty(db, dir)).toBe(0);
    expect(loadGuideRules(db, "dztraining-blog").map((r) => r.text)).toEqual([
      "공통 규칙",
      "브랜드 규칙",
      "채널 규칙",
    ]);
  });

  it("저장소 초기값: 드라이빙존 교육시간 규칙은 드라이빙존 채널에만 적용된다", () => {
    const db = new Database(":memory:");
    importGuideFilesIfEmpty(db);
    const zone = loadGuideRules(db, "drivingzone-cafe").map((r) => r.text);
    const plus = loadGuideRules(db, "drivingplus-community").map((r) => r.text);
    expect(zone.some((t) => t.includes("1시간 30분"))).toBe(true);
    expect(plus.some((t) => t.includes("1시간 30분"))).toBe(false);
  });
});

describe("유의사항 설정 화면", () => {
  function setup() {
    const db = new Database(":memory:");
    const ctx = { db, queue: new JobQueue(db), config: parseConfig({}) } as unknown as AppContext;
    return { db, app: createApp(ctx) };
  }
  const form = (fields: Record<string, string>) => ({
    method: "POST",
    body: new URLSearchParams(fields),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });

  it("추가·수정·삭제가 폼으로 동작하고, 화면에 이스케이프되어 보인다", async () => {
    const { db, app } = setup();
    let res = await app.request(
      "/settings/guides",
      form({ scope: "brand:drivingzone", group: "교육 운영", text: "1일 1회 <최대> 1시간 30분" }),
    );
    expect(res.status).toBe(303);
    const id = listGuideRules(db)[0]!.id;

    const pageHtml = await (await app.request("/settings/guides")).text();
    expect(pageHtml).toContain("1일 1회 &lt;최대&gt; 1시간 30분");
    expect(pageHtml).toContain("드라이빙존 전체");

    // 체크박스를 끄고 저장하면 enabled 필드가 오지 않는다 → 사용 안 함
    res = await app.request(
      `/settings/guides/${id}`,
      form({ scope: "brand:drivingzone", text: "고침" }),
    );
    expect(res.status).toBe(303);
    expect(listGuideRules(db)[0]).toMatchObject({ text: "고침", enabled: false });

    await app.request(`/settings/guides/${id}/delete`, form({ scope: "brand:drivingzone" }));
    expect(listGuideRules(db)).toHaveLength(0);

    res = await app.request("/settings/guides", form({ scope: "nope", text: "x" }));
    expect(res.status).toBe(400);
  });
});
