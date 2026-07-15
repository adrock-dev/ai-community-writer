import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effectiveGenerationTitle, substituteTitlePlaceholders } from "../src/worker.service.js";

// 슬롯 수동 제목 오버라이드 — 치환·우선순위(수동>규칙>LLM)·DB 저장.
// 결정: 수동 제목은 '제목 문자열'만 오버라이드하고, 스킵(min_generate)은 규칙이 유지한다(워커 processGenerate).

const CTX = { region: "강남", count: 5, keyword: "운전학원", academyName: "강남면허학원" };

describe("substituteTitlePlaceholders", () => {
  it("{지역}/{개수}/{키워드}/{학원명} 를 실제 값으로 치환한다", () => {
    expect(substituteTitlePlaceholders("{지역} 운전학원 BEST {개수}", CTX)).toBe("강남 운전학원 BEST 5");
    expect(substituteTitlePlaceholders("{지역} {학원명} 후기", CTX)).toBe("강남 강남면허학원 후기");
    expect(substituteTitlePlaceholders("{키워드} 총정리", CTX)).toBe("운전학원 총정리");
  });
  it("연속 공백을 정리한다", () => {
    expect(substituteTitlePlaceholders("{지역}   {키워드}", CTX)).toBe("강남 운전학원");
  });
});

describe("effectiveGenerationTitle (수동 > 규칙 > null)", () => {
  it("수동 제목이 있으면 규칙 제목을 무시하고 수동을 쓴다(치환 적용)", () => {
    expect(effectiveGenerationTitle("{지역} 단독 소개", "강남 운전학원 BEST 5", CTX)).toBe("강남 단독 소개");
  });
  it("수동 제목이 없으면 규칙 제목을 쓴다", () => {
    expect(effectiveGenerationTitle(null, "강남 운전학원 BEST 5", CTX)).toBe("강남 운전학원 BEST 5");
    expect(effectiveGenerationTitle(undefined, "강남 추천 운전학원", CTX)).toBe("강남 추천 운전학원");
  });
  it("수동·규칙 둘 다 없으면 null(=LLM H1 폴백)", () => {
    expect(effectiveGenerationTitle(null, null, CTX)).toBeNull();
  });
  it("공백만 있는 수동 제목은 규칙으로 폴백한다", () => {
    expect(effectiveGenerationTitle("   ", "강남 추천 운전학원", CTX)).toBe("강남 추천 운전학원");
  });
});

describe("db.updateSlotTitle 저장/삭제", () => {
  let db: import("../src/db.service.js").DbService;
  let tmp: string;
  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), "slot-title-"));
    process.env.SEO_DB_PATH = join(tmp, "admin.db");
    const { DbService } = await import("../src/db.service.js");
    db = new DbService();
    db.init();
    db.run("INSERT INTO domains (domain, display_name, vertical) VALUES ('d1','D1','driving')");
    db.run("INSERT INTO slots (slot_id, domain, template_id, primary_keyword, region, status) VALUES ('s1','d1','T01','강남 운전학원','강남','planned')");
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it("원문(플레이스홀더 포함)을 그대로 저장하고, 공백은 trim 한다", () => {
    db.updateSlotTitle("s1", "  {지역} 특집 {개수}  ");
    expect(db.getSlot("s1")?.title).toBe("{지역} 특집 {개수}");
  });
  it("빈 문자열/공백은 null 로 저장(규칙·LLM 폴백)", () => {
    db.updateSlotTitle("s1", "   ");
    expect(db.getSlot("s1")?.title ?? null).toBeNull();
    db.updateSlotTitle("s1", "임시");
    db.updateSlotTitle("s1", null);
    expect(db.getSlot("s1")?.title ?? null).toBeNull();
  });
});
