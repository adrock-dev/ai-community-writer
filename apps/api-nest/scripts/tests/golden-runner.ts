// 골든 슬롯 러너 — 아키타입/글유형 리팩터의 "동작 불변" 회귀 테스트.
// 전 빌트인 글유형으로 슬롯을 생성해 golden-slots.json 과 완전 비교(0 diff 여야 통과).
// 사용:
//   npm run test:golden                                            # 비교. 불일치 시 유형별 요약 + exit 1
//   cd apps/api-nest && npx tsx scripts/tests/golden-runner.ts --verbose  # 위 + 개별 슬롯 diff 전체 출력
//   cd apps/api-nest && npx tsx scripts/tests/golden-runner.ts --update   # 골든 재생성(레시피/프리셋을 의도적으로 바꿨을 때만)
//
// 주의:
// - Db/Slot 서비스를 직접 인스턴스화(HTTP/포트 없음). 임시 DB 는 OS tmpdir 에 만든다(repo 오염 없음).
// - slot_id 는 sha1(domain|template_id|parts) 해시라 도메인 이름 "golden" 이 픽스처와 일치해야 한다.
// - 오버라이드/커스텀이 없는 이 도메인의 출력은 리졸버/배선을 바꿔도 골든과 100% 동일해야 한다.

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const dir = import.meta.dirname;
const GOLDEN = resolve(dir, "golden-slots.json");

// SEO_DB_PATH 는 DbService 생성 전에 설정해야 한다(생성자에서 path 를 읽음). 임시 DB 는 tmpdir 에.
const scratchDir = mkdtempSync(join(tmpdir(), "golden-run-"));
process.env.SEO_DB_PATH = join(scratchDir, "golden.db");

const { DbService } = await import("../../src/db.service.js");
const { SlotService } = await import("../../src/slot.service.js");
const { TEMPLATE_SPECS } = await import("../../src/constants.js");

const db = new DbService();
db.init();
db.createDomain({ domain: "golden", display_name: "golden", vertical: "driving", templates_enabled: JSON.stringify(Object.keys(TEMPLATE_SPECS)) });
const slots = new SlotService(db);
slots.applyPreset("golden", "driving");
slots.generateSlotsForDomain("golden", { templates: Object.keys(TEMPLATE_SPECS), maxPerTemplate: 40 });

const rows: any[] = db.all("SELECT slot_id, template_id, primary_keyword, region, persona, intent, modifier_1, modifier_2, priority_score FROM slots WHERE domain=?", ["golden"]);
const snap = rows
  .map((r) => ({ slot_id: r.slot_id, template_id: r.template_id, primary_keyword: r.primary_keyword, region: r.region, persona: r.persona, intent: r.intent, m1: r.modifier_1, m2: r.modifier_2, score: r.priority_score }))
  .sort((a, b) => (a.slot_id < b.slot_id ? -1 : 1));

if (process.argv.includes("--update")) {
  writeFileSync(GOLDEN, JSON.stringify(snap, null, 1) + "\n");
  console.log(`✅ 골든 재생성: ${snap.length} 슬롯 → ${GOLDEN}`);
  process.exit(0);
}

// 비교 — diff 를 유형(template_id)별로 집계해 요약 출력(어느 글유형이 바뀌었는지 한눈에).
// slot_id 는 `${template_id}_${hash}` 라 prefix 가 곧 유형. 개별 슬롯 diff 는 --verbose 로만.
const golden = JSON.parse(readFileSync(GOLDEN, "utf8"));
const j = (x: unknown) => JSON.stringify(x);
const verbose = process.argv.includes("--verbose");
const gm = new Map(golden.map((s: any) => [s.slot_id, s]));
const sm = new Map(snap.map((s) => [s.slot_id, s]));
const tidOf = (id: string) => id.split("_")[0] || "?";
const per: Record<string, { changed: number; removed: number; added: number }> = {};
const details: string[] = [];
let diff = 0;
const bump = (id: string, k: "changed" | "removed" | "added") => { (per[tidOf(id)] ??= { changed: 0, removed: 0, added: 0 })[k]++; diff++; };

if (snap.length !== golden.length) console.log(`ℹ️ 슬롯 수: 골든 ${golden.length} → 현재 ${snap.length}`);
for (const [id, g] of gm) {
  const s = sm.get(id);
  if (!s) { bump(id, "removed"); if (verbose) details.push(`- 삭제 ${id}: ${j(g)}`); }
  else if (j(g) !== j(s)) { bump(id, "changed"); if (verbose) details.push(`~ 변경 ${id}\n    골든: ${j(g)}\n    현재: ${j(s)}`); }
}
for (const id of sm.keys()) if (!gm.has(id)) { bump(id, "added"); if (verbose) details.push(`+ 신규 ${id}: ${j(sm.get(id))}`); }

if (diff === 0) {
  console.log(`✅ 골든 0-diff: ${snap.length} 슬롯 동작 불변`);
  process.exit(0);
}
console.log(`❌ 골든 불일치 ${diff}건 (유형별):`);
for (const t of Object.keys(per).sort()) {
  const p = per[t]!;
  const parts = [p.changed && `변경 ${p.changed}`, p.removed && `삭제 ${p.removed}`, p.added && `신규 ${p.added}`].filter(Boolean).join(", ");
  console.log(`  ${t}: ${parts}  (골든 ${golden.filter((s: any) => tidOf(s.slot_id) === t).length} → 현재 ${snap.filter((s) => tidOf(s.slot_id) === t).length})`);
}
console.log(verbose ? `\n${details.join("\n")}` : `\n(개별 슬롯 diff 는 --verbose 로)`);
console.log(`\n의도된 변경이면 --update, 아니면 회귀. (레시피/프리셋 안 바꿨는데 diff 면 버그.)`);
process.exit(1);
