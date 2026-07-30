import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 슬롯 축 분배 + 지역 커버리지 회귀 가드.
 *
 * `interleaveByPrimary` 는 모든 그룹의 index 0 을 먼저 훑는다. 지역이 251곳인데 슬롯 상한이
 * 40이면 index 0 에서 상한이 차 index 1 에 도달하지 못한다. 이 구조가 두 가지 결함을 낳았고,
 * 이 파일은 둘 다 막는다.
 *
 * (1) 축 조합 쏠림 — 예전에는 모든 토픽이 같은 지점에서 축 조합 열거를 시작해, 그 index 0 이
 *     언제나 persona[0]·intent[0]·modifier[0] 이었다. 결과적으로 **전 슬롯이 동일한 축 조합**을
 *     가졌다(당시 실측: 골든 T01/T07/T14/T15 각 40건이 persona·intent·수식어 모두 1종류,
 *     운영 DB 의 T01 슬롯 100건도 100/100 동일). 축은 프롬프트에 들어가지만 값이 전부 같으면
 *     글을 구분하지 못한다 — 지역만 바뀐 비슷한 글이 나오던 구조적 원인이었다.
 *
 * (2) 지역 쏠림 — 인터리브 그룹이 지역이 아니라 **토픽**(지역 × keyword_filter)이었다. 키워드가
 *     3개면 한 지역이 그룹 3개를 차지해, 상한 40에 지역 14곳만 덮였다(골든 실측: T01/T07/T16
 *     40슬롯 14지역, T15 40슬롯 10지역). 게다가 slot_id 가 조합 해시라 「글 후보 만들기」를 다시
 *     눌러도 같은 지역만 재-upsert 돼 후보가 늘지 않았다. 지금은 지역으로 묶고 기존 슬롯이 적은
 *     지역부터 돌기 때문에, 같은 상한에서 지역 40곳이 덮이고 재실행이 다음 지역으로 확장된다.
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

  it("재생성해도 기존 슬롯은 사라지지 않는다 — 같은 조합이면 같은 slot_id(해시 결정적)", () => {
    // 예전 계약은 "재생성 결과가 완전히 동일"이었으나, 그건 상한에 걸린 지역이 영원히 후보를
    // 못 갖는다는 뜻이기도 했다. 지금은 재실행이 커버리지를 넓히므로 집합이 커질 수 있다.
    // 불변으로 남는 건 **기존 slot_id 의 유실이 없다**는 것이다.
    const before = rowsFor("T01").map((r) => String(r.slot_id));
    slots.generateSlotsForDomain("d", { templates: templateIds, maxPerTemplate: 40 });
    const after = new Set(rowsFor("T01").map((r) => String(r.slot_id)));
    expect(before.filter((id) => !after.has(id))).toEqual([]);
  });
});

/**
 * 지역 커버리지 — 지역 수가 상한보다 훨씬 많은 운영 상황을 재현한다.
 * 프리셋 지역은 19곳뿐이라 상한 40에 전부 덮여 (2)의 회귀가 드러나지 않는다.
 */
describe("지역 커버리지 (지역 수 ≫ 상한)", () => {
  // keyword_filter 가 여럿인 지역형 = 예전에 지역이 1/3~1/4로 줄어들던 유형들.
  const WIDE = ["T01", "T07", "T15", "T16"];
  const MAX = 40;
  let wideDb: import("../src/db.service.js").DbService;
  let wideSlots: import("../src/slot.service.js").SlotService;
  const regionsFor = (templateId: string): number =>
    Number(wideDb.get("SELECT COUNT(DISTINCT region) AS n FROM slots WHERE domain='wide' AND template_id=?", [templateId])?.n ?? 0);

  beforeAll(() => {
    wideDb = db;
    wideDb.createDomain({ domain: "wide", display_name: "wide", vertical: "driving", templates_enabled: JSON.stringify(WIDE) });
    wideSlots = slots;
    wideSlots.applyPreset("wide", "driving");
    // 운영 DB 재현: 지역 200곳, 전부 같은 weight·검색량 없음 → 정렬이 사실상 가나다순이 된다.
    const regions = Array.from({ length: 200 }, (_, i) => ({ value: `가상도 ${String(i).padStart(3, "0")}시`, weight: 5 }));
    wideDb.bulkReplaceAxis("wide", "region", regions);
    wideSlots.generateSlotsForDomain("wide", { templates: WIDE, maxPerTemplate: MAX });
  });

  it("상한만큼 만들면 그만큼의 지역이 덮인다 — 지역당 1개씩", () => {
    // 회귀 시 키워드 수만큼 나눠져 10~14 로 떨어진다.
    for (const templateId of WIDE) expect(regionsFor(templateId)).toBe(MAX);
  });

  it("다시 만들면 아직 후보가 없는 지역으로 확장된다", () => {
    const before = WIDE.map(regionsFor);
    wideSlots.generateSlotsForDomain("wide", { templates: WIDE, maxPerTemplate: MAX });
    // 예전에는 조합→해시가 결정적이라 같은 지역만 재-upsert 돼 지역 수가 그대로였다.
    for (const [i, templateId] of WIDE.entries()) expect(regionsFor(templateId)).toBe((before[i] ?? 0) + MAX);
  });
});
