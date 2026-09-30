import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppContext } from "../src/app.ts";
import { parseConfig } from "../src/config.ts";
import { Database } from "../src/db/database.ts";
import {
  addGuideRule,
  deleteGuideRule,
  exportGuideFiles,
  GUIDES_DIR,
  guideFilesInSync,
  importGuideFiles,
  importGuideFilesIfEmpty,
  listGuideRules,
  loadGuideRules,
  parseGuide,
  publicGuideText,
  renderGuideRules,
  updateGuideRule,
} from "../src/guides.ts";
import { JobQueue } from "../src/queue/queue.ts";
import { createApp } from "../src/server.ts";
import { mountGuideSettings } from "../src/web/guides.ts";

describe("parseGuide", () => {
  it("목록 항목을 규칙으로, ## 제목을 묶음으로 읽는다 (BOM·CRLF 허용)", () => {
    const md =
      "\uFEFF# 제목\r\n설명 문장\r\n\r\n## 교육 운영\r\n- 규칙 하나\r\n  이어지는 줄\r\n* 규칙 둘\r\n";
    expect(parseGuide(md)).toEqual([
      { group: "교육 운영", text: "규칙 하나 이어지는 줄", enabled: true },
      { group: "교육 운영", text: "규칙 둘", enabled: true },
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

  it("저장소 초기값: 드라이빙존 요금 규칙은 드라이빙존 채널에만 적용된다", () => {
    const db = new Database(":memory:");
    importGuideFilesIfEmpty(db);
    const zone = loadGuideRules(db, "drivingzone-cafe").map((r) => r.text);
    const plus = loadGuideRules(db, "drivingplus-community").map((r) => r.text);
    expect(zone.some((t) => t.includes("부가세 미포함"))).toBe(true);
    expect(plus.some((t) => t.includes("부가세 미포함"))).toBe(false);
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

describe("가이드 파일 동기화", () => {
  const snapshot = (db: Database) =>
    listGuideRules(db).map(({ scope, group, text, enabled }) => ({ scope, group, text, enabled }));

  function seeded() {
    const db = new Database(":memory:");
    addGuideRule(db, { scope: "common", text: "묶음 없는 공통 규칙" });
    addGuideRule(db, { scope: "common", group: "사실 확인", text: "지어내지 않는다" });
    addGuideRule(db, { scope: "common", text: "묶음 뒤에 온 묶음 없는 규칙" });
    addGuideRule(db, {
      scope: "channel:drivingzone-blog",
      group: "마무리 안내 섹션",
      text: "자주 묻는 질문 바로 앞에\n드라이빙존 안내를 둔다",
    });
    addGuideRule(db, { scope: "brand:drivingzone", text: "꺼 둔 규칙", enabled: false });
    return db;
  }

  it("파일에 저장한 뒤 다른 DB 에서 불러오면 묶음·순서·사용 여부까지 같다", () => {
    const dir = mkdtempSync(join(tmpdir(), "guides-sync-"));
    const a = seeded();
    expect(guideFilesInSync(a, dir)).toBe(false);
    const changed = exportGuideFiles(a, dir);
    expect(changed).toContain("channels/drivingzone-blog.md");
    expect(guideFilesInSync(a, dir)).toBe(true);
    expect(exportGuideFiles(a, dir)).toEqual([]); // 두 번째 저장은 바꿀 것이 없다
    expect(readFileSync(join(dir, "drivingzone.md"), "utf8")).toContain(
      "- (사용 안 함) 꺼 둔 규칙",
    );
    // 규칙이 없는 범위도 파일을 둬서, 다른 PC 에서 불러올 때 지운 규칙이 남지 않게 한다
    expect(existsSync(join(dir, "drivingplus.md"))).toBe(true);

    const b = new Database(":memory:");
    addGuideRule(b, { scope: "common", text: "이 PC 에만 있던 규칙" });
    expect(importGuideFiles(b, dir)).toBe(5);
    expect(snapshot(b)).toEqual(
      snapshot(a).map((r) =>
        r.text.includes("\n") ? { ...r, text: r.text.replace(/\s*\n\s*/g, " ") } : r,
      ),
    );
    expect(guideFilesInSync(b, dir)).toBe(true);
  });

  it("파일이 없으면 불러오기를 거부한다(규칙을 모두 지우지 않게)", () => {
    const db = seeded();
    expect(() => importGuideFiles(db, mkdtempSync(join(tmpdir(), "empty-")))).toThrow(/없습니다/);
    expect(listGuideRules(db)).toHaveLength(5);
  });

  it("화면의 저장·불러오기 버튼이 동작한다", async () => {
    const dir = mkdtempSync(join(tmpdir(), "guides-ui-"));
    const db = seeded();
    const app = new Hono();
    mountGuideSettings(app, db, dir);
    expect(await (await app.request("/settings/guides")).text()).toContain("guides 폴더와 다름");
    let res = await app.request("/settings/guides/export", { method: "POST" });
    expect(res.headers.get("location")).toContain("done=exported");
    expect(await (await app.request("/settings/guides")).text()).toContain("guides 폴더와 같음");

    deleteGuideRule(db, listGuideRules(db)[0]!.id);
    res = await app.request("/settings/guides/import", { method: "POST" });
    expect(res.headers.get("location")).toContain("done=imported");
    expect(listGuideRules(db)).toHaveLength(5);
  });
});

describe("공단 안내 묶음", () => {
  it("공단 안내 묶음의 규칙만 공공 요금 근거로 모은다", () => {
    const text = publicGuideText([
      { group: "공단 안내 · 학과시험", text: "학과시험 수수료는 1만원이다" },
      { group: "요금", text: "드라이빙존 요금은 부가세 별도다" },
    ]);
    expect(text).toBe("학과시험 수수료는 1만원이다");
  });

  it("guides/common.md 의 공단 안내 수수료가 만 단위로 적혀 있다", () => {
    const rules = parseGuide(readFileSync(join(GUIDES_DIR, "common.md"), "utf8"));
    const text = publicGuideText(rules);
    for (const fee of ["1만원", "2만 5천원", "3만원", "4천원", "1만 6천원", "7천원"]) {
      expect(text).toContain(fee);
    }
    expect(text).not.toMatch(/\d{1,3},\d{3}원/);
  });
});
