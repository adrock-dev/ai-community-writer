// LLM 출력(구분자 형식) 해석.

export interface DraftArticle {
  title: string;
  summary: string;
  keywords: string[];
  /** Markdown. 첫 줄은 `# 제목`. */
  body: string;
}

const MARKERS = ["TITLE", "SUMMARY", "KEYWORDS", "BODY", "END"] as const;

/** 구분자 형식을 읽는다. 본문이 없으면 undefined (출력 형식 오류). */
export function parseDraft(output: string): DraftArticle | undefined {
  // 모델이 코드 블록으로 감싸는 경우가 있어 벗긴다.
  const text = output.replace(/^\s*```[a-z]*\s*\n/i, "").replace(/\n```\s*$/, "");
  const parts: Partial<Record<(typeof MARKERS)[number], string>> = {};
  const re = /<<<(TITLE|SUMMARY|KEYWORDS|BODY|END)>>>/g;
  const found = [...text.matchAll(re)];
  found.forEach((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = found[i + 1]?.index ?? text.length;
    parts[m[1] as (typeof MARKERS)[number]] = text.slice(start, end).trim();
  });
  let body = (parts.BODY ?? "").trim();
  if (!body) return undefined;

  const h1 = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  const title = (parts.TITLE ?? "").split("\n")[0]?.trim() || h1 || "";
  if (!h1) body = `# ${title}\n\n${body}`;
  return {
    title,
    summary: (parts.SUMMARY ?? "").replace(/\s+/g, " ").trim(),
    keywords: (parts.KEYWORDS ?? "")
      .split(/[,，\n]/)
      .map((k) => k.trim())
      .filter(Boolean),
    body,
  };
}
