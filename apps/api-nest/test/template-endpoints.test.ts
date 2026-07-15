import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TITLE_RULES } from "../src/constants.js";

// 템플릿 저작 플로우의 '경계' 회귀 테스트 — 단위/골든이 못 잡는 계약·직렬화 왕복 버그를 잠근다.
//  1) 빌트인 title_rule 계약: /options 와 /templates 가 '둘 다' title_rule 을 노출해야 한다
//     (한쪽만 병합해 시작점 프리필이 비던 드리프트 방지).
//  2) export↔import 왕복: title_rule·primary_override 가 왕복에서 유실되면 안 된다
//     (export 투영 누락 / import 컬럼 불일치 방지).

// checkAuth 는 ADMIN_PASSWORD 미설정 시 no-op — vitest 는 .env 를 로드하지 않으므로 인증 없이 컨트롤러 호출 가능.
const REQ = { headers: {} } as any;

let db: import("../src/db.service.js").DbService;
let ctl: import("../src/admin.controller.js").AdminController;
let tmp: string;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "tpl-endpoints-"));
  process.env.SEO_DB_PATH = join(tmp, "admin.db");
  const { DbService } = await import("../src/db.service.js");
  const { AdminController } = await import("../src/admin.controller.js");
  db = new DbService();
  db.init();
  // options()/listTemplates()/export/import 는 this.db 만 사용 — slots/drivingplus 는 미사용이라 스텁.
  ctl = new AdminController(db, {} as never, {} as never);
  db.run("INSERT INTO domains (domain, display_name, vertical) VALUES ('d1','D1','driving')");
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("빌트인 title_rule 엔드포인트 계약", () => {
  it("/options 의 template_specs 가 빌트인 title_rule 을 노출한다", () => {
    const opts = ctl.options(REQ, {}) as any;
    expect(opts.template_specs.T01.title_rule).toEqual(TITLE_RULES.T01);
    expect(opts.template_specs.T03.title_rule).toBeNull(); // 규칙 없는 유형은 null
  });

  it("/options 가 archetype_structure_variants(kind→라벨)를 노출한다", () => {
    const opts = ctl.options(REQ, {}) as any;
    expect(opts.archetype_structure_variants.local).toContain("비교표 우선");
    expect(opts.archetype_structure_variants.local.length).toBeGreaterThanOrEqual(3);
    expect(opts.archetype_structure_variants.local_single.length).toBeGreaterThanOrEqual(3);
    expect(opts.archetype_structure_variants.local_hub.length).toBeGreaterThanOrEqual(3);
    expect(opts.archetype_structure_variants.compare).toBeUndefined(); // 변형 없는 아키타입은 키 없음
  });

  it("/templates 의 builtin 이 빌트인 title_rule 을 노출한다", () => {
    const list = ctl.listTemplates(REQ, {}, "d1") as any;
    const t01 = list.builtin.find((b: any) => b.template_id === "T01");
    const t03 = list.builtin.find((b: any) => b.template_id === "T03");
    expect(t01.title_rule).toEqual(TITLE_RULES.T01);
    expect(t03.title_rule).toBeNull();
  });

  it("두 엔드포인트의 빌트인 title_rule 이 서로 일치한다(드리프트 없음)", () => {
    const opts = ctl.options(REQ, {}) as any;
    const list = ctl.listTemplates(REQ, {}, "d1") as any;
    for (const id of Object.keys(TITLE_RULES)) {
      const fromList = list.builtin.find((b: any) => b.template_id === id)?.title_rule;
      expect(opts.template_specs[id].title_rule).toEqual(fromList);
    }
  });
});

describe("export ↔ import 왕복", () => {
  it("title_rule·primary_override 가 왕복에서 보존된다", () => {
    // 커스텀 생성(제목 규칙 + 주축 재정의 포함)
    const created = db.createCustomTemplate("d1", {
      name: "왕복대상", kind: "local", primary_override: "region",
      title_rule: { min_generate: 2, tiers: [{ min_count: 3, template: "{지역} BEST {개수}" }, { min_count: 2, template: "{지역} 추천" }], fallback: "폴백" },
    });
    const id = String(created.template_id);

    // export → 봉투에 title_rule 이 실려야 한다(투영 누락 방지)
    const env = ctl.exportTemplates(REQ, {}, "d1") as any;
    const exported = env.custom_templates.find((t: any) => t.template_id === id);
    expect(exported.title_rule?.tiers).toHaveLength(2);
    expect(exported.primary_override).toBe("region");

    // 원본 삭제 후 import(replace) → 컬럼 정합·필드 보존 확인
    db.deleteCustomTemplate("d1", id);
    expect(db.getCustomTemplate("d1", id)).toBeUndefined();
    const res = ctl.importTemplates(REQ, {}, "d1", { mode: "replace" }, env) as any;
    expect(res.ok).toBe(true);

    const back = db.getTemplateSpec("d1", id);
    expect(back?.title_rule).toEqual(created.title_rule); // 정규화 형태 그대로 왕복
    expect(back?.primary_override).toBe("region");
  });
});
