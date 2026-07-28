#!/usr/bin/env node
// 파일을 고친 직후, 그 파일에 매달린 안내멘트를 알려준다.
//
// 왜 커밋 게이트만으로 부족한가: verify:copy-sync 는 커밋할 때 알려주므로 이미 다 만든 뒤에
// 되돌아가야 한다. 고치는 중에 눈앞에 떠야 그 자리에서 같이 고친다. 그리고 B급(동작 계약)은
// 기계가 판정할 수 없어 게이트가 차단하지 못하니, 사람이 볼 기회를 한 번 더 만드는 것이 곧 방지책이다.
//
// Claude Code PostToolUse 훅으로 붙는다(.claude/settings.json). stdin 으로 훅 페이로드를 받고,
// 매달린 안내멘트가 없으면 아무것도 출력하지 않는다 — 매번 떠들면 곧 무시하게 된다.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, relative, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

const payload = (() => {
  try {
    return JSON.parse(readStdin() || "{}");
  } catch {
    return {};
  }
})();

const edited = payload.tool_response?.filePath ?? payload.tool_input?.file_path ?? "";
if (!edited) process.exit(0);

const rel = relative(ROOT, resolve(edited));
// 저장소 밖(../) 이거나 안내멘트와 무관한 파일이면 조용히 끝낸다.
if (!rel || rel.startsWith("..")) process.exit(0);

const { inventory } = await import("./copy-inventory.mjs");

// depends 는 "경로#심볼" 또는 설명 문구다. 경로처럼 보이는 앞부분만 떼어 방금 고친 파일과 맞춘다.
const normalize = (dep) => {
  const path = dep.split("#")[0].split(" ")[0].trim();
  return path.includes("/") ? path : null;
};

const hits = [];
for (const row of inventory) {
  if (row.file === rel) continue; // 방금 고친 게 안내멘트 자신이면 알릴 필요가 없다
  const matched = row.depends.filter((d) => {
    if (normalize(d) !== rel) return false;
    // 값을 렌더하는 문구는 상수가 바뀌어도 틀릴 수 없다.
    const symbol = d.split("#")[1];
    return !(symbol && row.text.includes(symbol.trim()));
  });
  if (matched.length) hits.push(row);
}

if (!hits.length) process.exit(0);

const lines = hits
  .slice(0, 10)
  .map((r) => `- [${r.class}] ${r.file}:${r.line}\n  "${r.text.slice(0, 130)}"`)
  .join("\n");

const context =
  `방금 고친 ${rel} 에 매달린 화면 안내멘트 ${hits.length}건이 있다. ` +
  `이 변경으로 아래 문구가 사실과 달라지지 않는지 확인하고, 달라졌으면 같이 고쳐라.\n${lines}` +
  (hits.length > 10 ? `\n… 외 ${hits.length - 10}건 (docs/ui-copy-inventory.md)` : "") +
  `\n(분류 A=값에서 렌더해야 하는 것, B=코드가 강제하는 규칙의 서술. 표: docs/ui-copy-inventory.md)`;

process.stdout.write(
  `${JSON.stringify({
    systemMessage: `안내멘트 ${hits.length}건이 ${rel} 에 매달려 있습니다 — 여전히 맞는 말인지 확인하세요.`,
    hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: context },
  })}\n`,
);
