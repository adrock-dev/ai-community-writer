#!/usr/bin/env node
// 안내멘트가 코드와 어긋난 채로 커밋되는 것을 막는다.
//
// 무엇을 막을 수 있고 무엇은 못 막는가:
//   차단 — 기계가 판정할 수 있는 것만. 분류가 조용히 사라졌거나, 손으로 적은 숫자가 코드값과
//          달라졌거나, 생성 문서가 낡았을 때.
//   경고 — 사람만 판정할 수 있는 것. B급(동작 계약)은 파생이 불가능해 "바뀐 코드에 매달린
//          안내멘트가 이것들이다"까지만 알려준다.
//
// B급을 차단하지 않는 이유: worker.service.ts 처럼 자주 바뀌는 파일에 매달린 문장이 많아,
// 차단하면 매 커밋이 걸린다. 그러면 --no-verify 가 습관이 되고 게이트 전체가 죽는다.
//
// 사용: node scripts/verify-copy-sync.mjs        (pre-commit 훅이 호출)
//      node scripts/verify-copy-sync.mjs --all  (staged 가 아니라 워킹트리 전체를 B급 대상으로)
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { inventory, unresolved, renderDoc } from "./copy-inventory.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => (existsSync(`${ROOT}/${rel}`) ? readFileSync(`${ROOT}/${rel}`, "utf8") : "");

const errors = [];
const warnings = [];

// ── 1. 분류 overlay 무결성 ───────────────────────────────────────────────
// match 가 안 맞으면 분류가 사라진 것이다. 조용히 넘어가면 그 문장은 아무도 안 보게 된다.
if (unresolved.length) {
  errors.push(
    `분류 overlay 해석 실패 ${unresolved.length}건 — 안내멘트를 고쳤으면 scripts/ui-copy-classification.json 의 match 도 맞춰라.\n` +
      unresolved.map((u) => `      ${u.file} :: "${u.match}" → ${u.why}`).join("\n"),
  );
}

// ── 2. 손으로 적은 숫자가 코드값과 같은가 ─────────────────────────────────
// A급의 처방은 "값에서 렌더한다"지만, 렌더할 경로가 없어 손으로 적은 것이 남는다.
// 그런 것만 여기서 대조한다. 렌더로 고친 항목은 애초에 어긋날 수 없어 검사 대상이 아니다.
const findCopy = (file, match) => inventory.find((r) => r.file === file && r.text.includes(match));

const numericChecks = [
  {
    label: "키워드 프리셋 개수",
    actual: () => {
      const src = read("apps/api-nest/src/constants.ts");
      const from = src.indexOf("keyword: [", src.indexOf("driving:"));
      const block = src.slice(from, src.indexOf("],", from));
      return (block.match(/\{ value:/g) ?? []).length;
    },
    source: "constants.ts#PRESETS.driving.keyword",
    expect: (n) => `${n}개`,
    sites: [
      ["components/DomainClient.tsx", "키워드 마스터를 기본값"],
      ["components/DomainClient.tsx", "글유형이 고르는 키워드 풀"],
      ["components/DomainClient.tsx", "운전 프리셋 기본값"],
    ],
  },
  {
    label: "작업 큐 폴링 주기",
    actual: () => {
      const src = read("apps/admin-next/components/DomainClient.tsx");
      const m = src.match(/setInterval\([^,]+,\s*(\d+)\)/);
      return m ? Number(m[1]) / 1000 : null;
    },
    source: "DomainClient.tsx setInterval",
    expect: (n) => `${n}초`,
    sites: [["components/DomainClient.tsx", "글 작성/중복검사/가지치기/색인 작업을"]],
  },
  {
    label: "CTA 브랜드 언급 횟수",
    actual: () => {
      const m = read("apps/api-nest/src/worker.service.ts").match(/브랜드명을 (\d+~\d+)회/);
      return m ? m[1] : null;
    },
    source: "worker.service.ts CTA 지침",
    expect: (v) => `${v}회`,
    sites: [["components/DomainClient.tsx", "생성 글 본문·CTA·HTML 내보내기"]],
  },
];

for (const check of numericChecks) {
  const actual = check.actual();
  if (actual === null || actual === 0 || Number.isNaN(actual)) {
    errors.push(`${check.label}: 코드에서 값을 읽지 못했다(${check.source}). 코드 구조가 바뀌었으면 이 검사도 고쳐라.`);
    continue;
  }
  const needle = check.expect(actual);
  for (const [file, match] of check.sites) {
    const row = findCopy(file, match);
    if (!row) {
      errors.push(`${check.label}: 검사 대상 안내멘트를 못 찾았다 — ${file} :: "${match}". 문구가 바뀌었으면 이 검사도 고쳐라.`);
      continue;
    }
    if (!row.text.includes(needle)) {
      errors.push(
        `${check.label} — 코드와 화면이 다르다. 코드는 ${needle}(${check.source})인데 화면은 다른 값을 말한다.\n` +
          `      ${row.file}:${row.line}\n      ${row.text.slice(0, 160)}`,
      );
    }
  }
}

// ── 3. 생성 문서가 최신인가 ──────────────────────────────────────────────
// 문서가 낡으면 "코드를 고칠 때 무엇을 같이 고칠지" 찾는 표가 거짓이 된다.
if (read("docs/ui-copy-inventory.md") !== renderDoc()) {
  errors.push("docs/ui-copy-inventory.md 가 낡았다 — `npm run copy:inventory` 로 다시 만들고 함께 커밋하라.");
}

// ── 4. 분류하지 않은 사실 주장 (경고) ────────────────────────────────────
const untagged = inventory.filter(
  (r) => !r.reviewed && /(게이트|프롬프트|강제|자동|적용됩니다|쓰입니다|제외됩니다|건너뜁니다|[0-9]+(개|초|분|곳|km|회))/.test(r.text),
);
if (untagged.length) {
  warnings.push(
    `분류하지 않은 안내멘트 ${untagged.length}건이 사실을 서술하는 것으로 보인다 — \`npm run copy:untagged\` 로 확인하고 판정하라.`,
  );
}

// ── 5. 이번 커밋이 건드린 코드에 매달린 안내멘트 (경고) ───────────────────
// 파생이 불가능한 B급은 여기까지만 할 수 있다. "같이 봐야 할 문장"을 눈앞에 놓는다.
const changed = (() => {
  try {
    const cmd = process.argv.includes("--all")
      ? "git diff --name-only HEAD"
      : "git diff --cached --name-only";
    return execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
})();

if (changed.length) {
  // depends 는 "path#심볼" 또는 설명 문구다. 경로처럼 보이는 앞부분만 떼어 staged 파일과 맞춘다.
  const changedSet = new Set(changed);
  const touched = [];
  for (const row of inventory) {
    if (!row.depends.length) continue;
    const hits = row.depends.filter((d) => {
      const [pathPart, symbol] = d.split("#");
      const path = pathPart.split(" ")[0].trim();
      if (!path.includes("/")) return false;
      const full = path.startsWith("apps/") || path.startsWith("scripts/") || path.startsWith("docs/") ? path : `apps/admin-next/${path}`;
      if (!changedSet.has(full)) return false;
      // 값을 렌더하는 문구는 상수가 바뀌어도 틀릴 수 없다. 재서술한 것만 사람이 볼 대상이다.
      if (symbol && row.text.includes(symbol.trim())) return false;
      return true;
    });
    if (hits.length) touched.push({ row, hits });
  }
  // 안내멘트 자체가 이번 커밋에서 바뀌었으면 이미 챙긴 것으로 본다.
  const stale = touched.filter(({ row }) => !changedSet.has(`apps/admin-next/${row.file}`));
  if (stale.length) {
    warnings.push(
      `이번 변경에 매달린 안내멘트 ${stale.length}건 — 코드만 바뀌고 문구는 그대로다. 여전히 맞는 말인지 확인하라.\n` +
        stale
          .slice(0, 12)
          .map(({ row, hits }) => `      [${row.class}] ${row.file}:${row.line}  ← ${hits.join(", ")}\n          ${row.text.slice(0, 110)}`)
          .join("\n") +
        (stale.length > 12 ? `\n      … 외 ${stale.length - 12}건 (docs/ui-copy-inventory.md 참조)` : ""),
    );
  }
}

// ── 결과 ─────────────────────────────────────────────────────────────────
for (const w of warnings) console.log(`\n⚠  ${w}`);
for (const e of errors) console.error(`\n❌ ${e}`);

if (errors.length) {
  console.error(`\n안내멘트 동기화 검사 실패 — ${errors.length}건.\n`);
  process.exitCode = 1;
} else {
  console.log(`\n안내멘트 동기화 검사 통과 (${inventory.length}건 · 경고 ${warnings.length}).`);
}
