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

/** Markdown → HTML. highlightColor 를 주면 `==문구==` 를 그 색의 굵은 글씨로, 없으면 굵게. */
export function markdownToHtml(markdown: string, highlightColor = ""): string {
  let marked = markedByColor.get(highlightColor);
  if (!marked) {
    marked = createMarked(highlightColor);
    markedByColor.set(highlightColor, marked);
  }
  return (
    marked
      .parse(markdown, { async: false })
      // 링크·이미지에 스크립트 주소가 들어오지 못하게 막는다
      .replace(/(href|src)="\s*(?:javascript|data|vbscript):[^"]*"/gi, '$1="#"')
      .trim()
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
