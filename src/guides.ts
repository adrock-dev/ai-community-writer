import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { BRANDS, CHANNELS, findChannel } from "./channels.ts";
import type { Database } from "./db/database.ts";
import { PROJECT_ROOT } from "./paths.ts";

// 작성 가이드(유의사항): 글 생성 시 반드시 지켜야 하는 운영 규칙과 사실.
// 예) 드라이빙존 요금은 부가세 미포함(별도) 가격이다
//
// 저장은 DB(guide_rules)이고 설정 화면(/settings/guides)에서 관리한다.
// 적용 범위(scope)는 넓은 것부터 겹쳐 적용한다.
//   common                 모든 채널
//   brand:<브랜드 id>       브랜드의 모든 채널 (drivingplus, drivingzone)
//   channel:<채널 id>       특정 채널
// guides/*.md는 DB가 비어 있을 때 한 번 가져오는 초기값이자, PC 사이 동기화용 파일이다.
// 설정 화면의 "파일에 저장"(DB → guides/)과 "파일에서 불러오기"(guides/ → DB, 전부 교체)로
// git 을 거쳐 규칙을 주고받는다. 자동으로 덮어쓰지 않는다.

export const GUIDES_DIR = join(PROJECT_ROOT, "guides");

/** 도로교통공단 안내에서 옮긴 유의사항 묶음의 이름 앞부분 (예: "공단 안내 · 학과시험"). */
export const PUBLIC_GUIDE_PREFIX = "공단 안내";

/** 공단 안내 묶음의 규칙 글. 품질 게이트가 공공 요금(수수료·과태료) 근거로 쓴다. */
export function publicGuideText(rules: readonly { group: string; text: string }[]): string {
  return rules
    .filter((r) => r.group.startsWith(PUBLIC_GUIDE_PREFIX))
    .map((r) => r.text)
    .join("\n");
}

export interface GuideRule {
  id: number;
  scope: string;
  /** 규칙 묶음 이름 (예: 교육 운영). 없으면 빈 문자열. */
  group: string;
  text: string;
  enabled: boolean;
  sortOrder: number;
  updatedAt: string;
}

export interface ScopeDef {
  scope: string;
  label: string;
}

/** 설정 화면에 보여줄 적용 범위 목록 (넓은 것부터). */
export function guideScopes(): ScopeDef[] {
  const brandLabel: Record<string, string> = {
    drivingplus: "운전면허PLUS",
    drivingzone: "드라이빙존",
  };
  return [
    { scope: "common", label: "공통 (모든 채널)" },
    ...BRANDS.map((b) => ({ scope: `brand:${b}`, label: `${brandLabel[b] ?? b} 전체` })),
    ...CHANNELS.map((c) => ({ scope: `channel:${c.id}`, label: `${c.label}만` })),
  ];
}

export function isValidScope(scope: string): boolean {
  return guideScopes().some((s) => s.scope === scope);
}

/** 채널에 적용되는 범위 (넓은 것부터). */
export function scopesFor(channelId: string): string[] {
  const channel = findChannel(channelId);
  if (!channel) throw new Error(`알 수 없는 채널: ${channelId}`);
  return ["common", `brand:${channel.brand}`, `channel:${channel.id}`];
}

const toRule = (r: any): GuideRule => ({
  id: r.id,
  scope: r.scope,
  group: r.group_name,
  text: r.text,
  enabled: Boolean(r.enabled),
  sortOrder: r.sort_order,
  updatedAt: r.updated_at,
});

export function listGuideRules(db: Database, scope?: string): GuideRule[] {
  const rows = scope
    ? db.all("SELECT * FROM guide_rules WHERE scope = ? ORDER BY sort_order, id", [scope])
    : db.all("SELECT * FROM guide_rules ORDER BY scope, sort_order, id");
  return rows.map(toRule);
}

/** 채널에 적용할 켜진 규칙을 공통 → 브랜드 → 채널 순으로 모은다. */
export function loadGuideRules(db: Database, channelId: string): GuideRule[] {
  return scopesFor(channelId).flatMap((scope) =>
    listGuideRules(db, scope).filter((r) => r.enabled),
  );
}

export interface GuideRuleInput {
  scope: string;
  group?: string;
  text: string;
  enabled?: boolean;
}

function validate(input: { scope: string; text: string }) {
  if (!isValidScope(input.scope)) throw new Error(`알 수 없는 적용 범위: ${input.scope}`);
  if (!input.text.trim()) throw new Error("규칙 내용이 비어 있습니다");
}

export function addGuideRule(db: Database, input: GuideRuleInput): number {
  validate(input);
  const now = new Date().toISOString();
  const next =
    (db.get<{ n: number | null }>("SELECT MAX(sort_order) AS n FROM guide_rules WHERE scope = ?", [
      input.scope,
    ])?.n ?? 0) + 1;
  return db.run(
    "INSERT INTO guide_rules (scope, group_name, text, enabled, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      input.scope,
      (input.group ?? "").trim(),
      input.text.trim(),
      input.enabled === false ? 0 : 1,
      next,
      now,
      now,
    ],
  ).lastInsertRowid;
}

export function updateGuideRule(db: Database, id: number, input: GuideRuleInput): boolean {
  validate(input);
  return (
    db.run(
      "UPDATE guide_rules SET scope = ?, group_name = ?, text = ?, enabled = ?, updated_at = ? WHERE id = ?",
      [
        input.scope,
        (input.group ?? "").trim(),
        input.text.trim(),
        input.enabled === false ? 0 : 1,
        new Date().toISOString(),
        id,
      ],
    ).changes > 0
  );
}

export function deleteGuideRule(db: Database, id: number): boolean {
  return db.run("DELETE FROM guide_rules WHERE id = ?", [id]).changes > 0;
}

// ── Markdown 초기값 ─────────────────────────────────────────────────────

export interface ParsedRule {
  group: string;
  text: string;
  /** 파일에서 `(사용 안 함)` 으로 시작하면 false */
  enabled: boolean;
}

/** 파일에서 묶음 없는 규칙을 가리키는 제목. 묶음 있는 규칙 뒤에 묶음 없는 규칙이 올 때 쓴다. */
const NO_GROUP_HEADING = "(묶음 없음)";
const DISABLED_PREFIX = "(사용 안 함)";

/** 가이드 Markdown에서 규칙 목록을 뽑는다. 들여쓴 이어지는 줄은 앞 규칙에 붙인다. */
export function parseGuide(markdown: string): ParsedRule[] {
  const rules: ParsedRule[] = [];
  let group = "";
  for (const line of markdown.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const heading = /^#{2,6}\s+(.+?)\s*$/.exec(line);
    if (heading) {
      group = heading[1] === NO_GROUP_HEADING ? "" : (heading[1] ?? "");
      continue;
    }
    const item = /^[-*]\s+(.+?)\s*$/.exec(line);
    if (item) {
      const raw = item[1] ?? "";
      const disabled = raw.startsWith(DISABLED_PREFIX);
      const text = disabled ? raw.slice(DISABLED_PREFIX.length).trim() : raw;
      rules.push({ group, text, enabled: !disabled });
      continue;
    }
    const last = rules.at(-1);
    if (last && /^\s{2,}\S/.test(line)) last.text += ` ${line.trim()}`;
  }
  return rules;
}

/** guides/ 파일명 → 적용 범위. common.md, <브랜드>.md, channels/<채널>.md */
function scopeOfFile(relPath: string): string | undefined {
  if (relPath === "common.md") return "common";
  const channel = /^channels[\\/](.+)\.md$/.exec(relPath)?.[1];
  if (channel) return `channel:${channel}`;
  const brand = /^([^\\/]+)\.md$/.exec(relPath)?.[1];
  return brand ? `brand:${brand}` : undefined;
}

/** 적용 범위 → guides/ 안의 파일 경로. */
function fileOfScope(scope: string): string {
  if (scope === "common") return "common.md";
  if (scope.startsWith("channel:")) return join("channels", `${scope.slice("channel:".length)}.md`);
  return `${scope.slice("brand:".length)}.md`;
}

function readGuideFiles(dir: string): { scope: string; rules: ParsedRule[] }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".md"))
    .sort()
    .flatMap((file) => {
      const scope = scopeOfFile(file);
      if (!scope || !isValidScope(scope)) return [];
      return [{ scope, rules: parseGuide(readFileSync(join(dir, file), "utf8")) }];
    });
}

function insertParsed(db: Database, dir: string): number {
  let count = 0;
  for (const { scope, rules } of readGuideFiles(dir)) {
    for (const rule of rules) {
      addGuideRule(db, { scope, group: rule.group, text: rule.text, enabled: rule.enabled });
      count++;
    }
  }
  return count;
}

/** DB에 규칙이 하나도 없을 때만 guides/*.md를 가져온다. 가져온 규칙 수를 돌려준다. */
export function importGuideFilesIfEmpty(db: Database, dir: string = GUIDES_DIR): number {
  if ((db.get<{ n: number }>("SELECT COUNT(*) AS n FROM guide_rules")?.n ?? 0) > 0) return 0;
  let count = 0;
  db.transaction(() => {
    count = insertParsed(db, dir);
  });
  return count;
}

/** guides/*.md로 DB 규칙을 **전부 교체**한다(다른 PC에서 저장한 규칙 받기). 가져온 규칙 수. */
export function importGuideFiles(db: Database, dir: string = GUIDES_DIR): number {
  if (readGuideFiles(dir).length === 0) throw new Error(`가이드 파일이 없습니다: ${dir}`);
  let count = 0;
  db.transaction(() => {
    db.run("DELETE FROM guide_rules");
    count = insertParsed(db, dir);
  });
  return count;
}

/** 한 적용 범위의 규칙을 파일 내용으로 만든다. parseGuide 로 다시 읽으면 같은 규칙이 나온다. */
export function renderGuideFile(scope: ScopeDef, rules: GuideRule[]): string {
  const lines = [
    `# ${scope.label} 작성 가이드`,
    "",
    '설정 화면(/settings/guides)의 "파일에 저장"으로 만든 파일이다. 규칙은 `- `로 시작하는 한 줄이 하나이고,',
    `\`## 제목\`이 묶음 이름이다. \`${DISABLED_PREFIX}\`으로 시작하는 규칙은 꺼진 규칙이다.`,
    "",
  ];
  let current = "";
  for (const rule of rules) {
    if (rule.group !== current) {
      if (lines.at(-1) !== "") lines.push("");
      lines.push(`## ${rule.group || NO_GROUP_HEADING}`, "");
      current = rule.group;
    }
    const text = rule.text.replace(/\s*\r?\n\s*/g, " ").trim();
    lines.push(`- ${rule.enabled ? "" : `${DISABLED_PREFIX} `}${text}`);
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** 범위별 파일 내용 (규칙이 없는 범위도 빈 파일로 둬서 삭제까지 전달한다). */
function renderAllGuideFiles(db: Database): { file: string; content: string }[] {
  return guideScopes().map((scope) => ({
    file: fileOfScope(scope.scope),
    content: renderGuideFile(scope, listGuideRules(db, scope.scope)),
  }));
}

/** DB 규칙을 guides/*.md로 저장한다. 내용이 바뀐 파일 경로(guides 기준)를 돌려준다. */
export function exportGuideFiles(db: Database, dir: string = GUIDES_DIR): string[] {
  const changed: string[] = [];
  for (const { file, content } of renderAllGuideFiles(db)) {
    const path = join(dir, file);
    const before = existsSync(path) ? readFileSync(path, "utf8") : undefined;
    if (before === content) continue;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
    changed.push(file.replace(/\\/g, "/"));
  }
  return changed;
}

/** DB 규칙과 guides/*.md의 규칙이 같은가(설명 문구·줄바꿈 차이는 무시). */
export function guideFilesInSync(db: Database, dir: string = GUIDES_DIR): boolean {
  const key = (rules: { group: string; text: string; enabled: boolean }[]) =>
    JSON.stringify(rules.map((r) => [r.group, r.text.replace(/\s+/g, " ").trim(), r.enabled]));
  const files = new Map(readGuideFiles(dir).map((f) => [f.scope, f.rules]));
  return guideScopes().every(
    (s) => key(files.get(s.scope) ?? []) === key(listGuideRules(db, s.scope)),
  );
}

/** 프롬프트에 넣을 형태로 규칙을 묶는다. */
export function renderGuideRules(rules: Pick<GuideRule, "group" | "text">[]): string {
  const lines: string[] = [];
  let current: string | undefined;
  for (const rule of rules) {
    const header = rule.group || "기본 규칙";
    if (header !== current) {
      lines.push(`${lines.length ? "\n" : ""}[${header}]`);
      current = header;
    }
    lines.push(`- ${rule.text}`);
  }
  return lines.join("\n");
}
