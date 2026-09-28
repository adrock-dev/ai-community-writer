import { Marked } from "marked";

// 원고(Markdown) → 채널 형식.
//   drivingplus 커뮤니티: Markdown (content_format=md)
//   드라이빙존 블로그·연수 블로그: 에디터 HTML
//   카페: 붙여넣기용 텍스트 + 서식 복사용 HTML
// 제목은 대상 시스템에서 별도 필드이므로 본문 첫 줄의 H1은 뺀다.

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// 원고에 섞인 원시 HTML은 실행되지 않게 글자로 바꾼다.
const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
  },
});

/** 본문 맨 앞의 `# 제목` 한 줄을 뺀다. */
export function stripTitle(markdown: string): string {
  return markdown.replace(/^\s*#\s+[^\n]*\n+/, "").trimStart();
}

export function markdownToHtml(markdown: string): string {
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
