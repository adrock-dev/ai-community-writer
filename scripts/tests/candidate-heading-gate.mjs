function candidateHeadingMatchCount(markdown, candidateNames) {
  const headings = Array.from(markdown.matchAll(/^###\s+(.+)$/gm))
    .map((match) => normalizeCandidateHeading(String(match[1] || '')));
  let matched = 0;
  for (const name of candidateNames) {
    const normalizedName = normalizeCandidateHeading(name);
    if (!normalizedName || normalizedName.length < 3) continue;
    if (headings.some((heading) => heading === normalizedName || heading.includes(normalizedName))) matched++;
  }
  return matched;
}

function normalizeCandidateHeading(value) {
  return String(value || '')
    .replace(/^[\d.)\s]+/, '')
    .replace(/[\s*_`#()（）·.,:：—\-]/g, '')
    .toLowerCase();
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    console.error(`${message}: expected ${expected}, got ${actual}`);
    process.exit(1);
  }
}

const names = ['진주중앙운전학원', '진주동부운전학원', '정촌자동차운전학원'];
assertEqual(candidateHeadingMatchCount('### 진주\n본문', names), 0, 'generic regional heading must not satisfy candidates');
assertEqual(candidateHeadingMatchCount('### 진주중앙운전학원\n본문\n### 진주동부운전학원\n본문', names), 2, 'exact candidate headings should match');
assertEqual(candidateHeadingMatchCount('### 1. 진주중앙운전학원 — 상담 포인트\n본문', names), 1, 'candidate heading may include a suffix after the full candidate name');
console.log(JSON.stringify({ ok: true }));
