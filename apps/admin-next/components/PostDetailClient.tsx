"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatDateTime, formatShortDate } from "@/lib/date";
import { publicBrandName } from "@/lib/brand";
import { getDesignTheme, resolveDesignId } from "@/lib/design-theme";
import type { DesignTemplateId, PostDetail, DomainConfig } from "@/lib/types";
import { getPostInsight, type PostInsight } from "@/lib/post-insight";

export default function PostDetailClient({ domain, postId }: { domain: string; postId: string }) {
  const [post, setPost] = useState<PostDetail | null>(null);
  const [domainConfig, setDomainConfig] = useState<DomainConfig | null>(null);
  const [bodyHtml, setBodyHtml] = useState("");
  const [publishedHtml, setPublishedHtml] = useState("");
  const [error, setError] = useState("");
  const [insight, setInsight] = useState<PostInsight | null>(null);
  // 근거 카드는 본문 로딩과 별개다 — 실패해도 글은 봐야 하므로 조용히 접는다.
  useEffect(() => { void getPostInsight(postId).then(setInsight).catch(() => setInsight(null)); }, [postId]);
  useEffect(() => { (async () => {
    try {
      const [detail, domainDetail] = await Promise.all([
        api<{ post: PostDetail; body_html?: string; published_html?: string }>(`/domains/${encodeURIComponent(domain)}/posts/${postId}?include_rendered=true`),
        api<{ domain: DomainConfig }>(`/domains/${encodeURIComponent(domain)}`),
      ]);
      setPost(detail.post); setBodyHtml(detail.body_html ?? ""); setPublishedHtml(detail.published_html ?? ""); setDomainConfig(domainDetail.domain);
    } catch (e) { setError((e as Error).message); }
  })(); }, [domain, postId]);
  if (error) return <p className="toast-error">{error}</p>;
  if (!post) return <div className="card card-pad">로딩 중...</div>;
  const renderedHtml = publishedHtml || bodyHtml || fallbackMarkdown(post.body_markdown, parseImages(post.images));
  const rawDesignId = post.design_template_id ?? domainConfig?.design_template_id ?? "";
  const designId = resolveDesignId(rawDesignId);
  const design = getDesignTheme(designId, domainConfig?.brand_color);
  const articleClass = `design-${designId}`;
  const brand = publicBrandName(domainConfig ?? domain);
  const articleStyle = { ["--accent" as string]: design.accent, ["--accent-soft" as string]: design.soft, ["--primary" as string]: design.accent, background: design.pageBg };
  const contentHtml = toPreviewBlocks(prepareBodyHtml(renderedHtml, post.title, null));
  const chips = designChips(designId);
  return <div>
    <div className="page-head"><div><Link href={`/t/${encodeURIComponent(domain)}`} className="eyebrow">← {domain}</Link><h1>{post.title}</h1><p className="muted mono">{post.slug}</p></div><div className="row"><button className="btn" onClick={() => navigator.clipboard.writeText(post.body_markdown)}>Markdown 복사</button><button className="btn" onClick={() => download(`${post.slug}.md`, post.body_markdown, "text/markdown")}>Markdown 다운로드</button><button className="btn primary" onClick={() => download(`${post.slug}.html`, renderStandaloneHtml({ post, domainConfig, domain, designId, bodyHtml: renderedHtml }), "text/html;charset=utf-8")}>HTML 다운로드</button></div></div>
    <div className="grid post-detail-layout" style={{ gridTemplateColumns: "minmax(0, 1fr) 320px", alignItems: "start" }}>
      <article className={`preview-phone preview-phone-fluid ${articleClass}`} style={articleStyle}>
        <div className="preview-top"><div><b>{brand}</b><p>{design.label}</p></div><span className="preview-cta">{design.topCta}</span></div>
        <div className="preview-hero post-hero title-hero">
          <div>
            <span>{design.label}</span>
            <h3>{post.title}</h3>
          </div>
        </div>
        <div className="preview-body">
          <div className="preview-meta"><span>{formatShortDate(post.generated_at)}</span><span>{designId}</span></div>
          <div className="preview-divider" />
          <div className="row post-chips">{chips.map((chip) => <span className="badge" key={chip}>{chip}</span>)}</div>
          <div className="generated-blocks" dangerouslySetInnerHTML={{ __html: contentHtml }} />
          <section className="preview-bottom-cta"><b>{brand}에서 {design.bottomCta}</b><a className="btn primary" href="#">{design.bottomCta}</a></section>
        </div>
      </article>
      <aside className="grid"><div className="card card-pad"><h2>메타</h2><p><b>상태:</b> {post.status}</p><p><b>디자인:</b> {design.label} <span className="badge">{designId}</span></p><p><b>provider:</b> {post.provider ?? "-"} {post.model ?? ""}</p><p><b>비용:</b> {post.cost_usd ? `$${post.cost_usd.toFixed(3)}` : "-"}</p><p><b>생성:</b> {formatDateTime(post.generated_at)}</p><p className="muted">{post.meta_description}</p><p className="muted small">원문은 상단의 복사/다운로드 버튼으로 확인합니다. 상세 화면에는 발행 디자인만 표시합니다.</p></div>
        {insight && <InsightCard insight={insight} />}
      </aside>
    </div>
  </div>;
}
/**
 * 「이 글의 근거」. 메타가 생성 정보(누가·얼마에·언제)라면 이쪽은 내용 정보다 —
 * 무엇을 근거로 썼고, 무엇이 빠졌는가.
 *
 * 「안 쓰인 근거」를 아쉬움으로 단정하지 않는다. 실측 4건에서 편의시설이 한 번도 안 쓰였는데
 * 그건 모델이 옳게 버린 것이었다("주차 가능" 은 비교 정보가 아니다). 사실만 늘어놓고
 * 판단은 사람이 한다.
 *
 * 반면 「검토 필요라 빠진 값」은 진짜 아쉬운 자리다 — 글에 들어갔어야 할 사실이 광고 문구와
 * 엉켜 통째로 빠지는 일이 실제로 있었다(학장자동차운전전문학원의 자체 시험장).
 */
function InsightCard({ insight }: { insight: PostInsight }) {
  return <div className="card card-pad grid" style={{ gap: 10 }}>
    <div>
      <h2 style={{ margin: 0 }}>이 글의 근거</h2>
      <p className="muted small" style={{ margin: "4px 0 0" }}>
        학원 {insight.used.academies}곳 · 후기 인용 {insight.used.quotes}건 · 이미지 {insight.used.images}장 · {insight.used.chars.toLocaleString()}자
      </p>
    </div>

    {insight.blocked.length > 0 && (
      <div className="action-hint" style={{ display: "grid", gap: 6 }}>
        <b>검토 필요라 빠진 값 {insight.blocked.length}건</b>
        <span className="small" style={{ fontWeight: 500 }}>
          근거 검사에 걸려 이 글에 들어가지 못했습니다. 값을 고쳐 승인하면 다음 생성부터 쓰입니다.
        </span>
        {insight.blocked.map((item) => (
          <div key={`${item.academy}:${item.field}`} className="small" style={{ fontWeight: 500 }}>
            <b>{item.academy}</b> · {item.label}<br />
            <span className="muted">“{item.value}”</span>
            {item.note ? <><br /><span style={{ color: "#b45309" }}>⚠ {item.note}</span></> : null}
          </div>
        ))}
        <Link className="btn" href="/academies" style={{ width: "fit-content" }}>운전학원 자료에서 고치기</Link>
      </div>
    )}

    {!insight.has_snapshot
      ? <p className="muted small" style={{ margin: 0 }}>
          생성 시점 근거가 저장되지 않은 글입니다(기능이 붙기 전에 생성). 지금 다시 계산하면 그때와 다른 값이 나오므로 「안 쓰인 근거」는 보여주지 않습니다.
        </p>
      : insight.unused.length === 0
        ? <p className="muted small" style={{ margin: 0 }}>보낸 조사 근거는 모두 본문에 반영됐습니다.</p>
        : <details>
            <summary className="muted small" style={{ cursor: "pointer" }}>본문이 쓰지 않은 조사 근거 {insight.unused.length}건</summary>
            <p className="muted small" style={{ margin: "6px 0" }}>
              보냈지만 본문에 나타나지 않은 값입니다. <b>결함이 아닙니다</b> — 5곳이 다 가진 편의시설처럼 비교 정보가 아니면 모델이 버리는 것이 맞습니다.
            </p>
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
              {insight.unused.map((item, i) => <li key={i}><b>{item.academy}</b> · {item.label}: {item.value}</li>)}
            </ul>
          </details>}
  </div>;
}

function download(name: string, text: string, type: string) { const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }
function fallbackMarkdown(md: string, images: Record<string, string>) {
  return markdownBlocks(md).map((raw) => renderMarkdownBlock(raw, images)).join("");
}
function markdownBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let currentKind: "paragraph" | "list" | "quote" | "table" | null = null;
  const flush = () => {
    if (!current.length) return;
    blocks.push(current.join("\n").trim());
    current = [];
    currentKind = null;
  };
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^\[(?:IMAGE|TABLE|CTA|FAQ|QUOTE)_SLOT:[^\]]+\]$/i.test(trimmed)) { flush(); continue; }
    const mixedImageBlocks = splitMixedImageTokenLine(trimmed);
    if (mixedImageBlocks) { flush(); blocks.push(...mixedImageBlocks); continue; }
    if (/^#{1,3}\s+/.test(trimmed) || /^\[IMAGE:[A-Za-z0-9_-]+\]$/.test(trimmed)) { flush(); blocks.push(trimmed); continue; }
    const kind: "paragraph" | "list" | "quote" | "table" = trimmed.includes("|") ? "table" : isListLine(trimmed) ? "list" : trimmed.startsWith(">") ? "quote" : "paragraph";
    if (currentKind && currentKind !== kind) flush();
    currentKind = kind;
    current.push(trimmed);
  }
  flush();
  return blocks;
}
function splitMixedImageTokenLine(line: string): string[] | null {
  if (!/\[IMAGE:[A-Za-z0-9_-]+\]/.test(line) || line.includes("|")) return null;
  const tokens = Array.from(line.matchAll(/\[IMAGE:[A-Za-z0-9_-]+\]/g)).map((match) => match[0]!);
  const text = line
    .replace(/\[IMAGE:[A-Za-z0-9_-]+\]/g, " ")
    .replace(/[→|,/]+/g, " ")
    .replace(/(?:사진|이미지)\s*(?:순서)?\s*[:：-]?/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? [text, ...tokens] : tokens;
}
function renderMarkdownBlock(raw: string, images: Record<string, string>) {
  if (/^\[(?:IMAGE|TABLE|CTA|FAQ|QUOTE)_SLOT:[^\]]+\]$/i.test(raw)) return "";
  const imageMatch = raw.match(/^\[IMAGE:([A-Za-z0-9_-]+)\]$/);
  if (imageMatch) {
    const key = imageMatch[1]!;
    const src = images[key];
    return src ? `<figure class="post-image"><img src="${escapeAttr(src)}" alt="${escapeAttr(key)}" loading="lazy" /></figure>` : "";
  }
  if (isMarkdownTable(raw)) return renderMarkdownTable(raw);
  if (isMarkdownList(raw)) return renderMarkdownList(raw);
  if (raw.startsWith(">")) return `<blockquote>${renderInline(raw.replace(/^>\s?/gm, "")).replace(/\n/g, "<br />")}</blockquote>`;
  if (raw.startsWith("# ")) return `<h1>${renderInline(raw.slice(2))}</h1>`;
  if (raw.startsWith("## ")) return `<h2>${renderInline(raw.slice(3))}</h2>`;
  if (raw.startsWith("### ")) return `<h3>${renderInline(raw.slice(4))}</h3>`;
  return `<p>${renderInline(raw).replace(/\n/g, "<br />")}</p>`;
}
function renderInline(raw: string): string {
  let s = escapeHtml(raw);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label, url) => `<a href="${escapeAttr(url)}" target="_blank" rel="nofollow noopener">${label}</a>`);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/\[(\d+)\]/g, '<sup class="cite">[$1]</sup>');
  return s;
}
function parseImages(value: PostDetail["images"]): Record<string, string> {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, string>;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}
function escapeHtml(s: string) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!)); }
function escapeAttr(s: string) { return escapeHtml(s).replace(/'/g, "&#39;"); }
function resolveDesign(value: string | null | undefined): DesignTemplateId {
  return resolveDesignId(value);
}
function prepareBodyHtml(html: string, title: string, heroImage: string | null): string {
  let out = html.trim();
  const escapedTitle = escapeRegExp(escapeHtml(title.trim()));
  out = out.replace(new RegExp(`^<h1>\\s*${escapedTitle}\\s*</h1>\\s*`, "i"), "");
  out = out.replace(/^<h1>[\s\S]*?<\/h1>\s*/i, "");
  if (heroImage) {
    const escapedSrc = escapeRegExp(escapeAttr(heroImage));
    out = out.replace(new RegExp(`<figure class="post-image"><img src="${escapedSrc}"[\\s\\S]*?<\/figure>\\s*`, "i"), "");
  }
  return out;
}
function toPreviewBlocks(html: string): string {
  const blocks = html.match(/<figure class="post-image">[\s\S]*?<\/figure>|<div class="post-table-wrap">[\s\S]*?<\/div>|<blockquote>[\s\S]*?<\/blockquote>|<ul>[\s\S]*?<\/ul>|<ol>[\s\S]*?<\/ol>|<h2>[\s\S]*?<\/h2>|<h3>[\s\S]*?<\/h3>|<p>[\s\S]*?<\/p>/gi);
  if (!blocks?.length) return html ? `<div class="preview-block"><p>${html}</p></div>` : "";
  const groups: string[] = [];
  let current: string[] = [];
  let card: string[] | null = null;
  const flush = () => {
    if (!current.length) return;
    groups.push(`<section class="preview-block">${current.join("\n")}</section>`);
    current = [];
  };
  const flushCard = () => {
    if (!card || !card.length) { card = null; return; }
    groups.push(`<section class="preview-block academy-card">${card.join("\n")}</section>`);
    card = null;
  };
  for (const block of blocks) {
    if (block.startsWith("<h3")) { flush(); flushCard(); card = [block]; continue; } // 학원 카드 시작
    if (block.startsWith("<h2")) { flush(); flushCard(); current.push(block); continue; } // 섹션 시작 → 카드 종료
    if (card) { card.push(block); continue; } // 학원 카드 안: 이미지·설명·관련후기 모두 포함
    if (block.startsWith("<figure")) { flush(); groups.push(block); continue; }
    current.push(block);
  }
  flush(); flushCard();
  return groups.join("\n");
}
function isListLine(line: string): boolean { return /^[-*]\s+/.test(line) || /^\d+[.)]\s+/.test(line) || /^[✅✔✓]\s*/.test(line); }
function isMarkdownList(raw: string): boolean {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length >= 2 && lines.every(isListLine);
}
function renderMarkdownList(raw: string): string {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const ordered = lines.every((line) => /^\d+[.)]\s+/.test(line));
  const tag = ordered ? "ol" : "ul";
  const items = lines.map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, "").replace(/^[✅✔✓]\s*/, ""));
  return `<${tag}>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`;
}
function isMarkdownTable(raw: string): boolean {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length >= 3 && lines[0]!.includes("|") && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(lines[1]!);
}
function renderMarkdownTable(raw: string): string {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const header = splitTableRow(lines[0]!);
  const rows = lines.slice(2).map(splitTableRow).filter((row) => row.length);
  return `<div class="post-table-wrap"><table><thead><tr>${header.map((cell) => `<th>${renderInline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${header.map((_, i) => `<td>${renderInline(row[i] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function splitTableRow(line: string): string[] {
  return line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}
function designChips(designId: DesignTemplateId): string[] {
  const chips: Record<DesignTemplateId, string[]> = {
    editorial: ["가이드", "FAQ", "정보성"],
    comparison: ["비교 기준", "요약 표", "추천 케이스"],
    "local-guide": ["지역 고민", "주변 선택 기준", "동선/접근성"],
    checklist: ["요약", "준비 체크", "절차"],
    conversion: ["문제 공감", "해결 기준", "상담"],
    custom: ["상단 구성", "본문 규칙", "CTA 위치"],
  };
  return chips[designId];
}

function escapeRegExp(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function renderStandaloneHtml({ post, domainConfig, domain, designId, bodyHtml }: { post: PostDetail; domainConfig: DomainConfig | null; domain: string; designId: DesignTemplateId; bodyHtml: string }) {
  const design = getDesignTheme(designId, domainConfig?.brand_color);
  const articleClass = `design-${designId}`;
  const visibleDesignId = designId;
  const brand = publicBrandName(domainConfig ?? domain);
  const title = post.title || brand;
  const contentHtml = toPreviewBlocks(prepareBodyHtml(bodyHtml, post.title, null));
  const chips = designChips(designId);
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  ${post.meta_description ? `<meta name="description" content="${escapeAttr(post.meta_description)}" />` : ""}
  <style>${standaloneCss()}</style>
</head>
<body>
  <main class="post-page">
    <article class="preview-phone preview-phone-fluid ${articleClass}" style="--accent:${design.accent};--accent-soft:${design.soft};--primary:${design.accent};background:${design.pageBg}">
      <div class="preview-top"><div><b>${escapeHtml(brand)}</b><p>${escapeHtml(design.label)}</p></div><span class="preview-cta">${escapeHtml(design.topCta)}</span></div>
      <div class="preview-hero post-hero title-hero">
        <div>
          <span>${escapeHtml(design.label)}</span>
          <h3>${escapeHtml(post.title)}</h3>
        </div>
      </div>
      <div class="preview-body">
        <div class="preview-meta"><span>${escapeHtml(formatShortDate(post.generated_at))}</span><span>${escapeHtml(visibleDesignId)}</span></div>
        <div class="preview-divider"></div>
        <div class="row post-chips">${chips.map((chip) => `<span class="badge">${escapeHtml(chip)}</span>`).join("")}</div>
        <div class="generated-blocks">
${contentHtml}
        </div>
        <section class="preview-bottom-cta"><b>${escapeHtml(brand)}에서 ${escapeHtml(design.bottomCta)}</b><a class="btn primary" href="#">${escapeHtml(design.bottomCta)}</a></section>
      </div>
    </article>
  </main>
</body>
</html>`;
}
function standaloneCss() {
  return `
*{box-sizing:border-box}body{margin:0;background:transparent;color:#111827;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.post-page{width:100%;padding:0}.preview-phone{width:100%;max-width:none;border:1px solid #e5e7eb;border-radius:24px;overflow:hidden;background:white;box-shadow:0 20px 50px rgba(15,23,42,.14)}.preview-top{background:var(--primary);color:white;padding:16px;display:flex;justify-content:space-between;gap:10px;align-items:center}.preview-top p{margin:2px 0 0;opacity:.85;font-size:12px}.preview-cta{border-radius:12px;background:#ffe94d;color:#111827;padding:9px 12px;font-size:12px;font-weight:900;white-space:nowrap}.preview-hero{margin:18px;min-height:280px;border-radius:14px;background:radial-gradient(circle at 18% 20%,rgba(255,255,255,.55),transparent 30%),linear-gradient(135deg,var(--accent-soft),#f6f0ff 45%,#fff4a7);position:relative;overflow:hidden;display:flex;align-items:flex-end;padding:22px}.preview-hero.title-hero h3{margin:10px 0 0;font-size:clamp(24px,4.6vw,48px);line-height:1.18;letter-spacing:-.055em;color:#111827}.preview-hero.title-hero p{max-width:760px;margin:12px 0 0;color:#475569;font-weight:700;line-height:1.65}.preview-hero span{display:inline-flex;border-radius:999px;background:rgba(255,255,255,.88);padding:6px 10px;font-size:11px;color:var(--primary);font-weight:900}.preview-body{padding:0 22px 22px}.preview-meta{display:flex;justify-content:center;gap:16px;color:#94a3b8;font-size:11px}.preview-body h4{text-align:center;font-size:clamp(20px,3vw,34px);line-height:1.3;margin:14px 0;font-weight:950;letter-spacing:-.04em}.preview-divider{height:9px;border-radius:999px;background:#ffe94d;margin:14px 0}.row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.post-chips{margin-bottom:14px}.badge{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:4px 8px;font-size:12px;font-weight:800;background:#f1f5f9;color:#334155}.muted{color:#64748b}.small{font-size:12px}.generated-blocks{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;min-width:0;max-width:100%}.generated-blocks>*{min-width:0;max-width:100%}.preview-block{border-radius:12px;background:#f8fafc;padding:12px;margin:0;font-size:14px;line-height:1.75}.preview-block p{margin:6px 0 0;color:#64748b}.generated-blocks ul{display:grid;gap:8px;margin:10px 0 0;padding-left:0;list-style:none;color:#475569}.generated-blocks ul li{position:relative;margin:0;padding-left:24px}.generated-blocks ul li::before{content:"✓";position:absolute;left:0;top:0;color:var(--primary);font-weight:900;line-height:inherit}.generated-blocks ol{margin:10px 0 0;padding-left:22px;color:#475569}.generated-blocks ol li{margin:6px 0;padding-left:2px}.generated-blocks blockquote{margin:0;border-left:4px solid #ffe94d;background:#fafaf7;padding:12px;border-radius:0 12px 12px 0;color:#475569}.preview-block strong{font-weight:900;color:#020617}.preview-block a{color:var(--primary);font-weight:800}.post-table-wrap{width:100%;overflow:hidden;border:1px solid #e5e7eb;border-radius:12px;background:white}.post-table-wrap table{width:100%;min-width:0;margin:0;font-size:13px;table-layout:fixed}.post-table-wrap th{background:#fffacc;color:#111827;font-weight:900;white-space:normal}.post-table-wrap td{background:white}.post-table-wrap th,.post-table-wrap td{overflow-wrap:anywhere;word-break:keep-all}.preview-block code{border-radius:6px;background:#e2e8f0;padding:2px 6px}.preview-block h2,.preview-block h3{margin:0 0 6px;font-size:16px}.post-image{margin:0;border-radius:14px;overflow:hidden}.post-image img{display:block;width:100%;max-height:520px;object-fit:cover;border-radius:14px}.cite{color:#64748b;font-size:.72em}.preview-bottom-cta{margin-top:18px;border:2px solid #ffe94d;border-radius:16px;background:#fafaf7;padding:16px;text-align:center;display:grid;gap:12px}.btn{display:inline-flex;align-items:center;justify-content:center;border-radius:12px;padding:10px 14px;text-decoration:none;font-weight:900}.btn.primary{background:var(--primary);color:white}.design-comparison .preview-divider{background:repeating-linear-gradient(90deg,var(--primary) 0,var(--primary) 22px,#ffe94d 22px,#ffe94d 36px)}.design-local-guide .preview-divider{border-top:2px dashed rgba(81,50,215,.45);background:transparent;height:16px}.design-checklist .preview-divider{height:auto;padding:8px;border:1px solid #ffe94d;background:#fffacc;color:var(--primary);text-align:center;font-size:10px;font-weight:900;letter-spacing:.16em}.design-checklist .preview-divider::before{content:"CHECK BEFORE RESERVATION"}.design-conversion .preview-top{background:#111827}.design-conversion .preview-divider{background:linear-gradient(90deg,var(--primary),#ffe94d,var(--primary))}.design-conversion .preview-bottom-cta{background:#111827;color:white}.design-conversion .preview-bottom-cta .btn.primary{background:#ffe94d;color:#111827}@media(max-width:720px){.preview-phone{border-radius:0}.preview-top{align-items:flex-start;flex-direction:column}}`;
}
