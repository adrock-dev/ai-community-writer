import { Marked } from "marked";

// 원고(Markdown) → 채널 형식.
//   drivingplus 커뮤니티: Markdown (content_format=md)
//   드라이빙존 블로그·연수 블로그: 에디터 HTML
//   카페: 붙여넣기용 텍스트 + 서식 복사용 HTML
// 제목은 대상 시스템에서 별도 필드이므로 본문 첫 줄의 H1은 뺀다.

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// 색 강조: 원고의 `==문구==`. 원시 HTML은 막으므로 색은 이 표기로만 넣는다.
//   HTML 채널(블로그·카페 서식 복사): 채널 색(channels.ts highlightColor)의 굵은 글씨
//   색이 없는 채널: 굵게(<strong>)  /  Markdown 채널(운전면허PLUS): highlightToBold 로 `**문구**`
const HIGHLIGHT = /^==(?=\S)([^=\n]+?)(?<=\S)==/;
const SAFE_COLOR = /^#[0-9a-f]{3,8}$/i;

function createMarked(highlightColor: string): Marked {
  const color = SAFE_COLOR.test(highlightColor) ? highlightColor : "";
  return new Marked({
    gfm: true,
    breaks: false,
    renderer: {
      // 원고에 섞인 원시 HTML은 실행되지 않게 글자로 바꾼다.
      html({ text }) {
        return escapeHtml(text);
      },
    },
    extensions: [
      {
        name: "highlight",
        level: "inline",
        start: (src) => src.indexOf("=="),
        tokenizer(src) {
          const m = HIGHLIGHT.exec(src);
          if (!m) return undefined;
          return {
            type: "highlight",
            raw: m[0],
            text: m[1] ?? "",
            tokens: this.lexer.inlineTokens(m[1] ?? ""),
          };
        },
        renderer(token) {
          const inner = this.parser.parseInline(token.tokens ?? []);
          return color
            ? `<span style="color:${color};font-weight:700">${inner}</span>`
            : `<strong>${inner}</strong>`;
        },
      },
    ],
  });
}

const markedByColor = new Map<string, Marked>();

/** 본문 맨 앞의 `# 제목` 한 줄을 뺀다. */
export function stripTitle(markdown: string): string {
  return markdown.replace(/^\s*#\s+[^\n]*\n+/, "").trimStart();
}

/** 색 강조(`==문구==`)를 굵게(`**문구**`)로 바꾼다. 색을 표현할 수 없는 Markdown 채널용. */
export function highlightToBold(markdown: string): string {
  return markdown.replace(/==(?=\S)([^=\n]+?)(?<=\S)==/g, "**$1**");
}

// 표 서식. 대상 사이트 본문 CSS에 표 서식이 없어(테두리·여백 0) 칸이 붙어 보이므로 인라인 style 로 넣는다.
// 두 드라이빙존 사이트의 본문 렌더러는 인라인 style 을 유지한다. 넓은 표는 모바일에서 가로로 밀어 본다.
// 원고의 열 정렬(`---:`)은 따르지 않는다. 모델이 금액 열에 오른쪽 정렬을 붙이는데, 칸이 "25만원(부가세 별도)"
// 같은 글이라 그 열만 어긋나 보였다(2026-10-28). 머리글은 가운데, 칸은 왼쪽으로 맞춘다.
// keep-all: 한글은 글자마다 줄을 바꿀 수 있어 짧은 칸("무제한반")이 한 글자씩 접혔다. 띄어쓰기에서만 바꾼다.
const CELL = "border:1px solid #d9d9d9;padding:8px 12px;line-height:1.6;word-break:keep-all";
const TABLE_STYLES: [RegExp, string][] = [
  [
    /<table>/g,
    '<div style="overflow-x:auto;margin:16px 0"><table style="width:100%;border-collapse:collapse">',
  ],
  [/<\/table>/g, "</table></div>"],
  [
    /<th(?: align="(?:left|center|right)")?>/g,
    `<th style="${CELL};background:#f5f5f5;font-weight:700;text-align:center">`,
  ],
  [
    /<td(?: align="(?:left|center|right)")?>/g,
    `<td style="${CELL};text-align:left;vertical-align:top">`,
  ],
];

function styleTables(html: string): string {
  return TABLE_STYLES.reduce((out, [pattern, tag]) => out.replace(pattern, tag), html);
}

/** Markdown → HTML. highlightColor 를 주면 `==문구==` 를 그 색의 굵은 글씨로, 없으면 굵게. */
export function markdownToHtml(markdown: string, highlightColor = ""): string {
  let marked = markedByColor.get(highlightColor);
  if (!marked) {
    marked = createMarked(highlightColor);
    markedByColor.set(highlightColor, marked);
  }
  return styleTables(
    marked
      .parse(markdown, { async: false })
      // 링크·이미지에 스크립트 주소가 들어오지 못하게 막는다
      .replace(/(href|src)="\s*(?:javascript|data|vbscript):[^"]*"/gi, '$1="#"')
      .trim(),
  );
}

/** 카페 편집기에 그대로 붙여 넣을 텍스트. 굵은 글씨·목록 기호는 남기고 Markdown 문법만 걷는다. */
export function toCafeText(markdown: string): string {
  return stripTitle(markdown)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "[사진: $1]")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/==(?=\S)([^=\n]+?)(?<=\S)==/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "· ")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 본문 이미지 주소를 바꾼다 (생성 삽화를 내보내기 폴더의 파일 이름으로 등). */
export function replaceImageUrls(markdown: string, map: Map<string, string>): string {
  return markdown.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt: string, url: string) =>
    map.has(url) ? `![${alt}](${map.get(url)})` : m,
  );
}
