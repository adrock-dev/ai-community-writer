// 조사용(읽기 전용): T01 후보가 어떤 내부 규칙으로 편입됐는지, 지역 밖 후보가 몇 곳인지 본다.
// selectAcademiesForRegion 의 trace(inclusionReason·straightLineDistanceKm)를 그대로 출력한다.
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DbService } from "../db.service.js";
import { academyMin, academyPool, getArchetype } from "../archetypes.js";
import { ACADEMY_USED_PER_POST } from "../constants.js";
import { selectAcademiesForRegion, seededCandidateSample } from "../academy-candidate-selection.js";

type Row = Record<string, any>;
const args = new Map(process.argv.slice(2).flatMap((v, i, all) => (v.startsWith("--") ? [[v.slice(2), all[i + 1] || ""]] : [])));
const db = new DbService();
(db as any).db = new DatabaseSync(resolve(args.get("db") || "data/admin.db"), { readOnly: true });
const domain = args.get("domain") || "app.drivingplus.me";
const only = args.get("region") || "";

const archetype = getArchetype("local");
const poolSize = academyPool(archetype);
const minReq = academyMin(archetype);
const types = ["exam_academy", "academy"];
const keyOf = (a: Row) => String(a.external_id || a.id || a.name);

const slots: Row[] = only
  ? db.all("SELECT slot_id, region FROM slots WHERE domain=? AND template_id='T01' AND region=? LIMIT 1", [domain, only])
  : db.all("SELECT MIN(slot_id) slot_id, region FROM slots WHERE domain=? AND template_id='T01' AND region IS NOT NULL GROUP BY region", [domain]);

let totalOutside = 0, slotsWithOutside = 0, unbounded = 0;
for (const slot of slots) {
  const region = String(slot.region);
  const sel = selectAcademiesForRegion(db as any, domain, region, poolSize, types, minReq);
  const used = seededCandidateSample(sel.candidates, Math.min(poolSize, ACADEMY_USED_PER_POST), String(slot.slot_id));
  const byId = new Map(sel.trace.mergedCandidatePool.map((c) => [c.academyId, c]));
  const rows = used.map((a) => byId.get(keyOf(a))).filter(Boolean) as any[];
  const outside = rows.filter((c) => c.inclusionReason !== "region_like_query" && c.inclusionReason !== "stored_region_exact" && c.inclusionReason !== "address_contains_target");
  // 거리 상한 없이 들어온 후보가 있는가(사용자 요건: 지역 밖은 반드시 거리 기준이어야 함)
  const noDistance = outside.filter((c) => c.straightLineDistanceKm === null);
  totalOutside += outside.length;
  if (outside.length) slotsWithOutside++;
  unbounded += noDistance.length;
  if (only || outside.length) {
    console.log(`\n[${region}] 사용 ${used.length}곳 · 지역 밖 ${outside.length}곳`);
    for (const c of rows) {
      const d = c.straightLineDistanceKm === null ? "  -  " : `${String(c.straightLineDistanceKm).padStart(5)}km`;
      console.log(`   ${d}  ${c.inclusionReason.padEnd(26)} ${c.academyName}  (${c.address || c.storedRegion})`);
    }
  }
}
console.log(`\n요약: 지역 ${slots.length}곳 / 지역 밖 후보를 쓴 슬롯 ${slotsWithOutside}곳 / 지역 밖 후보 총 ${totalOutside}건 / 거리 미상 편입 ${unbounded}건`);
