// 조사용(읽기 전용, 임시 DB): 글유형별로 슬롯 축(persona/intent/modifier)이 몇 종류나 나오는지 센다.
// 축 분배 수정 전후를 같은 조건(골든과 동일: maxPerTemplate=40)에서 비교하는 데 쓴다.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SEO_DB_PATH = join(mkdtempSync(join(tmpdir(), "axis-spread-")), "probe.db");

const { DbService } = await import("../db.service.js");
const { SlotService } = await import("../slot.service.js");
const { TEMPLATE_SPECS } = await import("../constants.js");

const db = new DbService();
db.init();
db.createDomain({ domain: "golden", display_name: "golden", vertical: "driving", templates_enabled: JSON.stringify(Object.keys(TEMPLATE_SPECS)) });
const slots = new SlotService(db);
slots.applyPreset("golden", "driving");
slots.generateSlotsForDomain("golden", { templates: Object.keys(TEMPLATE_SPECS), maxPerTemplate: 40 });

type Row = Record<string, any>;
const rows: Row[] = db.all("SELECT template_id, persona, intent, modifier_1 m1, modifier_2 m2 FROM slots WHERE domain=?", ["golden"]);
console.log(`${"유형".padEnd(6)}${"슬롯".padStart(5)}${"persona".padStart(9)}${"intent".padStart(8)}${"mod조합".padStart(9)}`);
let dead = 0;
for (const templateId of [...new Set(rows.map((r) => String(r.template_id)))].sort()) {
  const group = rows.filter((r) => r.template_id === templateId);
  const personas = new Set(group.map((r) => String(r.persona))).size;
  const intents = new Set(group.map((r) => String(r.intent))).size;
  const mods = new Set(group.map((r) => `${r.m1}|${r.m2}`)).size;
  const flag = personas <= 1 && intents <= 1 && mods <= 1 ? "  ← 축 전멸" : "";
  if (flag) dead++;
  console.log(`${templateId.padEnd(6)}${String(group.length).padStart(5)}${String(personas).padStart(9)}${String(intents).padStart(8)}${String(mods).padStart(9)}${flag}`);
}
console.log(`\n총 ${rows.length}슬롯 / 축 전멸 유형 ${dead}개`);
