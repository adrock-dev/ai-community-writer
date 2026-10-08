import { html, raw } from "hono/html";

// 로컬 관리 화면 공통 레이아웃. 빌드 도구 없이 서버에서 HTML을 만든다(hono/html은 값을 자동 이스케이프).

export type Html = ReturnType<typeof html>;

const NAV = [
  { href: "/", label: "대시보드" },
  { href: "/topics", label: "주제" },
  { href: "/articles", label: "글 검수" },
  { href: "/jobs", label: "작업" },
  { href: "/settings/images", label: "삽화 설정" },
  { href: "/settings/guides", label: "유의사항 설정" },
];

export const ARTICLE_STATUS_LABEL: Record<string, string> = {
  review: "검수 대기",
  draft: "초안(문제 남음)",
  approved: "승인",
  exported: "내보냄",
  published: "발행",
  rejected: "반려",
};

export const TOPIC_STATUS_LABEL: Record<string, string> = {
  candidate: "후보",
  queued: "생성 대기",
  written: "작성됨",
  skipped: "건너뜀",
};

export const JOB_STATUS_LABEL: Record<string, string> = {
  queued: "대기",
  running: "실행 중",
  done: "완료",
  failed: "실패",
  cancelled: "취소",
};

export function badge(
  text: string,
  tone: "neutral" | "ok" | "warn" | "danger" | "accent" = "neutral",
) {
  return html`<span class="badge ${tone}">${text}</span>`;
}

export function statusTone(status: string): "neutral" | "ok" | "warn" | "danger" | "accent" {
  if (["review", "queued", "candidate"].includes(status)) return "accent";
  if (["approved", "exported", "published", "done", "written"].includes(status)) return "ok";
  if (["draft", "running"].includes(status)) return "warn";
  if (["rejected", "failed"].includes(status)) return "danger";
  return "neutral";
}

/** ISO 시각을 이 PC 기준 "MM-DD HH:mm"으로 */
export function shortTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const COPY_SCRIPT = `
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-copy],[data-copy-html]');
  if (!b) return;
  const done = () => { const t = b.textContent; b.textContent = '복사됨'; setTimeout(() => b.textContent = t, 1500); };
  try {
    if (b.dataset.copy) {
      const el = document.getElementById(b.dataset.copy);
      await navigator.clipboard.writeText(el.value ?? el.textContent);
    } else {
      const el = document.getElementById(b.dataset.copyHtml);
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([el.innerHTML], { type: 'text/html' }),
        'text/plain': new Blob([el.innerText], { type: 'text/plain' }),
      })]);
    }
    done();
  } catch (err) { b.textContent = '복사 실패'; }
});`;

export function page(
  title: string,
  body: Html | Html[],
  opts: { current?: string; notice?: string; error?: string } = {},
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
  --accent: #2f6fed; --accent-weak: #e8f0ff; --danger: #c43d3d; --danger-weak: #fdecec;
  --ok: #1f8a4c; --ok-weak: #e6f5ec; --warn: #a15c00; --warn-weak: #fff3dc;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14171c; --panel: #1c2027; --text: #e6e8ec; --muted: #9aa3b2; --line: #2d333d;
    --accent: #6f9bff; --accent-weak: #22304d; --danger: #ff7b7b; --danger-weak: #3a2222;
    --ok: #5fd08f; --ok-weak: #1e3327; --warn: #f0b35a; --warn-weak: #3a2f1c;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 15px/1.6 "Pretendard", "Malgun Gothic", "Apple SD Gothic Neo", system-ui, sans-serif; }
a { color: var(--accent); }
body > header { background: var(--panel); border-bottom: 1px solid var(--line); }
body > header .inner, main { max-width: 1200px; margin: 0 auto; padding: 0 16px; }
body > header .inner { display: flex; gap: 20px; align-items: center; min-height: 56px; flex-wrap: wrap; }
body > header strong { font-size: 16px; }
nav a { color: var(--muted); text-decoration: none; margin-right: 14px; }
nav a.on { color: var(--accent); font-weight: 600; }
main { padding-top: 24px; padding-bottom: 60px; }
h1 { font-size: 22px; margin: 0 0 6px; }
h2 { font-size: 17px; margin: 0; }
p.lead { color: var(--muted); margin: 0 0 20px; }
section.card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
  padding: 18px; margin-bottom: 16px; min-width: 0; }
section.card > header { display: flex; justify-content: space-between; align-items: baseline;
  gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.muted { color: var(--muted); font-size: 13px; }
.notice { background: var(--accent-weak); border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; }
.error { background: var(--danger-weak); color: var(--danger); border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; }
.issues { background: var(--warn-weak); border-radius: 8px; padding: 10px 14px 10px 30px; margin: 0 0 16px; }
.badge { display: inline-block; font-size: 12px; padding: 1px 8px; border-radius: 999px;
  background: var(--bg); border: 1px solid var(--line); white-space: nowrap; }
.badge.accent { background: var(--accent-weak); color: var(--accent); border-color: transparent; }
.badge.ok { background: var(--ok-weak); color: var(--ok); border-color: transparent; }
.badge.warn { background: var(--warn-weak); color: var(--warn); border-color: transparent; }
.badge.danger { background: var(--danger-weak); color: var(--danger); border-color: transparent; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 16px; }
.stat { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px; text-decoration: none; color: var(--text); }
.stat b { display: block; font-size: 26px; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 8px 6px; border-top: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 500; border-top: 0; white-space: nowrap; }
td.num { text-align: right; white-space: nowrap; }
.tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
.tabs a { text-decoration: none; padding: 4px 12px; border-radius: 999px; border: 1px solid var(--line); color: var(--text); }
.tabs a.on { background: var(--accent); border-color: var(--accent); color: #fff; }
form.inline { display: inline; }
.filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
.filters select { width: auto; }
.rule { display: grid; grid-template-columns: 150px 1fr auto auto; gap: 8px; align-items: start;
  padding: 8px 0; border-top: 1px solid var(--line); }
.rule.off { opacity: .55; }
input[type=text], input[type=url], textarea, select { width: 100%; font: inherit; color: var(--text); background: var(--bg);
  border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; }
textarea { resize: vertical; min-height: 38px; }
textarea.code { font: 13px/1.6 ui-monospace, Consolas, monospace; }
button { font: inherit; border: 1px solid var(--line); background: var(--panel); color: var(--text);
  border-radius: 6px; padding: 6px 12px; cursor: pointer; white-space: nowrap; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.danger { color: var(--danger); }
button.small { padding: 2px 8px; font-size: 13px; }
label.check { display: inline-flex; gap: 6px; align-items: center; white-space: nowrap; padding-top: 6px; }
.actions { display: flex; gap: 6px; flex-wrap: wrap; }
.field { margin-bottom: 10px; }
.field > label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 2px; }
.copyto select { width: auto; max-width: 180px; padding: 2px 4px; font-size: 13px; }
.targets { display: flex; gap: 4px 16px; flex-wrap: wrap; }
.copyrow { display: flex; gap: 6px; align-items: center; }
.copyrow input { flex: 1; }
pre.preview { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 12px;
  white-space: pre-wrap; font: 13px/1.6 ui-monospace, Consolas, monospace; margin: 0; overflow-x: auto; }
details summary { cursor: pointer; }
.split { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 16px; align-items: start; }
.article { line-height: 1.8; overflow-wrap: anywhere; }
.article img { max-width: 100%; height: auto; border-radius: 8px; display: block; margin: 12px 0; }
.article table { margin: 12px 0; }
.article th, .article td { border: 1px solid var(--line); }
.thumbs { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
.thumbs img { width: 100%; aspect-ratio: 3/2; object-fit: cover; border-radius: 6px; }
@media (max-width: 900px) {
  .split { grid-template-columns: 1fr; }
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
${opts.error ? html`<div class="error">${opts.error}</div>` : ""}
${body}
</main>
<script>${raw(COPY_SCRIPT)}</script>
</body>
</html>`;
}
