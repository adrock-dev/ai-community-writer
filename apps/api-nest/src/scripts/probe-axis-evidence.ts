// 조사용(읽기 전용): T01 후보로 쓰이는 학원들이 축별로 어떤 근거 데이터를 갖고 있는지 센다.
// 제목 부제·비교표 열을 축으로 고를 때 "facts 게이팅" 임계를 정하는 근거.
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DbService } from "../db.service.js";
import { selectAcademiesForRegion } from "../academy-candidate-selection.js";

type Row = Record<string, any>;
const db = new DbService();
(db as any).db = new DatabaseSync(resolve(process.argv[2] || "data/admin.db"), { readOnly: true });
const domain = "app.drivingplus.me";
// 슬롯이 아니라 '지역 축' 전체를 본다. 슬롯은 언제든 비워질 수 있고(실제로 비어 있었다),
// 우리가 알고 싶은 건 "이 도메인이 만들 수 있는 글 전체"의 근거 보유율이기 때문이다.
const regions: Row[] = db.all("SELECT value AS region FROM axes WHERE domain=? AND axis='region'", [domain]);

const dims: Array<[string, (a: Row) => boolean]> = [
  ["수강료(price)", (a) => String(a.price || "").trim().length > 8],
  ["운영 과정(license)", (a) => String(a.extra || "").includes("license_types")],
  ["운영 형태(type)", (a) => String(a.academy_type || "").trim().length > 0],
  ["영업시간(hours)", (a) => String(a.hours || "").trim().length > 8],
  ["셔틀(shuttle)", (a) => String(a.shuttle || "").trim().length > 8],
  ["  └ 운행지역 명시", (a) => /운행\s*지역/.test(String(a.shuttle || ""))],
  ["수강생 리뷰(review)", (a) => String(a.review || "").trim().length > 8],
  ["사진(photos)", (a) => String(a.photos || a.thumb_url || "").trim().length > 8],
];

// (1) 후보 학원 단위 보유율
const seen = new Map<string, Row>();
// (2) 슬롯(지역) 단위 — 후보 5곳 중 2곳 이상 보유해야 그 축을 제목/비교표에 쓸 수 있다
const perRegion: number[][] = dims.map(() => []);
for (const r of regions) {
  const sel = selectAcademiesForRegion(db as any, domain, String(r.region), 7, ["exam_academy", "academy"], 2);
  const used = sel.candidates.slice(0, 5);
  if (!used.length) continue;
  for (const a of used) seen.set(String(a.external_id || a.id || a.name), a);
  dims.forEach(([, has], i) => perRegion[i]!.push(used.filter(has).length));
}

const academies = [...seen.values()];
console.log(`후보 학원 ${academies.length}곳 · 지역 ${perRegion[0]!.length}곳\n`);
console.log(`${"근거 축".padEnd(22)}${"학원 보유율".padStart(12)}${"지역 중 2곳↑ 보유".padStart(18)}`);
dims.forEach(([label, has], i) => {
  const own = academies.filter(has).length;
  const usable = perRegion[i]!.filter((n) => n >= 2).length;
  const pctOwn = Math.round(own / academies.length * 100);
  const pctUsable = Math.round(usable / perRegion[i]!.length * 100);
  console.log(`${label.padEnd(22)}${`${own} (${pctOwn}%)`.padStart(12)}${`${usable}/${perRegion[i]!.length} (${pctUsable}%)`.padStart(18)}`);
});
