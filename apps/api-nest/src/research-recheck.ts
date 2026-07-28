import "reflect-metadata";
import { AcademyResearchDbService } from "./academy-research-db.service.js";
import { extractClaims, fieldTypeIssues, isNonClaimValue } from "./academy-research-grounding.js";
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
// 반대 방향: 옛 규칙에 걸려 needs_review 로 굳은 값을 지금 규칙으로 다시 봐 풀어 준다.
const release = process.argv.includes("--release");

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

/**
 * needs_review 를 되돌린다 — 단, **지금 규칙으로 다시 판정할 수 있는 지적만.**
 *
 * 규칙은 오탐을 고치며 느슨해지기도 한다("최대 수용 가능 인원 4명" 을 광고로 잡던 것을
 * 2026-07-28 에 풀었다). 그런데 그 전에 조사된 값은 사유만 낡은 채 needs_review 로 굳어
 * 승인 대상에서 빠져 있다.
 *
 * 소스에 근거가 있는지 보는 지적(「수집 소스에 …」·「소스에서 확인 안 됨」)은 건드리지 않는다.
 * 수집한 소스 원문을 저장하지 않기 때문에 지금 다시 판정할 방법이 없다 — 그건 재조사해야
 * 다시 판정된다. 사람이 needs_review 로 내린 것도 마찬가지로 두어야 하는데, 현재 그 구분이
 * 없으므로(verified_by 가 비어 있다) 소스 무관 지적만 푸는 것이 그 대용이기도 하다.
 */
function releaseStaleFindings(): void {
  const released: Array<{ externalId: string; field: string; note: string }> = [];
  for (const row of db.all("SELECT external_id, field_key, note FROM academy_field_meta WHERE status='needs_review'")) {
    const field = String(row.field_key);
    const note = String(row.note ?? "");
    const value = String(db.getResearch(String(row.external_id))?.[field] ?? "").trim();
    // 소스를 봐야 판정되는 지적은 원칙적으로 재평가 불가다(소스 원문을 저장하지 않는다).
    // 다만 소스 없이 확정할 수 있는 면제가 둘 있고, 둘 다 그 면제가 생기기 전에 걸린 값이 남아 있다.
    //
    //  a) "모름·없음" 값 — 근거를 요구할 대상이 아니다(isNonClaimValue).
    //  b) 숫자 클레임이 전부 소스에서 확인된 값 — 사유에 「소스에서 확인 안 됨」이 없다는 것은
    //     기록 시점에 클레임이 모두 확인됐다는 뜻이다. 그러면 지금 코드가 면제한다.
    //     예: night_class 에 "야간" 이라 단정하지 않고 "교육시간표 11부 18:10~19:00" 이라 적은 값.
    //     시각이 소스에 있으니 근거가 있는 것인데, "야간" 이 없다고 지적하면 정직하게 답할수록
    //     걸리는 규칙이 된다.
    const groundedClaimExempt = extractClaims(value).length > 0 && !note.includes("소스에서 확인 안 됨");
    if (note.includes("소스") && !isNonClaimValue(value) && !groundedClaimExempt) continue;
    // 값이 비었으면 지적할 대상 자체가 없다(재조사에서 지워진 자리).
    if (value && fieldTypeIssues(field, value).length) continue;
    released.push({ externalId: String(row.external_id), field, note });
  }
  console.log(`\n지금 규칙으로는 걸리지 않는 needs_review ${released.length}건`);
  for (const x of released.slice(0, 30)) console.log(`  #${x.externalId} ${x.field} — 옛 사유: ${x.note || "(없음)"}`);
  if (released.length > 30) console.log(`  … 외 ${released.length - 30}건`);
  if (!released.length) return;
  if (!apply) { console.log("\n검사만 했습니다. 실제로 풀려면 --apply 를 함께 붙이세요."); return; }
  for (const x of released) {
    db.setFieldMeta(x.externalId, x.field, { status: "ai_draft", note: "" });
  }
  console.log(`\n${released.length}건을 「AI 초안」으로 되돌렸습니다. 검토 대기에서 다시 보입니다.`);
}

if (release) releaseStaleFindings();

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
