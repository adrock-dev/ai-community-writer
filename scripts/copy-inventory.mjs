#!/usr/bin/env node
// 관리자 UI 안내멘트 인벤토리.
//
// 왜 필요한가: 안내멘트는 대부분 "코드가 강제하는 사실"의 사본이다. 사본은 원본이 바뀌면 썩는다.
// 어떤 문장이 어떤 코드에 종속되는지 목록이 없으면, 코드를 고칠 때 무엇을 같이 고쳐야 하는지 알 수 없다.
// 이 스크립트가 그 목록을 매번 다시 뽑는다(문서로 적어두면 문서가 또 썩으므로 생성물로 둔다).
//
// 분류(scripts/ui-copy-classification.json 에서 사람이 지정):
//   A 파생 가능 — 코드 상수/설정에서 계산할 수 있는데 손으로 적은 수치·목록. 재서술을 없애야 한다.
//   B 동작 계약 — 코드가 강제하는 규칙의 서술. 원본이 바뀌면 반드시 같이 고쳐야 한다.
//   C 순수 안내 — 흐름·톤·빈 상태 문구. 기계 검증 대상이 아니다.
//
// 사용:
//   node scripts/copy-inventory.mjs            # docs/ui-copy-inventory.md 갱신 + 요약 출력
//   node scripts/copy-inventory.mjs --json     # 인벤토리를 JSON 으로 출력
//   node scripts/copy-inventory.mjs --untagged # 분류가 비어 있는 A/B 후보만 출력
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLASSIFICATION = `${ROOT}/scripts/ui-copy-classification.json`;
const OUT_DOC = `${ROOT}/docs/ui-copy-inventory.md`;
const SCAN_DIRS = ["apps/admin-next/components", "apps/admin-next/app"];

const hcount = (s) => (s.match(/[가-힣]/g) || []).length;
const norm = (s) => s.replace(/\s+/g, " ").trim();
const idOf = (text) => createHash("sha1").update(norm(text).replace(/[\s·「」…—]/g, "")).digest("hex").slice(0, 10);

function collect() {
  const files = execSync(
    `cd ${ROOT} && find ${SCAN_DIRS.join(" ")} -name '*.tsx' | grep -v node_modules`,
    { encoding: "utf8" },
  ).trim().split("\n").filter(Boolean).sort();

  const rows = [];
  const push = (file, index, src, carrier, text) => {
    // JSX 주석은 화면에 안 나온다 — 안내멘트 본문으로 섞이면 인벤토리가 코드 주석을 카피로 센다.
    const t = norm(text.replace(/\{\/\*[\s\S]*?\*\/\}/g, " "));
    if (hcount(t) < 12) return;   // 라벨·버튼·표머리는 안내멘트가 아니다
    if (t.length > 1200) return;  // 인라인 CSS 등
    // 폼 컨트롤 마크업은 안내멘트가 아니다. 단 목록을 map 으로 렌더하는 정상 문단까지 버리지 않도록
    // "=>" 만으로 거르지 않고, 핸들러 잔해(e.target·} />)와 속성만 본다.
    if (/e\.target|\}\s*\/>|onChange=|onClick=|className=/.test(t)) return;
    rows.push({ file: file.replace("apps/admin-next/", ""), line: src.slice(0, index).split("\n").length, carrier, text: t });
  };

  for (const rel of files) {
    const src = readFileSync(`${ROOT}/${rel}`, "utf8");
    for (const m of src.matchAll(/placeholder=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g))
      push(rel, m.index, src, "placeholder", m[1] ?? m[2] ?? m[3] ?? "");
    for (const m of src.matchAll(/<p className="[^"]*(?:muted|small|hint|help)[^"]*"[^>]*>([\s\S]{0,900}?)<\/p>/g))
      push(rel, m.index, src, "muted-p", m[1].replace(/<[^>]+>/g, ""));
    // 설명 상자는 <p> 만 쓰지 않는다. info-panel/side-note 같은 div 담체를 빼면 안내멘트가 통째로 누락된다
    // (실제로 후보 선정 반경을 손으로 적던 문단이 이 사각지대에 있었다).
    for (const m of src.matchAll(/<div className="[^"]*(?:info-panel|toast-info|toast-warn|side-note)[^"]*"[^>]*>([\s\S]{0,900}?)<\/div>/g))
      push(rel, m.index, src, "info-div", m[1].replace(/<[^>]+>/g, ""));
    for (const m of src.matchAll(/\b(body|desc|action|hint|note|help)\s*:\s*(?:"([^"]*)"|`([^`]*)`)/g))
      push(rel, m.index, src, `field:${m[1]}`, m[2] ?? m[3] ?? "");
    for (const m of src.matchAll(/\b(confirm|alert)\(\s*(?:"([^"]*)"|`([^`]*)`)/g))
      push(rel, m.index, src, "confirm", m[2] ?? m[3] ?? "");
    for (const m of src.matchAll(/\stitle="([^"]{12,})"/g))
      push(rel, m.index, src, "tooltip", m[1]);
    for (const m of src.matchAll(/>([^<>{}]{20,600}?)</g)) {
      if (!/(습니다|하세요|됩니다|합니다|입니다|주세요|마세요|집니다)/.test(m[1])) continue;
      push(rel, m.index, src, "jsx-text", m[1]);
    }
  }

  // 같은 문장이 여러 담체로 잡히거나 조각으로 잘려 나온 것을 제거한다.
  const seen = new Set();
  let uniq = rows.filter((r) => {
    const k = idOf(r.text);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const bare = (s) => s.replace(/[\s·「」…—]/g, "");
  uniq = uniq.filter((r) => !uniq.some((o) => o !== r && bare(o.text).length > bare(r.text).length && bare(o.text).includes(bare(r.text))));

  return uniq
    .map((r) => ({ id: idOf(r.text), ...r }))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

// 분류 overlay 를 문장 조각(file + match)으로 붙인다. 해시가 아니라 사람이 읽는 조각을 키로 쓰는 이유:
// 문장을 고치면 match 가 안 맞아 「해석 실패」로 드러나고, 그게 곧 "분류를 다시 확인하라"는 신호다.
const classification = existsSync(CLASSIFICATION) ? JSON.parse(readFileSync(CLASSIFICATION, "utf8")) : { rows: [] };
const raw = collect();
const unresolved = [];
const tagOf = new Map();
for (const row of classification.rows ?? []) {
  const hits = raw.filter((r) => r.file === row.file && r.text.includes(row.match));
  if (hits.length !== 1) { unresolved.push({ ...row, hits: hits.length, why: hits.length === 0 ? "일치 없음" : "여러 문장에 일치 — match 를 더 좁혀라" }); continue; }
  // 두 분류가 같은 문장을 가리키면 뒤엣것이 앞엣것을 조용히 덮는다. 그러면 분류가 사라진 줄 모른다.
  if (tagOf.has(hits[0].id)) { unresolved.push({ ...row, hits: 1, why: `같은 문장을 "${tagOf.get(hits[0].id).match}" 가 이미 분류함 — 한 줄로 합쳐라` }); continue; }
  tagOf.set(hits[0].id, row);
}
const inventory = raw.map((r) => {
  const tag = tagOf.get(r.id);
  // reviewed = overlay 에 등록된 것. class:"C" 로 명시하면 "봤고 사실 주장이 아니다"라는 뜻이라
  // --untagged 가 다시 지목하지 않는다. 그래야 남는 게 진짜 미검토뿐이다.
  return { ...r, class: tag?.class ?? "C", reviewed: Boolean(tag), depends: tag?.depends ?? [], defect: tag?.defect ?? false, note: tag?.note ?? "" };
});

if (unresolved.length) {
  console.error(`\n⚠ 분류 overlay 해석 실패 ${unresolved.length}건 — 안내멘트가 바뀌었거나 사라졌다. 분류를 다시 확인하라.`);
  for (const u of unresolved) console.error(`   ${u.file} :: "${u.match}" → ${u.why}`);
  console.error("");
}

// process.exit() 를 쓰지 않는다 — 파이프로 나가는 stdout 이 flush 전에 잘린다.
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(inventory, null, 2));
} else if (process.argv.includes("--untagged")) {
  const suspicious = inventory.filter((r) => !r.reviewed && /(게이트|프롬프트|강제|자동|적용됩니다|쓰입니다|제외됩니다|건너뜁니다|[0-9]+(개|초|분|곳|km|회))/.test(r.text));
  console.log(`아직 분류하지 않았는데 사실을 서술하는 것으로 보이는 항목 ${suspicious.length}건 — A/B/C 판정 필요\n`);
  for (const r of suspicious) console.log(`  ${r.id}  ${r.file}:${r.line}\n      ${r.text.slice(0, 160)}`);
} else {
  writeDoc();
}

function writeDoc() {

// ── 문서 생성 ────────────────────────────────────────────────────────────
const byClass = { A: [], B: [], C: [] };
for (const r of inventory) byClass[r.class].push(r);
const byFile = {};
for (const r of inventory) (byFile[r.file] ??= []).push(r);

const esc = (s) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const clip = (s, n) => esc(s.length > n ? `${s.slice(0, n)}…` : s);
const table = (rows) => [
  "| 위치 | 담체 | 안내멘트 | 종속 대상 |",
  "| --- | --- | --- | --- |",
  ...rows.map((r) => `| \`${r.file}:${r.line}\` | ${r.carrier} | ${clip(r.text, 180)}${r.note ? `<br>_${esc(r.note)}_` : ""} | ${r.depends.map((d) => `\`${d}\``).join("<br>") || "—"} |`),
].join("\n");

const defects = inventory.filter((r) => r.defect);

const doc = `# 관리자 UI 안내멘트 인벤토리

> **생성물이다. 직접 고치지 마라.** \`node scripts/copy-inventory.mjs\` 로 다시 만든다.
> 분류·종속 대상은 \`scripts/ui-copy-classification.json\` 에서 사람이 지정한다.

안내멘트는 대부분 "코드가 강제하는 사실"의 사본이다. 사본은 원본이 바뀌면 썩는다.
이 목록은 **코드를 고칠 때 같이 고쳐야 할 문장**을 찾기 위한 역참조표다.

## 분류

| 급 | 뜻 | 처방 | 건수 |
| --- | --- | --- | --- |
| **A** | 파생 가능 — 코드 상수/설정에서 계산할 수 있는데 손으로 적은 수치·목록 | 재서술을 없애고 값에서 렌더한다 | ${byClass.A.length} |
| **B** | 동작 계약 — 코드가 강제하는 규칙의 서술 | 원본을 고치면 반드시 같이 고친다 | ${byClass.B.length} |
| **C** | 순수 안내 — 흐름·톤·빈 상태 문구 | 기계 검증 대상 아님 | ${byClass.C.length} |
| | | **합계** | **${inventory.length}** |

파일별: ${Object.entries(byFile).sort((a, b) => b[1].length - a[1].length).map(([f, rs]) => `\`${f}\` ${rs.length}`).join(" · ")}

## 지금 이미 어긋난 것 (${defects.length}건)

인벤토리를 만들면서 발견된, **코드와 다르거나 화면끼리 서로 모순인** 안내멘트다.

${defects.map((r) => `- \`${r.file}:${r.line}\` — ${clip(r.text, 120)}\n  - ${esc(r.note || "")}`).join("\n")}

## A — 파생 가능 (${byClass.A.length}건)

코드 상수에서 계산할 수 있는데 손으로 적었다. **값에서 렌더하면 드리프트가 구조적으로 불가능해진다.**

${table(byClass.A)}

## B — 동작 계약 (${byClass.B.length}건)

코드가 강제하는 규칙을 문장으로 다시 설명한다. 파생이 불가능하므로 **종속 대상이 바뀌면 사람이 같이 고쳐야 한다.**

${table(byClass.B)}

## C — 순수 안내 (${byClass.C.length}건)

흐름 설명·투어 문구·빈 상태 문구. 사실을 주장하지 않으므로 코드 변경과 무관하다.
새로 추가된 문장이 사실을 주장하는데 C 로 남아 있는지는 \`node scripts/copy-inventory.mjs --untagged\` 로 점검한다.

<details><summary>전체 ${byClass.C.length}건 펼치기</summary>

${table(byClass.C)}

</details>
`;

writeFileSync(OUT_DOC, doc);
console.log(`총 ${inventory.length}건 — A ${byClass.A.length} · B ${byClass.B.length} · C ${byClass.C.length} · 어긋남 ${defects.length}`);
console.log(`문서: ${OUT_DOC.replace(`${ROOT}/`, "")}`);
}
