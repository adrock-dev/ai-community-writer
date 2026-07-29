// T16 검증 대상 슬롯 탐색(읽기 전용): 후보 4곳↑ + 100자↑ 리뷰 보유 지역.
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DbService } from "../db.service.js";
import { academyMin, academyPool, getArchetype } from "../archetypes.js";
import { ACADEMY_USED_PER_POST } from "../constants.js";
import { selectAcademiesByDistance } from "../academy-candidate-selection.js";
import { selectedStudentReviewForAcademy } from "../academy-review-evidence.js";
const db = new DbService();
(db as any).db = new DatabaseSync(resolve(process.argv[2] || "data/admin.db"), { readOnly: true });
const domain = "app.drivingplus.me";
const arch = getArchetype("local_axis");
const pool = academyPool(arch), minR = academyMin(arch), used = Math.min(pool, ACADEMY_USED_PER_POST);
const slots: any[] = db.all("SELECT slot_id, region, persona, intent, modifier_1 FROM slots WHERE domain=? AND template_id='T16'", [domain]);
for (const s of slots) {
  const cands = selectAcademiesByDistance(db as any, domain, String(s.region), pool, ["exam_academy","academy"], minR).candidates.slice(0, used);
  if (cands.length < 4) continue;
  const longRev = cands.filter((a) => { const r = selectedStudentReviewForAcademy(a, String(s.slot_id)); return r && Array.from(r.quote).length >= 100; }).length;
  if (longRev >= 1) console.log(`${s.slot_id} | ${s.region} | 후보${cands.length} 100자+리뷰${longRev} | ${s.modifier_1}/${s.intent}`);
}
