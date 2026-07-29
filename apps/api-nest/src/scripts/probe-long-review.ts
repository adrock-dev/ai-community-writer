// 일회성: 선택된 리뷰가 100자 이상인 학원을 찾아 말줄임 동작을 확인한다(읽기 전용).
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DbService } from "../db.service.js";
import { selectedStudentReviewForAcademy, studentReviewFactLines } from "../academy-review-evidence.js";
const db = new DbService();
(db as any).db = new DatabaseSync(resolve(process.argv[2] || "data/admin.db"), { readOnly: true });
const rows: any[] = db.all("SELECT * FROM academies WHERE review IS NOT NULL", []);
let found = 0;
for (const r of rows) {
  const rev = selectedStudentReviewForAcademy(r, "seed-1");
  if (rev && Array.from(rev.quote).length >= 100) {
    const line = studentReviewFactLines(r, "seed-1")[0]!;
    const quoted = line.match(/“([^”]*)”/)![1]!;
    console.log(`${r.name}: 원문 ${Array.from(rev.quote).length}자 → facts ${Array.from(quoted).length}자, 말줄임=${quoted.endsWith("…")}`);
    if (++found >= 3) break;
  }
}
if (!found) console.log("100자+ 선택 리뷰 없음");
