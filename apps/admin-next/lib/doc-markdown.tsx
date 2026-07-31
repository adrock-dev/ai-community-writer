import type React from "react";

/**
 * **가이드 문서 전용** 마크다운 렌더러.
 *
 * 생성 글 본문 렌더러(`api-nest` 의 `post-rendering.ts` 와 `scripts/qa-posts.mjs` 미러)와는
 * **아무 관계가 없다.** 그쪽은 공개 글의 계약이라 게이트가 대조하고 둘을 함께 고쳐야 하지만,
 * 이건 사내 문서를 화면에 띄우기 위한 것이다. 그쪽을 고칠 때 여기를 볼 필요도, 그 반대도 없다.
 *
 * 의존성을 쓰지 않는다 — 문서 한 벌 보려고 패키지를 넣는 것은 과하다. 대신 우리 문서가 실제로
 * 쓰는 요소만 처리한다(헤딩·표·코드블록·목록·굵게·인라인코드·링크·수평선). 문서에 새 문법을
 * 쓰기 시작하면 여기도 같이 늘려야 한다.
 *
 * React 요소로 만들어 돌려주므로 HTML 문자열 주입(dangerouslySetInnerHTML)이 없다.
 */

type Inline = React.ReactNode;

// `code` · **bold** · *italic* · [text](url) 만 처리한다. 서로 겹치지 않게 한 번에 훑는다.
// **bold 를 italic 보다 먼저** 두어야 `**x**` 가 `*` 하나로 잘리지 않는다.
function renderInline(text: string, keyPrefix: string): Inline[] {
  const out: Inline[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))|(\*[^*\n]+\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-i${i++}`;
    if (token.startsWith("`")) out.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("**")) out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("*")) out.push(<em key={key}>{token.slice(1, -1)}</em>);
    else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      // 외부로 나가는 링크는 없지만, 문서에 생기더라도 새 탭·noreferrer 로 연다.
      out.push(link ? <a key={key} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a> : token);
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableDivider = (line: string) => /^\s*\|[\s|:-]+\|\s*$/.test(line);

export function renderDocMarkdown(markdown: string): React.ReactNode[] {
  const lines = markdown.split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (line.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").startsWith("```")) buf.push(lines[i++] ?? "");
      i++;
      blocks.push(<pre key={`b${key++}`}><code>{buf.join("\n")}</code></pre>);
      continue;
    }

    if (/^\s*\|/.test(line)) {
      const rows: string[] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i] ?? "")) rows.push(lines[i++] ?? "");
      const body = rows.filter((r) => !isTableDivider(r));
      const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const [head, ...rest] = body;
      blocks.push(
        <div className="doc-table-wrap" key={`b${key++}`}>
          <table>
            {head ? <thead><tr>{cells(head).map((c, ci) => <th key={ci}>{renderInline(c, `h${ci}`)}</th>)}</tr></thead> : null}
            <tbody>
              {rest.map((row, ri) => (
                <tr key={ri}>{cells(row).map((c, ci) => <td key={ci}>{renderInline(c, `r${ri}c${ci}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      const Tag = `h${Math.min(level, 6)}` as "h1";
      blocks.push(<Tag key={`b${key++}`}>{renderInline(heading[2] ?? "", `hd${key}`)}</Tag>);
      i++;
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) { blocks.push(<hr key={`b${key++}`} />); i++; continue; }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: Array<{ depth: number; text: string }> = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? "")) {
        const m = (lines[i] ?? "").match(/^(\s*)[-*]\s+(.*)$/);
        items.push({ depth: (m?.[1]?.length ?? 0) >= 2 ? 1 : 0, text: m?.[2] ?? "" });
        i++;
      }
      blocks.push(
        <ul key={`b${key++}`}>
          {items.map((item, idx) => (
            <li key={idx} className={item.depth ? "sub" : undefined}>{renderInline(item.text, `li${idx}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (!line.trim()) { i++; continue; }

    // 연속한 줄은 한 문단으로 묶는다(마크다운의 소프트 랩).
    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() &&
      !/^\s*[-*]\s+/.test(lines[i] ?? "") &&
      !/^\s*\|/.test(lines[i] ?? "") &&
      !/^#{1,6}\s/.test(lines[i] ?? "") &&
      !(lines[i] ?? "").startsWith("```") &&
      !/^\s*---+\s*$/.test(lines[i] ?? "")
    ) para.push(lines[i++] ?? "");
    blocks.push(<p key={`b${key++}`}>{renderInline(para.join(" "), `p${key}`)}</p>);
  }

  return blocks;
}
