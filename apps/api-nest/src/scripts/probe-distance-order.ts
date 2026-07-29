// 조사용(읽기 전용): "독자가 접근 가능한 거리" 관점에서 현재 후보 선택이 타당한지 본다.
// 현재 로직은 지역 문자열 매칭(direct)을 거리와 무관하게 먼저 채우므로,
// 지역 안의 먼 학원이 지역 밖의 가까운 학원보다 우선될 수 있다. 그 실제 발생량을 센다.
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DbService } from "../db.service.js";
import { academyMin, academyPool, getArchetype } from "../archetypes.js";
import { selectAcademiesForRegion } from "../academy-candidate-selection.js";

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

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

const regions: Row[] = only
  ? [{ region: only }]
  : db.all("SELECT DISTINCT region FROM slots WHERE domain=? AND template_id='T01' AND region IS NOT NULL", [domain]);

let inverted = 0, checked = 0, noCoord = 0;
for (const r of regions) {
  const region = String(r.region);
  const center = db.getSeoRegion(domain, region);
  const cLat = Number(center?.latitude), cLng = Number(center?.longitude);
  if (!Number.isFinite(cLat) || !Number.isFinite(cLng)) continue;
  const sel = selectAcademiesForRegion(db as any, domain, region, poolSize, types, minReq);
  const byId = new Map(sel.trace.mergedCandidatePool.map((c) => [c.academyId, c]));
  const rows = sel.candidates.map((a) => {
    // null 은 Number(null)===0 이라 isFinite 를 통과한다 → (0,0) 기준 13,000km 오탐이 났었다.
    const lat = a.latitude == null ? NaN : Number(a.latitude);
    const lng = a.longitude == null ? NaN : Number(a.longitude);
    const d = Number.isFinite(lat) && Number.isFinite(lng) ? haversineKm(cLat, cLng, lat, lng) : null;
    if (d === null) noCoord++;
    const t = byId.get(keyOf(a));
    return { name: String(a.name), km: d, inRegion: t?.retrievalSource === "stored_region_like", addr: String(a.address || "") };
  });
  checked++;
  // 지역 내 후보 중 가장 먼 것보다 더 가까운 지역 밖 후보가 있으면 "역전"
  const inK = rows.filter((x) => x.inRegion && x.km !== null).map((x) => x.km!);
  const outK = rows.filter((x) => !x.inRegion && x.km !== null).map((x) => x.km!);
  const isInverted = inK.length > 0 && outK.length > 0 && Math.min(...outK) < Math.max(...inK);
  if (isInverted) inverted++;
  if (only || isInverted) {
    console.log(`\n[${region}] ${isInverted ? "★ 역전" : ""}`);
    for (const x of rows.sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9))) {
      console.log(`  ${(x.km === null ? "  ?  " : x.km.toFixed(1).padStart(5))}km  ${x.inRegion ? "지역내" : "지역밖"}  ${x.name}  (${x.addr})`);
    }
  }
}
console.log(`\n요약: 검사 ${checked}개 지역 / 거리 역전 발생 ${inverted}개 / 좌표 없는 후보 ${noCoord}건`);
