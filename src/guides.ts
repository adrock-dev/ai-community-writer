import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BRANDS, CHANNELS, findChannel } from "./channels.ts";
import type { Database } from "./db/database.ts";
import { PROJECT_ROOT } from "./paths.ts";

// 작성 가이드(유의사항): 글 생성 시 반드시 지켜야 하는 운영 규칙과 사실.
// 예) 드라이빙존 교육시간은 1일 1회 최대 1시간 30분 교육 가능
//
// 저장은 DB(guide_rules)이고 설정 화면(/settings/guides)에서 관리한다.
// 적용 범위(scope)는 넓은 것부터 겹쳐 적용한다.
//   common                 모든 채널
//   brand:<브랜드 id>       브랜드의 모든 채널 (drivingplus, drivingzone)
//   channel:<채널 id>       특정 채널
// guides/*.md는 DB가 비어 있을 때 한 번 가져오는 초기값이다.

export const GUIDES_DIR = join(PROJECT_ROOT, "guides");

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
}

/** 가이드 Markdown에서 규칙 목록을 뽑는다. 들여쓴 이어지는 줄은 앞 규칙에 붙인다. */
export function parseGuide(markdown: string): ParsedRule[] {
  const rules: ParsedRule[] = [];
  let group = "";
  for (const line of markdown.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const heading = /^#{2,6}\s+(.+?)\s*$/.exec(line);
    if (heading) {
      group = heading[1] ?? "";
      continue;
    }
    const item = /^[-*]\s+(.+?)\s*$/.exec(line);
    if (item) {
      rules.push({ group, text: item[1] ?? "" });
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

/** DB에 규칙이 하나도 없을 때만 guides/*.md를 가져온다. 가져온 규칙 수를 돌려준다. */
export function importGuideFilesIfEmpty(db: Database, dir: string = GUIDES_DIR): number {
  if ((db.get<{ n: number }>("SELECT COUNT(*) AS n FROM guide_rules")?.n ?? 0) > 0) return 0;
  if (!existsSync(dir)) return 0;
  const files = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) =>
    f.endsWith(".md"),
  );
  let count = 0;
  db.transaction(() => {
    for (const file of files.sort()) {
      const scope = scopeOfFile(file);
      if (!scope || !isValidScope(scope)) continue;
      for (const rule of parseGuide(readFileSync(join(dir, file), "utf8"))) {
        addGuideRule(db, { scope, group: rule.group, text: rule.text });
        count++;
      }
    }
  });
  return count;
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
