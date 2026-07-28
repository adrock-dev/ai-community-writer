import "reflect-metadata";
import { AcademyResearchDbService } from "./academy-research-db.service.js";
import { fieldTypeIssues } from "./academy-research-grounding.js";
import { usableInArticle } from "./academy-research-article-fields.js";

/**
 * 이미 저장된 조사값을 **지금 기준으로** 다시 검사한다.
 *
 *   npm run research:recheck            # 검사만(무엇이 걸리는지 보기)
 *   npm run research:recheck -- --apply # 걸린 값을 needs_review 로 내리기
 *
 * 검사 규칙은 계속 바뀐다 — 오탐을 고치거나(2026-07-27~28 에만 네 부류) 새 위험 표현을
 * 추가할 때마다 바뀐다. 그런데 검사는 **조사하는 순간에만** 돌기 때문에, 규칙이 바뀌어도
 * 이미 저장된 값은 옛 판정을 그대로 달고 있다. 실제로 근거 검사가 붙기 전(2026-07-27)에
 * 조사된 7곳은 아무 검사도 받지 않았고, 그중 #612 에 학원 홍보문구가 ai_draft 로 남아
 * 「AI 초안까지」 설정이면 글에 닿을 상태였다.
 *
 * 전량 재조사(1곳당 2~3분 × LLM 비용)와 달리 이 재검사는 LLM 을 부르지 않는다.
 * 규칙만 다시 대보므로 수백 곳이 몇 초에 끝난다.
 *
 * 내리기만 하고 올리지는 않는다. 규칙이 느슨해졌다고 needs_review 를 자동으로 통과시키면
 * 사람이 「검토 필요」로 판단해 둔 것까지 되돌아간다 — 승인은 언제나 사람의 몫이다.
 */
const apply = process.argv.includes("--apply");

const db = new AcademyResearchDbService();
await db.onModuleInit();

const rows = db.all("SELECT * FROM academy_research WHERE researched_at IS NOT NULL");
const status = new Map<string, string>();
for (const m of db.all("SELECT external_id, field_key, status FROM academy_field_meta")) {
  status.set(`${m.external_id}|${m.field_key}`, String(m.status ?? ""));
}

type Hit = { externalId: string; field: string; status: string; issue: string; value: string };
const hits: Hit[] = [];
for (const row of rows) {
  for (const [field, value] of Object.entries(row)) {
    if (value == null || String(value).trim() === "") continue;
    // 글에 나갈 수 없는 필드는 어차피 차단되므로 굳이 상태를 건드리지 않는다.
    if (!usableInArticle(field)) continue;
    const current = status.get(`${row.external_id}|${field}`) ?? "";
    // 이미 검토 필요·차단이면 글에 안 나간다. 문제는 통과 상태로 남은 값이다.
    if (current !== "ai_draft" && current !== "verified") continue;
    for (const issue of fieldTypeIssues(field, String(value))) {
      hits.push({ externalId: String(row.external_id), field, status: current, issue, value: String(value).slice(0, 100) });
    }
  }
}

console.log(`조사 완료 ${rows.length}곳 · 지금 기준으로 결함이 잡히는 값 ${hits.length}건\n`);
const byIssue = new Map<string, number>();
for (const h of hits) byIssue.set(h.issue, (byIssue.get(h.issue) ?? 0) + 1);
for (const [issue, n] of [...byIssue.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}건  ${issue}`);
if (hits.length) console.log("");
for (const h of hits.slice(0, 30)) console.log(`  #${h.externalId} ${h.field} [${h.status}] ${h.issue}\n      "${h.value}"`);
if (hits.length > 30) console.log(`  … 외 ${hits.length - 30}건`);

if (!hits.length) {
  console.log("\n내릴 것이 없습니다.");
} else if (!apply) {
  console.log(`\n검사만 했습니다. 실제로 내리려면 --apply 를 붙이세요.`);
} else {
  for (const h of hits) {
    db.setFieldMeta(h.externalId, h.field, { status: "needs_review", note: `재검사: ${h.issue}` });
  }
  console.log(`\n${hits.length}건을 「검토 필요」로 내렸습니다. 검토 대기 화면에서 확인하세요.`);
}
