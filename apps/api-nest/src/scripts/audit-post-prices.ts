/**
 * 발행 글의 금액을 그 글이 실제로 받은 facts 로 재구성해 대조한다(읽기 전용).
 * fabricated_price_amount 게이트의 오탐/정탐을 실데이터로 확인하는 용도.
 */
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DbService } from "../db.service.js";
import { getArchetype } from "../archetypes.js";
import { fabricatedPriceAmounts, priceAmountsIn } from "../quality-gate.js";

type Row = Record<string, any>;
const args = new Map(process.argv.slice(2).flatMap((v, i, all) => (v.startsWith("--") ? [[v.slice(2), all[i + 1] || ""]] : [])));
const readonly = new DatabaseSync(resolve(args.get("db") || "data/admin.db"), { readOnly: true });
const db = new DbService();
(db as any).db = readonly;
const worker: any = new (await import("../worker.service.js")).WorkerService(db, {} as never);

const posts = db.all("SELECT id, domain, model, slot_id, body_markdown FROM posts WHERE status<>'deleted' ORDER BY generated_at");
let flagged = 0;
for (const post of posts as Row[]) {
  const slot = db.getSlot(String(post.slot_id));
  if (!slot) { console.log(`${String(post.id).slice(0, 8)} 슬롯 없음 — 건너뜀`); continue; }
  const spec: Row = db.getTemplateSpec(String(post.domain), String(slot.template_id)) || {};
  const archetype = getArchetype(spec.kind ?? "");
  const academyTypes: string[] = worker.resolveAcademyTypes(spec);
  const facts = worker.buildFacts(String(post.domain), slot, { maxAcademyImages: 5, perAcademyImages: 1 }, academyTypes, archetype);
  const bad = fabricatedPriceAmounts(String(post.body_markdown), String(facts.text));
  if (bad.length) flagged++;
  console.log(
    `${String(post.id).slice(0, 8)} ${String(post.model).replace("gpt-5.6-", "").padEnd(6)} ${String(slot.region).split(" ").pop()?.padEnd(6)}`
    + ` 본문 금액 ${priceAmountsIn(String(post.body_markdown)).size}종 · facts 금액 ${priceAmountsIn(String(facts.text)).size}종`
    + ` → ${bad.length ? `❌ ${bad.map((a) => a.toLocaleString("en-US")).join(", ")}` : "✅ 이상 없음"}`,
  );
}
console.log(`\n검사 ${posts.length}건 · 지적 ${flagged}건`);
readonly.close();
