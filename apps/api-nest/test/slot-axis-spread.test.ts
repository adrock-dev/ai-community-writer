import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 슬롯 축 분배 회귀 가드.
 *
 * `interleaveByPrimary` 는 모든 토픽 그룹의 index 0 을 먼저 훑는다. 지역이 251곳인데 슬롯 상한이
 * 40이면 index 0 에서 상한이 차 index 1 에 도달하지 못한다. 예전에는 모든 토픽이 같은 지점에서
 * 축 조합 열거를 시작해, 그 index 0 이 언제나 persona[0]·intent[0]·modifier[0] 이었다.
 * 결과적으로 **전 슬롯이 동일한 축 조합**을 가졌다(당시 실측: 골든 T01/T07/T14/T15 각 40건이
 * persona·intent·수식어 모두 1종류, 운영 DB 의 T01 슬롯 100건도 100/100 동일).
 *
 * 축은 프롬프트에 들어가지만 값이 전부 같으면 글을 구분하지 못한다 — 지역만 바뀐 비슷한 글이
 * 나오던 구조적 원인이었다. 이 테스트는 그 상태로 되돌아가는 것을 막는다.
 */

let db: import("../src/db.service.js").DbService;
let slots: import("../src/slot.service.js").SlotService;
let templateIds: string[];
let tmp: string;

type Row = Record<string, any>;
const axisKey = (row: Row) => `${row.persona}|${row.intent}|${row.modifier_1}|${row.modifier_2}`;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "slot-axis-"));
  process.env.SEO_DB_PATH = join(tmp, "admin.db");
  const { DbService } = await import("../src/db.service.js");
  const { SlotService } = await import("../src/slot.service.js");
  const { TEMPLATE_SPECS } = await import("../src/constants.js");
  templateIds = Object.keys(TEMPLATE_SPECS);
  db = new DbService();
  db.init();
  db.createDomain({ domain: "d", display_name: "d", vertical: "driving", templates_enabled: JSON.stringify(templateIds) });
  slots = new SlotService(db);
  slots.applyPreset("d", "driving");
  // 골든과 동일 조건: 토픽(지역) 수가 상한보다 훨씬 많아 index 0 만 소비되는 상황을 재현한다.
  slots.generateSlotsForDomain("d", { templates: templateIds, maxPerTemplate: 40 });
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const rowsFor = (templateId: string): Row[] =>
  db.all("SELECT persona, intent, modifier_1, modifier_2, slot_id FROM slots WHERE domain='d' AND template_id=?", [templateId]);

describe("슬롯 축 분배", () => {
  it("축 값을 여럿 가진 글유형은 전 슬롯이 같은 조합이 되지 않는다", () => {
    // 축 풀이 실제로 2개 이상인 유형만 검사한다(modifier_count:0 / use_persona:false 등 정의상
    // 축이 없는 유형은 1종류가 정상이므로 여기서 요구하지 않는다).
    const offenders: string[] = [];
    for (const templateId of templateIds) {
      const rows = rowsFor(templateId);
      if (rows.length < 5) continue;
      if (new Set(rows.map(axisKey)).size === 1) offenders.push(`${templateId}(${rows.length}슬롯)`);
    }
    expect(offenders).toEqual([]);
  });

  it("T01 은 지역 수가 상한보다 많아도 persona·수식어가 실제로 퍼진다", () => {
    const rows = rowsFor("T01");
    expect(rows.length).toBeGreaterThan(10);
    // 회귀 시 1이 된다. 여유를 두되 '한 자릿수 초반'에서 막히지 않도록 하한을 둔다.
    expect(new Set(rows.map((r) => String(r.persona))).size).toBeGreaterThan(5);
    expect(new Set(rows.map((r) => `${r.modifier_1}|${r.modifier_2}`)).size).toBeGreaterThan(5);
  });

  it("재생성해도 같은 slot_id 가 나온다 — 축 시작점이 해시 기반이라 결정적", () => {
    const before = rowsFor("T01").map((r) => String(r.slot_id)).sort();
    slots.generateSlotsForDomain("d", { templates: templateIds, maxPerTemplate: 40 });
    const after = rowsFor("T01").map((r) => String(r.slot_id)).sort();
    expect(after).toEqual(before);
  });
});
