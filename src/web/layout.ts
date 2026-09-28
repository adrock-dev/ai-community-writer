import { html } from "hono/html";

// 로컬 관리 화면 공통 레이아웃. 빌드 도구 없이 서버에서 HTML을 만든다(hono/html은 값을 자동 이스케이프).

type Html = ReturnType<typeof html>;

const NAV = [
  { href: "/settings/guides", label: "유의사항 설정" },
  { href: "/health", label: "상태(JSON)" },
];

export function page(
  title: string,
  body: Html | Html[],
  opts: { current?: string; notice?: string } = {},
) {
  return html`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · AI Community Writer</title>
<style>
:root {
  --bg: #f6f7f9; --panel: #fff; --text: #1d2330; --muted: #667085; --line: #e3e6ec;
  --accent: #2f6fed; --accent-weak: #e8f0ff; --danger: #c43d3d; --ok: #1f8a4c;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14171c; --panel: #1c2027; --text: #e6e8ec; --muted: #9aa3b2; --line: #2d333d;
    --accent: #6f9bff; --accent-weak: #22304d; --danger: #ff7b7b; --ok: #5fd08f;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 15px/1.6 "Pretendard", "Malgun Gothic", "Apple SD Gothic Neo", system-ui, sans-serif; }
header { background: var(--panel); border-bottom: 1px solid var(--line); }
header .inner, main { max-width: 1080px; margin: 0 auto; padding: 0 16px; }
header .inner { display: flex; gap: 20px; align-items: center; height: 56px; }
header strong { font-size: 16px; }
nav a { color: var(--muted); text-decoration: none; margin-right: 14px; }
nav a.on { color: var(--accent); font-weight: 600; }
main { padding-top: 24px; padding-bottom: 60px; }
h1 { font-size: 22px; margin: 0 0 6px; }
h2 { font-size: 17px; margin: 0; }
p.lead { color: var(--muted); margin: 0 0 20px; }
section.card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
  padding: 18px; margin-bottom: 16px; }
section.card > header { background: none; border: 0; display: flex; justify-content: space-between;
  align-items: baseline; margin-bottom: 12px; }
.muted { color: var(--muted); font-size: 13px; }
.notice { background: var(--accent-weak); border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; }
.rule { display: grid; grid-template-columns: 150px 1fr auto auto; gap: 8px; align-items: start;
  padding: 8px 0; border-top: 1px solid var(--line); }
.rule.off { opacity: .55; }
input[type=text], textarea, select { width: 100%; font: inherit; color: var(--text); background: var(--bg);
  border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; }
textarea { resize: vertical; min-height: 38px; }
button { font: inherit; border: 1px solid var(--line); background: var(--panel); color: var(--text);
  border-radius: 6px; padding: 6px 12px; cursor: pointer; white-space: nowrap; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.danger { color: var(--danger); }
label.check { display: inline-flex; gap: 6px; align-items: center; white-space: nowrap; padding-top: 6px; }
.actions { display: flex; gap: 6px; }
pre.preview { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 12px;
  white-space: pre-wrap; font: 13px/1.6 ui-monospace, Consolas, monospace; margin: 0; }
details summary { cursor: pointer; }
@media (max-width: 720px) {
  .rule { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
<header><div class="inner"><strong>AI Community Writer</strong>
<nav>${NAV.map((n) => html`<a href="${n.href}" class="${n.href === opts.current ? "on" : ""}">${n.label}</a>`)}</nav>
</div></header>
<main>
${opts.notice ? html`<div class="notice">${opts.notice}</div>` : ""}
${body}
</main>
</body>
</html>`;
}
