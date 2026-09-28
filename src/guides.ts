import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type ChannelDef, findChannel } from "./channels.ts";
import { PROJECT_ROOT } from "./paths.ts";

// 작성 가이드: 글 생성 시 반드시 지켜야 하는 운영 규칙.
// 아래 순서로 겹쳐 적용한다. 뒤에 오는 파일이 더 구체적인 규칙이다.
//   guides/common.md                 모든 채널 공통
//   guides/<brand>.md                브랜드 공통 (drivingplus, drivingzone)
//   guides/channels/<channelId>.md   채널 전용 (선택)
// 규칙은 `- `로 시작하는 목록 항목 한 줄이 하나다. `## 제목`은 규칙 묶음 이름으로 쓴다.

export const GUIDES_DIR = join(PROJECT_ROOT, "guides");

export interface GuideRule {
  /** 규칙이 정의된 파일 (guides/ 기준 상대 경로). */
  source: string;
  /** 가장 가까운 `##` 제목. 없으면 빈 문자열. */
  group: string;
  text: string;
}

/** 가이드 Markdown에서 규칙 목록을 뽑는다. 들여쓴 이어지는 줄은 앞 규칙에 붙인다. */
export function parseGuide(markdown: string, source: string): GuideRule[] {
  const rules: GuideRule[] = [];
  let group = "";
  for (const line of markdown.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const heading = /^#{2,6}\s+(.+?)\s*$/.exec(line);
    if (heading) {
      group = heading[1] ?? "";
      continue;
    }
    const item = /^[-*]\s+(.+?)\s*$/.exec(line);
    if (item) {
      rules.push({ source, group, text: item[1] ?? "" });
      continue;
    }
    const last = rules.at(-1);
    if (last && /^\s{2,}\S/.test(line)) last.text += ` ${line.trim()}`;
  }
  return rules;
}

export function guideFilesFor(channel: ChannelDef): string[] {
  return ["common.md", `${channel.brand}.md`, `channels/${channel.id}.md`];
}

/** 채널에 적용할 작성 가이드 규칙을 공통 → 브랜드 → 채널 순으로 모은다. 없는 파일은 건너뛴다. */
export function loadGuideRules(channelId: string, dir: string = GUIDES_DIR): GuideRule[] {
  const channel = findChannel(channelId);
  if (!channel) throw new Error(`알 수 없는 채널: ${channelId}`);
  return guideFilesFor(channel).flatMap((file) => {
    const path = join(dir, file);
    return existsSync(path) ? parseGuide(readFileSync(path, "utf8"), file) : [];
  });
}

/** 프롬프트에 넣을 형태로 규칙을 묶는다. */
export function renderGuideRules(rules: GuideRule[]): string {
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
