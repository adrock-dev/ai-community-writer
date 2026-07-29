// 조사용(읽기 전용): T16 슬롯이 거리순 풀 7곳에서 어떤 5곳을 뽑는지 본다.
// T16 은 거리 단일 기준으로 후보를 고르는데, 그 뒤 seededCandidateSample 이 7→5 를
// 무작위로 줄인다. 가장 가까운 후보가 빠지는지 확인한다.
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DbService } from "../db.service.js";
import { academyMin, academyPool, getArchetype } from "../archetypes.js";
import { ACADEMY_USED_PER_POST } from "../constants.js";
import { selectAcademiesByDistance } from "../academy-candidate-selection.js";

type Row = Record<string, any>;
const db = new DbService();
(db as any).db = new DatabaseSync(resolve(process.argv[2] || "data/admin.db"), { readOnly: true });
const domain = "app.drivingplus.me";
const archetype = getArchetype("local_axis");
const poolSize = academyPool(archetype);
const used = Math.min(poolSize, ACADEMY_USED_PER_POST);
const keyOf = (a: Row) => String(a.external_id || a.id || a.name);

const slots: Row[] = db.all("SELECT slot_id, region FROM slots WHERE domain=? AND template_id='T16'", [domain]);
let full = 0, droppedNearest = 0, droppedTop2 = 0;
for (const slot of slots) {
  const pool = selectAcademiesByDistance(db as any, domain, String(slot.region), poolSize, ["exam_academy", "academy"], academyMin(archetype)).candidates;
  if (pool.length <= used) continue;
  full++;
  const picked = pool.slice(0, used); // 워커와 동일: T16 은 거리순 상위 N 을 결정적으로 쓴다
  const pickedKeys = new Set(picked.map(keyOf));
  const missing = pool.filter((a) => !pickedKeys.has(keyOf(a)));
  const nearestDropped = !pickedKeys.has(keyOf(pool[0]!));
  const top2Dropped = nearestDropped || !pickedKeys.has(keyOf(pool[1]!));
  if (nearestDropped) droppedNearest++;
  if (top2Dropped) droppedTop2++;
  if (nearestDropped) {
    console.log(`[${slot.region}] 풀 ${pool.length}곳 → ${used}곳`);
    console.log(`   최근접 제외: ${pool[0]!.name} (${pool[0]!.distance_km}km)`);
    console.log(`   빠진 후보  : ${missing.map((a) => `${a.name}(${a.distance_km}km)`).join(", ")}`);
    console.log(`   실제 사용  : ${picked.map((a) => `${a.distance_km}km`).join(", ")}`);
  }
}
console.log(`\n검사 슬롯 ${slots.length}건 / 풀이 ${used}곳 초과 ${full}건 / 최근접 탈락 ${droppedNearest}건 / 1~2위 탈락 ${droppedTop2}건`);
