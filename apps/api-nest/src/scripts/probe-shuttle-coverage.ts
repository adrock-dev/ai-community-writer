// 조사용(읽기 전용): T01 후보로 실제 쓰이는 학원 중 셔틀 자료 보유 비율.
// "통학 가능 범위" 프레이밍이 근거를 가질 수 있는지 판단하는 데 쓴다.
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DbService } from "../db.service.js";
import { selectAcademiesForRegion } from "../academy-candidate-selection.js";

const db = new DbService();
(db as any).db = new DatabaseSync(resolve(process.argv[2] || "data/admin.db"), { readOnly: true });
const domain = "app.drivingplus.me";
const regions = db.all("SELECT DISTINCT region FROM slots WHERE domain=? AND template_id='T01' AND region IS NOT NULL", [domain]);

let total = 0, shuttle = 0, shuttleWithArea = 0, coords = 0;
const seen = new Set<string>();
for (const r of regions) {
  const sel = selectAcademiesForRegion(db as any, domain, String(r.region), 7, ["exam_academy", "academy"], 2);
  for (const a of sel.candidates) {
    const key = String(a.external_id || a.id || a.name);
    if (seen.has(key)) continue;
    seen.add(key);
    total++;
    const s = String(a.shuttle || "").trim();
    if (s.length > 8) shuttle++;
    if (/운행\s*지역/.test(s)) shuttleWithArea++;
    if (a.latitude != null && a.longitude != null) coords++;
  }
}
console.log(`T01 후보 학원 ${total}곳(중복 제거)`);
console.log(`  셔틀 자료 있음      : ${shuttle} (${Math.round(shuttle / total * 100)}%)`);
console.log(`  그중 '운행 지역' 명시: ${shuttleWithArea} (${Math.round(shuttleWithArea / total * 100)}%)`);
console.log(`  좌표 보유           : ${coords} (${Math.round(coords / total * 100)}%)`);
