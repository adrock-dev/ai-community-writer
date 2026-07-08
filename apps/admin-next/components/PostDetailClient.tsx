"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatDateTime, formatShortDate } from "@/lib/date";
import { getDesignTheme, resolveDesignId } from "@/lib/design-theme";
import type { DesignTemplateId, PostDetail, DomainConfig, DesignPreset } from "@/lib/types";

export default function PostDetailClient({ domain, postId }: { domain: string; postId: string }) {
  const [post, setPost] = useState<PostDetail | null>(null);
  const [domainConfig, setDomainConfig] = useState<DomainConfig | null>(null);
  const [bodyHtml, setBodyHtml] = useState("");
  const [publishedHtml, setPublishedHtml] = useState("");
  const [error, setError] = useState("");
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
  const designPreset = rawDesignId.startsWith("uploaded:") ? post.design_preset ?? null : null;
  const design = designPreset ? uploadedDesignTheme(designPreset, domainConfig?.brand_color) : getDesignTheme(designId, domainConfig?.brand_color);
  const articleClass = designPreset ? "design-uploaded" : `design-${designId}`;
  const brand = publicBrandName(domainConfig?.display_name ?? domain);
  const articleStyle = { ["--accent" as string]: design.accent, ["--accent-soft" as string]: design.soft, ["--primary" as string]: design.accent, background: design.pageBg };
  const contentHtml = toPreviewBlocks(prepareBodyHtml(renderedHtml, post.title, null));
  const chips = designPreset ? uploadedDesignChips(designPreset) : designChips(designId);
  const uploadedHtml = designPreset ? renderUploadedPresetHtml({ post, domainConfig, domain, designPreset, bodyHtml: renderedHtml }) : "";
  return <div>
    <div className="page-head"><div><Link href={`/t/${encodeURIComponent(domain)}`} className="eyebrow">← {domain}</Link><h1>{post.title}</h1><p className="muted mono">{post.slug}</p></div><div className="row"><button className="btn" onClick={() => navigator.clipboard.writeText(post.body_markdown)}>Markdown 복사</button><button className="btn" onClick={() => download(`${post.slug}.md`, post.body_markdown, "text/markdown")}>Markdown 다운로드</button><button className="btn primary" onClick={() => download(`${post.slug}.html`, uploadedHtml || renderStandaloneHtml({ post, domainConfig, domain, designId, rawDesignId, designPreset, bodyHtml: renderedHtml }), "text/html;charset=utf-8")}>HTML 다운로드</button></div></div>
    <div className="grid post-detail-layout" style={{ gridTemplateColumns: "minmax(0, 1fr) 320px", alignItems: "start" }}>
      {designPreset ? <iframe className="uploaded-post-frame" title={post.title} srcDoc={uploadedHtml} /> : <article className={`preview-phone preview-phone-fluid ${articleClass}`} style={articleStyle}>
        <div className="preview-top"><div><b>{brand}</b><p>{design.label}</p></div><span className="preview-cta">{design.topCta}</span></div>
        <div className="preview-hero post-hero title-hero">
          <div>
            <span>{design.label}</span>
            <h3>{post.title}</h3>
          </div>
        </div>
        <div className="preview-body">
          <div className="preview-meta"><span>{formatShortDate(post.generated_at)}</span><span>{designPreset ? rawDesignId : designId}</span></div>
          <div className="preview-divider" />
          <div className="row post-chips">{chips.map((chip) => <span className="badge" key={chip}>{chip}</span>)}</div>
          <div className="generated-blocks" dangerouslySetInnerHTML={{ __html: contentHtml }} />
          <section className="preview-bottom-cta"><b>{brand}에서 {design.bottomCta}</b><a className="btn primary" href="#">{design.bottomCta}</a></section>
        </div>
      </article>}
      <aside className="grid"><div className="card card-pad"><h2>메타</h2><p><b>상태:</b> {post.status}</p><p><b>디자인:</b> {design.label} <span className="badge">{designPreset ? rawDesignId : designId}</span></p><p><b>provider:</b> {post.provider ?? "-"} {post.model ?? ""}</p><p><b>비용:</b> {post.cost_usd ? `$${post.cost_usd.toFixed(3)}` : "-"}</p><p><b>생성:</b> {formatDateTime(post.generated_at)}</p><p className="muted">{post.meta_description}</p><p className="muted small">원문은 상단의 복사/다운로드 버튼으로 확인합니다. 상세 화면에는 발행 디자인만 표시합니다.</p></div></aside>
    </div>
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
function publicBrandName(value: string): string {
  return value.replace(/\s*(?:샘플|데모)\s*$/u, "").trim() || value;
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

function uploadedDesignChips(preset: DesignPreset): string[] {
  return [
    preset.best_for?.split(",")[0]?.trim(),
    preset.tone?.replace(/\s*톤\s*$/u, "").trim(),
    "업로드 프리셋",
  ].filter(Boolean).slice(0, 3) as string[];
}

function uploadedDesignTheme(preset: DesignPreset, brandColor?: string | null) {
  const base = getDesignTheme("custom", brandColor);
  const cssTokens = preset.css_tokens && typeof preset.css_tokens === "object" ? preset.css_tokens : {};
  const vars = cssTokens.vars && typeof cssTokens.vars === "object" ? cssTokens.vars as Record<string, unknown> : {};
  const colors = Array.isArray(cssTokens.colors) ? cssTokens.colors.map((value) => String(value)).filter(isCssColorToken) : [];
  const accent = pickCssVar(vars, ["brand", "teal", "primary", "accent"], colors, base.accent);
  const soft = pickCssVar(vars, ["brand-soft", "teal-soft", "surface", "sand"], colors.filter((color) => color !== accent), `color-mix(in srgb, ${accent} 12%, white)`);
  const pageBg = pickCssVar(vars, ["paper", "bg", "background", "card"], colors, base.pageBg);
  return { ...base, accent, soft, pageBg, label: publicBrandName(preset.name || "업로드 프리셋").slice(0, 28) || "업로드 프리셋" };
}

function pickCssVar(vars: Record<string, unknown>, names: string[], fallbackColors: string[], fallback: string): string {
  for (const name of names) {
    const value = vars[name];
    if (typeof value === "string" && isCssColorToken(value)) return value;
  }
  if (names.some((name) => /soft|surface|sand|paper|bg|card/.test(name))) return fallbackColors.find(isSoftColor) || fallbackColors[0] || fallback;
  return fallbackColors.find(isSaturatedHex) || fallbackColors.find((color) => !isSoftColor(color)) || fallback;
}

function isCssColorToken(value: string): boolean {
  return /^#[0-9a-fA-F]{3,8}$/.test(value) || /^rgba?\([^)]+\)$/.test(value);
}

function isSoftColor(color: string): boolean {
  if (!color.startsWith("#")) return false;
  const rgb = hexToRgb(color);
  return Boolean(rgb && rgb.r > 225 && rgb.g > 225 && rgb.b > 225);
}

function isSaturatedHex(color: string): boolean {
  const rgb = hexToRgb(color);
  if (!rgb) return false;
  const max = Math.max(rgb.r, rgb.g, rgb.b);
  const min = Math.min(rgb.r, rgb.g, rgb.b);
  return max - min > 55 && max > 120 && min < 230;
}

function hexToRgb(color: string): { r: number; g: number; b: number } | null {
  const hex = color.replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((value) => value + value).join("") : hex.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16) };
}

function renderUploadedPresetHtml({ post, domainConfig, domain, designPreset, bodyHtml }: { post: PostDetail; domainConfig: DomainConfig | null; domain: string; designPreset: DesignPreset; bodyHtml: string }) {
  const brand = publicBrandName(domainConfig?.display_name ?? domain);
  const title = post.title || brand;
  const css = String(designPreset.css_text || "");
  const contentHtml = uploadedPresetContentHtml(prepareBodyHtml(bodyHtml, title, null));
  return `<!doctype html>
<html lang="ko" data-theme="light">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  ${post.meta_description ? `<meta name="description" content="${escapeAttr(post.meta_description)}" />` : ""}
  <style>${css}</style>
  <style>${uploadedPresetCompatCss()}</style>
</head>
<body>
  <header class="hero">
    <div class="hero-inner">
      <span class="eyebrow">${escapeHtml(brand)}</span>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(post.meta_description || "검증된 자료를 기준으로 정리한 비교 가이드입니다.")}</p>
      <div class="meta"><span>${escapeHtml(formatShortDate(post.generated_at))}</span><span>·</span><span>${escapeHtml(designPreset.name || "업로드 프리셋")}</span></div>
    </div>
  </header>
  <main><article><div class="wrap">
    <div class="notice"><strong>확인 안내</strong> — 실제 글에서는 슬롯/검증 자료의 지역과 학원 정보를 사용합니다.</div>
    ${contentHtml}
  </div></article></main>
</body>
</html>`;
}

function uploadedPresetContentHtml(html: string): string {
  const blocks = html.match(/<figure class="post-image">[\s\S]*?<\/figure>|<div class="post-table-wrap">[\s\S]*?<\/div>|<blockquote>[\s\S]*?<\/blockquote>|<ul>[\s\S]*?<\/ul>|<ol>[\s\S]*?<\/ol>|<h2>[\s\S]*?<\/h2>|<h3>[\s\S]*?<\/h3>|<p>[\s\S]*?<\/p>/gi);
  if (!blocks?.length) return html;
  const out: string[] = [];
  let section: string[] = [];
  let sectionKind: "section" | "toc" = "section";
  let school: string[] = [];
  let schoolRank = 0;
  const flushSchool = () => {
    if (!school.length) return;
    out.push(`<div class="school">${school.join("\n")}</div>`);
    school = [];
  };
  const flushSection = () => {
    if (!section.length) return;
    out.push(sectionKind === "toc" ? `<nav class="toc">${section.join("\n")}</nav>` : `<section>${section.join("\n")}</section>`);
    section = [];
    sectionKind = "section";
  };
  for (const rawBlock of blocks) {
    const block = uploadedPresetBlock(rawBlock);
    if (/^<h2\b/i.test(block)) {
      flushSchool();
      flushSection();
      const heading = block.replace(/^<h2>/i, "").replace(/<\/h2>$/i, "");
      if (/목차|이 글의 순서/u.test(stripTags(heading))) {
        sectionKind = "toc";
        section = [`<h4>${heading}</h4>`];
      } else {
        section = [block];
      }
      continue;
    }
    if (/^<h3\b/i.test(block)) {
      flushSchool();
      flushSection();
      const heading = block.replace(/^<h3>/i, "").replace(/<\/h3>$/i, "");
      schoolRank += 1;
      school = [`<div class="school-head"><div class="rank${schoolRank === 1 ? " gold" : ""}">${schoolRank}</div><div><h3 class="school-title">${heading}</h3><div class="school-tag">검증 자료 기준</div></div></div>`];
      continue;
    }
    if (school.length) school.push(block);
    else section.push(block);
  }
  flushSchool();
  flushSection();
  return out.join("\n");
}

function uploadedPresetCompatCss(): string {
  return `
body{min-width:0}.wrap{width:100%}.hero h1{word-break:keep-all}.post-image.preset-image{margin:22px 0;border-radius:var(--radius,16px);overflow:hidden;box-shadow:var(--shadow)}.post-image.preset-image img{display:block;width:100%;max-height:440px;object-fit:cover}.school{margin:28px 0}.school>p{margin-top:14px}.school .post-image{margin:16px 0}.table-scroll{margin:18px 0}.compare{width:100%}.toc a{color:inherit;text-decoration:none}.notice{margin-top:28px}.review{display:block}.btn{text-decoration:none}@media(max-width:760px){.wrap{padding-left:16px;padding-right:16px}.hero{padding-left:16px;padding-right:16px}}`;
}
function uploadedPresetBlock(block: string): string {
  return block
    .replace(/<div class="post-table-wrap">\s*<table>/i, '<div class="table-scroll"><table class="compare">')
    .replace(/<figure class="post-image">/i, '<figure class="post-image preset-image">')
    .replace(/<blockquote>/i, '<blockquote class="review">');
}
function stripTags(value: string): string { return value.replace(/<[^>]+>/g, ""); }
function escapeRegExp(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function renderStandaloneHtml({ post, domainConfig, domain, designId, rawDesignId, designPreset, bodyHtml }: { post: PostDetail; domainConfig: DomainConfig | null; domain: string; designId: DesignTemplateId; rawDesignId: string; designPreset: DesignPreset | null; bodyHtml: string }) {
  const design = designPreset ? uploadedDesignTheme(designPreset, domainConfig?.brand_color) : getDesignTheme(designId, domainConfig?.brand_color);
  const articleClass = designPreset ? "design-uploaded" : `design-${designId}`;
  const visibleDesignId = designPreset ? rawDesignId : designId;
  const brand = publicBrandName(domainConfig?.display_name ?? domain);
  const title = post.title || brand;
  const contentHtml = toPreviewBlocks(prepareBodyHtml(bodyHtml, post.title, null));
  const chips = designPreset ? uploadedDesignChips(designPreset) : designChips(designId);
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
