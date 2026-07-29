import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TITLE_RULES } from "../src/constants.js";

// 커스텀 글유형 제목 규칙(title_rule) — DB 컬럼/CRUD/클론 상속/정규화.
// 빌트인은 TITLE_RULES 맵, 커스텀은 custom_templates.title_rule(JSON). getTemplateSpec 이 둘을 동일 shape 로 노출.

let db: import("../src/db.service.js").DbService;
let tmp: string;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "titlerule-"));
  process.env.SEO_DB_PATH = join(tmp, "admin.db");
  const { DbService } = await import("../src/db.service.js");
  db = new DbService();
  db.init();
  db.run("INSERT INTO domains (domain, display_name, vertical) VALUES ('d1','D1','driving')");
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("빌트인 제목 규칙 노출", () => {
  it("getTemplateSpec 이 빌트인 title_rule 을 TITLE_RULES 에서 실어 반환한다", () => {
    const spec = db.getTemplateSpec("d1", "T01");
    expect(spec?.title_rule).toEqual(TITLE_RULES.T01);
  });
  it("규칙 없는 빌트인은 title_rule 이 undefined 다", () => {
    const spec = db.getTemplateSpec("d1", "T03"); // guide — TITLE_RULES 에 없음
    expect(spec?.title_rule).toBeUndefined();
  });
});

describe("커스텀 title_rule 저장·정규화", () => {
  it("생성 시 무효 tier 제거 + min_count 내림차순 + min_generate/fallback 보존", () => {
    const created = db.createCustomTemplate("d1", {
      name: "비교형", kind: "local",
      title_rule: { min_generate: 2, tiers: [{ min_count: 2, template: "{지역} 추천" }, { min_count: 3, template: "{지역} BEST {개수}" }, { template: "무효" }], fallback: "폴백" },
    });
    const spec = db.getTemplateSpec("d1", String(created.template_id));
    expect(spec?.title_rule?.tiers).toEqual([
      { min_count: 3, template: "{지역} BEST {개수}" },
      { min_count: 2, template: "{지역} 추천" },
    ]);
    expect(spec?.title_rule?.min_generate).toBe(2);
    expect(spec?.title_rule?.fallback).toBe("폴백");
  });

  it("title_rule 미지정이면 undefined(LLM H1 폴백 유지)", () => {
    const created = db.createCustomTemplate("d1", { name: "규칙없음", kind: "guide" });
    expect(db.getTemplateSpec("d1", String(created.template_id))?.title_rule).toBeUndefined();
  });

  it("update 로 규칙 교체 / 빈 tiers 는 null(규칙 제거)", () => {
    const created = db.createCustomTemplate("d1", { name: "수정대상", kind: "local", title_rule: { tiers: [{ min_count: 1, template: "A" }] } });
    const id = String(created.template_id);
    db.updateCustomTemplate("d1", id, { title_rule: { tiers: [{ min_count: 2, template: "{지역} 단독" }] } });
    expect(db.getTemplateSpec("d1", id)?.title_rule?.tiers[0]?.template).toBe("{지역} 단독");
    db.updateCustomTemplate("d1", id, { title_rule: { tiers: [] } });
    expect(db.getTemplateSpec("d1", id)?.title_rule).toBeUndefined();
  });
});

describe("클론 상속", () => {
  it("빌트인 유효 규칙을 새 커스텀에 굳혀 복사하면 상속된다", () => {
    // 컨트롤러 clone 경로 = getTemplateSpec(source).title_rule 을 createCustomTemplate input 으로 전달.
    const src = db.getTemplateSpec("d1", "T14")!;
    const clone = db.createCustomTemplate("d1", { name: "T14클론", kind: src.kind, title_rule: src.title_rule });
    expect(db.getTemplateSpec("d1", String(clone.template_id))?.title_rule).toEqual(TITLE_RULES.T14);
  });
});

describe("목록 출력", () => {
  it("listCustomTemplates 출력에 파싱된 title_rule 이 포함된다", () => {
    const created = db.createCustomTemplate("d1", { name: "목록확인", kind: "local", title_rule: { tiers: [{ min_count: 1, template: "{지역}" }] } });
    const row = db.listCustomTemplates("d1").find((r) => r.template_id === created.template_id);
    expect((row?.title_rule as { tiers?: unknown[] } | undefined)?.tiers).toHaveLength(1);
  });
});
