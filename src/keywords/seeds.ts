import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CHANNELS } from "../channels.ts";
import { parseGuide } from "../guides.ts";
import { PROJECT_ROOT } from "../paths.ts";

// 시드 키워드 파일
//   seeds/common.md          `## 포함어`, `## 제외어` — 모든 섹션 공통 필터
//   seeds/<채널 id>.md       `## <섹션 코드>` 아래
//                              `### 시드`   네이버 연관 키워드를 받을 시작 키워드 (소제목 생략 시 시드)
//                              `### 포함어` 이 섹션 주제로 남길 키워드가 가져야 할 단어 (하나 이상)
//                              `### 제외어` 이 섹션에서 뺄 단어
// 연관 키워드는 범위가 넓어서 섹션별 포함어·제외어가 없으면 모든 섹션에 같은 주제가 쌓인다.

export const SEEDS_DIR = join(PROJECT_ROOT, "seeds");

export interface KeywordFilter {
  include: string[];
  exclude: string[];
}

export interface SectionSeeds extends KeywordFilter {
  channelId: string;
  sectionCode: string;
  seeds: string[];
}

const KINDS = { 시드: "seeds", 포함어: "include", 제외어: "exclude" } as const;
type Kind = (typeof KINDS)[keyof typeof KINDS];

/** 채널 시드 파일을 섹션별로 읽는다. */
export function parseSeedFile(markdown: string): Map<string, Record<Kind, string[]>> {
  const sections = new Map<string, Record<Kind, string[]>>();
  let current: Record<Kind, string[]> | undefined;
  let kind: Kind = "seeds";
  for (const line of markdown.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const h2 = /^##\s+(\S+)\s*$/.exec(line);
    if (h2?.[1]) {
      current = { seeds: [], include: [], exclude: [] };
      sections.set(h2[1], current);
      kind = "seeds";
      continue;
    }
    const h3 = /^###\s+(.+?)\s*$/.exec(line);
    if (h3?.[1]) {
      const k = KINDS[h3[1] as keyof typeof KINDS];
      if (!k) throw new Error(`알 수 없는 소제목 '### ${h3[1]}' (시드/포함어/제외어 중 하나)`);
      kind = k;
      continue;
    }
    const item = /^[-*]\s+(.+?)\s*$/.exec(line);
    if (item?.[1] && current) current[kind].push(item[1]);
  }
  return sections;
}

export function loadKeywordFilter(dir: string = SEEDS_DIR): KeywordFilter {
  const path = join(dir, "common.md");
  const rules = existsSync(path) ? parseGuide(readFileSync(path, "utf8"), "common.md") : [];
  const of = (group: string) => rules.filter((r) => r.group === group).map((r) => r.text);
  return { include: of("포함어"), exclude: of("제외어") };
}

/** 채널 정의에 있는 섹션만 읽는다. 알 수 없는 섹션 제목은 오류로 알린다. */
export function loadSeeds(dir: string = SEEDS_DIR): SectionSeeds[] {
  const result: SectionSeeds[] = [];
  for (const channel of CHANNELS) {
    const path = join(dir, `${channel.id}.md`);
    if (!existsSync(path)) continue;
    let sections: ReturnType<typeof parseSeedFile>;
    try {
      sections = parseSeedFile(readFileSync(path, "utf8"));
    } catch (error) {
      throw new Error(`seeds/${channel.id}.md: ${(error as Error).message}`);
    }
    const codes: string[] = channel.sections.map((s) => s.code);
    const unknown = [...sections.keys()].filter((code) => !codes.includes(code));
    if (unknown.length) {
      throw new Error(`seeds/${channel.id}.md: 채널에 없는 섹션 ${unknown.join(", ")}`);
    }
    for (const code of codes) {
      const s = sections.get(code);
      if (s?.seeds.length) result.push({ channelId: channel.id, sectionCode: code, ...s });
    }
  }
  return result;
}

const compact = (s: string) => s.replace(/\s+/g, "");

export function passesFilter(keyword: string, filter: KeywordFilter): boolean {
  const k = compact(keyword);
  if (filter.exclude.some((w) => k.includes(compact(w)))) return false;
  return !filter.include.length || filter.include.some((w) => k.includes(compact(w)));
}
