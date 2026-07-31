#!/usr/bin/env node
// 문서가 열거한 '코드에서 셀 수 있는 사실'이 실제와 맞는지 검사한다.
//
// 왜 생성이 아니라 검사인가: 라우트 표에는 "이 화면이 무슨 역할인가"라는 사람이 쓴 설명이 붙어
// 있다. 표를 통째로 생성하면 그 설명을 잃는다. 목록의 '항목'만 대조하면 설명은 보존하면서
// 누락·잉여만 잡을 수 있다.
//
// 무엇을 검사하지 않는가: 동작 서술("연결을 눌러야 반영된다")과 설계 의도는 기계가 판정할 수
// 없다. 화면 안내멘트의 B급을 차단하지 않는 것과 같은 이유다(scripts/verify-copy-sync.mjs).
// 그런 문장은 사람이 읽어야 하고, 이 검사는 거기까지 책임지지 않는다.
//
// 사용: node scripts/verify-doc-sync.mjs   (npm run verify:doc-sync)
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "");

const errors = [];
const notes = [];

// 문서마다 대괄호(`[domain]`)와 중괄호(`{domain}`)를 섞어 쓴다. 둘은 같은 것으로 본다.
const normalizeRoute = (value) => value.trim().replace(/\{([^}]+)\}/g, "[$1]").replace(/\/$/, "") || "/";

// ── 1. 관리자 라우트 ──────────────────────────────────────────────────────
// app/**/page.tsx 가 곧 라우트다. 문서가 이 목록과 어긋나면 새 화면이 문서에 없거나(인수인계에서
// 통째로 빠진다) 없어진 화면을 아직 안내하고 있다는 뜻이다.
function actualRoutes() {
  const base = join(ROOT, "apps/admin-next/app");
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        // (group) 라우트 그룹과 api 핸들러는 화면이 아니다.
        if (entry.startsWith("(") || entry === "api") continue;
        walk(full);
      } else if (entry === "page.tsx") {
        const route = full.slice(join(ROOT, "apps/admin-next/app").length).replace(/\/page\.tsx$/, "");
        found.push(normalizeRoute(route || "/"));
      }
    }
  };
  walk(base);
  return new Set(found);
}

// 문서 어디든 코드 스팬(`/...`)으로 적힌 경로를 라우트 후보로 본다. 표의 몇 번째 칸인지에
// 기대지 않는다 — 문서마다 표 구조가 다르고, 구조를 바꿨다고 검사가 깨지면 그 검사는 곧 꺼진다.
function documentedPaths(rel) {
  return new Set([...read(rel).matchAll(/`(\/[^`\s]*)`/g)].map((m) => normalizeRoute(m[1])));
}

// 없어진 화면을 아직 안내하는지는 '라우트 표'에서만 본다. 문서 본문에는 API 경로(`/api/v1/...`)나
// 예시 URL 이 섞여 있어, 그것까지 라우트로 취급하면 거짓 경보가 난다.
function routeTablePaths(rel) {
  const routes = new Set();
  for (const line of read(rel).split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    const firstCell = line.split("|")[1] ?? "";
    const m = firstCell.match(/^\s*`(\/[^`\s]*)`\s*$/);
    if (m) routes.add(normalizeRoute(m[1]));
  }
  return routes;
}

const ROUTE_DOCS = ["HANDOFF.md", "docs/admin-ui-guide.md"];
const routes = actualRoutes();
for (const rel of ROUTE_DOCS) {
  if (!read(rel)) continue;
  const mentioned = documentedPaths(rel);
  const missing = [...routes].filter((r) => !mentioned.has(r)).sort();
  const gone = [...routeTablePaths(rel)].filter((r) => !routes.has(r)).sort();
  if (missing.length) errors.push(`${rel}: 문서에 없는 화면 ${missing.length}개 — ${missing.join(", ")}`);
  if (gone.length) errors.push(`${rel}: 없어진 화면을 아직 안내한다 ${gone.length}개 — ${gone.join(", ")}`);
  if (!missing.length && !gone.length) notes.push(`${rel}: 화면 ${routes.size}개 모두 언급됨`);
}

// ── 2. 엔드포인트 수 ──────────────────────────────────────────────────────
// HANDOFF 가 "실제 엔드포인트는 N개(관리자 M + 공개 K)" 라고 못 박고 있다. 컨트롤러에 하나
// 추가하면 이 문장이 곧바로 거짓이 된다.
function endpointCounts() {
  const dir = join(ROOT, "apps/api-nest/src");
  let admin = 0;
  let publicCount = 0;
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".controller.ts")) continue;
    const n = (readFileSync(join(dir, entry), "utf8").match(/^\s*@(Get|Post|Put|Patch|Delete)\(/gm) ?? []).length;
    if (entry.startsWith("public.")) publicCount += n;
    else admin += n;
  }
  return { admin, public: publicCount, total: admin + publicCount };
}

const counts = endpointCounts();
const claim = read("HANDOFF.md").match(/실제 엔드포인트는\s*(\d+)\s*개\(관리자\s*(\d+)\s*\+\s*공개\s*(\d+)\)/);
if (!claim) {
  errors.push("HANDOFF.md: 엔드포인트 수 문장을 못 찾았다. 문장을 고쳤으면 이 검사도 고쳐라.");
} else {
  const [, total, admin, pub] = claim.map(Number);
  if (total !== counts.total || admin !== counts.admin || pub !== counts.public) {
    errors.push(
      `HANDOFF.md: 엔드포인트 수가 코드와 다르다 — 문서 ${total}개(관리자 ${admin} + 공개 ${pub}), ` +
        `실제 ${counts.total}개(관리자 ${counts.admin} + 공개 ${counts.public})`,
    );
  } else {
    notes.push(`HANDOFF.md: 엔드포인트 ${counts.total}개(관리자 ${counts.admin} + 공개 ${counts.public}) 일치`);
  }
}

// ── 3. 도메인 관리 탭 ─────────────────────────────────────────────────────
// 탭 이름은 DomainClient 의 TABS 가 정본이다. 탭을 늘리고 문서를 안 고치면 인수인계에서 그
// 화면이 통째로 없는 것이 된다.
const tabsSource = read("apps/admin-next/components/DomainClient.tsx").match(/const TABS = \[([\s\S]*?)\] as const;/);
if (!tabsSource) {
  errors.push("DomainClient.tsx: TABS 배열을 못 찾았다. 구조가 바뀌었으면 이 검사도 고쳐라.");
} else {
  const labels = [...tabsSource[1].matchAll(/\[\s*"[^"]+"\s*,\s*"([^"]+)"\s*\]/g)].map((m) => m[1]);
  const guide = read("docs/admin-ui-guide.md");
  if (guide) {
    const missing = labels.filter((label) => !guide.includes(label));
    if (missing.length) {
      errors.push(`docs/admin-ui-guide.md: 문서에 없는 도메인 관리 탭 ${missing.length}개 — ${missing.join(", ")}`);
    } else {
      notes.push(`docs/admin-ui-guide.md: 도메인 관리 탭 ${labels.length}개 일치`);
    }
  }
}

// ── 4. DB 테이블 ─────────────────────────────────────────────────────────
// HANDOFF §9 가 주요 테이블을 열거한다. 테이블을 추가하고 문서를 안 고치면 인수인계 받은 사람이
// 그 테이블의 존재를 모른 채 백업·마이그레이션 범위를 정하게 된다.
const tables = [...new Set(
  [...read("apps/api-nest/src/db.service.ts").matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/g)].map((m) => m[1]),
)].sort();
if (!tables.length) {
  errors.push("db.service.ts: CREATE TABLE 을 못 찾았다. 스키마 정의 방식이 바뀌었으면 이 검사도 고쳐라.");
} else {
  const handoff = read("HANDOFF.md");
  const missing = tables.filter((t) => !new RegExp(`\`${t}\``).test(handoff));
  if (missing.length) errors.push(`HANDOFF.md: 문서에 없는 DB 테이블 ${missing.length}개 — ${missing.join(", ")}`);
  else notes.push(`HANDOFF.md: DB 테이블 ${tables.length}개 모두 언급됨`);
}

// ── 5. 빌트인 글유형 ─────────────────────────────────────────────────────
// 살아 있는 유형과 폐기된 유형이 `constants.ts` 에서 갈린다. 문서가 폐기된 것을 아직 살아 있는
// 것처럼 설명하는지는 서술이라 기계가 못 잡지만, **살아 있는 유형이 문서에 아예 없는 것**과
// **존재하지 않는 번호를 적어 둔 것**은 잡을 수 있다.
const specIds = new Set([...read("apps/api-nest/src/constants.ts").matchAll(/^\s{2}(T\d{2}):/gm)].map((m) => m[1]));
const deprecatedBlock = read("apps/api-nest/src/constants.ts").match(
  /DEPRECATED_BUILTIN_TEMPLATE_IDS: readonly string\[\] = \[([\s\S]*?)\]/,
);
if (!specIds.size || !deprecatedBlock) {
  errors.push("constants.ts: 글유형 목록이나 폐기 목록을 못 찾았다. 구조가 바뀌었으면 이 검사도 고쳐라.");
} else {
  const deprecated = new Set([...deprecatedBlock[1].matchAll(/"(T\d{2})"/g)].map((m) => m[1]));
  const alive = [...specIds].filter((id) => !deprecated.has(id)).sort();
  const doc = read("DEVELOPER_CONTEXT.md");
  const missing = alive.filter((id) => !doc.includes(id));
  // "`T02`는 없습니다" 처럼 **없다고 알리는 문장**은 정상이다. 그 줄까지 오류로 잡으면 검사가
  // 문서를 거짓말하게 만든다(실제로 첫 실행에서 T02 를 잡았다). 같은 줄에 부정어가 있으면 넘긴다.
  const docLines = doc.split("\n");
  const unknown = [...new Set([...doc.matchAll(/\bT\d{2}\b/g)].map((m) => m[0]))]
    .filter((id) => !specIds.has(id))
    .filter((id) => !docLines.some((line) => line.includes(id) && /없|폐기|제거|사라/.test(line)));
  if (missing.length) errors.push(`DEVELOPER_CONTEXT.md: 살아 있는 글유형이 문서에 없다 — ${missing.join(", ")}`);
  if (unknown.length) errors.push(`DEVELOPER_CONTEXT.md: 존재하지 않는 글유형을 적어 뒀다 — ${unknown.join(", ")}`);
  if (!missing.length && !unknown.length) notes.push(`DEVELOPER_CONTEXT.md: 글유형 ${alive.length}종(살아 있는 것) 언급됨`);
}

// ── 출력 ─────────────────────────────────────────────────────────────────
for (const note of notes) console.log(`  ✓ ${note}`);
if (errors.length) {
  console.error("\n" + errors.map((e) => `❌ ${e}`).join("\n"));
  console.error(`\n문서 동기화 검사 실패 — ${errors.length}건. 문서를 고치거나, 검사 대상이 바뀌었으면 이 스크립트를 고쳐라.`);
  process.exit(1);
}
console.log(`\n문서 동기화 검사 통과 (${notes.length}건).`);
