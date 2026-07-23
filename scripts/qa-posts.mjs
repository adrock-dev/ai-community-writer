import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

// CLI 진입점(`node scripts/qa-posts.mjs`)에서만 DB 를 열고 실행한다. import(예: test/gate-parity.test.ts)
// 시에는 부수효과 없이 순수 함수/상수만 노출한다. 이 파일의 품질 규칙은 quality-gate.ts 를 미러링하며,
// 두 곳이 어긋나면 gate-parity 테스트가 실패한다(드리프트 가드).
function main() {
  const args = process.argv.slice(2);
  const includeAll = args.includes('--all');
  const postId = optionValue('--post-id', args);
  const slotId = optionValue('--slot-id', args);
  const domain = optionValue('--domain', args);
  const dbPath = args.find((arg, index) => {
    if (arg === '--all') return false;
    if (arg.startsWith('--')) return false;
    const prev = args[index - 1];
    return !['--post-id', '--slot-id', '--domain'].includes(prev);
  }) || 'data/admin.db';
  const db = new DatabaseSync(dbPath);
  const filters = [includeAll ? "p.status != 'deleted'" : "p.status = 'published'"];
  const filterArgs = [];
  if (postId) { filters.push('p.id = ?'); filterArgs.push(postId); }
  if (slotId) { filters.push('p.slot_id = ?'); filterArgs.push(slotId); }
  if (domain) { filters.push('p.domain = ?'); filterArgs.push(domain); }
  const where = filters.join(' and ');
  const monitoredByDomain = new Map(db.prepare("select domain, monitored_phrases from domains").all().map((d) => [d.domain, parseMonitoredPhrases(d.monitored_phrases)]));
  const rows = db.prepare(`select p.id, p.domain, p.slot_id, p.slug, p.title, p.status, p.body_markdown, p.images, p.design_template_id, p.academy_count,
    (select count(*) from academies a join slots s2 on s2.slot_id=p.slot_id where a.domain=p.domain and s2.region is not null and a.region=s2.region) as exact_academy_count
    from posts p where ${where} order by p.generated_at desc`).all(...filterArgs);
  const hasTargetFilter = Boolean(postId || slotId || domain);

  const reports = rows.map((row) => ({ row, ...issuesFor(row, monitoredByDomain) }));
  const bad = reports.filter((r) => r.issues.length);
  const outputHtmlArtifacts = findOutputHtmlArtifacts(process.cwd());
  const detailTemplateIssues = detailTemplateQualityIssues();
  const selectionIssues = hasTargetFilter && rows.length === 0 ? ['no_posts_matched_filter'] : [];
  console.log(JSON.stringify({ checked: rows.length, failed: bad.length + selectionIssues.length, selectionIssues, outputHtmlArtifacts, detailTemplateIssues, failures: bad.map((r) => ({ id: r.row.id, slot_id: r.row.slot_id, status: r.row.status, chars: r.chars, h2: r.h2, h3: r.h3, tableRows: r.tableRows, listItems: r.listItems, paragraphs: r.paragraphs, faqQuestions: r.faqQuestions, images: r.imageCount, imageTokens: r.imageTokens, design_template_id: r.row.design_template_id, title: r.row.title, issues: r.issues })) }, null, 2));
  if (selectionIssues.length || bad.length || outputHtmlArtifacts.length || detailTemplateIssues.length) process.exit(1);
}

function optionValue(name, args) {
  const prefixed = args.find((arg) => arg.startsWith(`${name}=`));
  if (prefixed) return prefixed.slice(name.length + 1).trim();
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || '').trim() : '';
}

function issuesFor(row, monitoredByDomain) {
  const body = String(row.body_markdown || '');
  const images = parseImages(row.images);
  const issues = [];
  const h1 = getH1(body);
  if (!h1) issues.push('missing_h1');
  else if (normalizeTitle(h1) !== normalizeTitle(row.title)) issues.push('h1_title_mismatch');
  if (body.length < 3500) issues.push(`too_short:${body.length}`);
  if (body.length > 5600) issues.push(`too_long:${body.length}`);
  const h2 = (body.match(/^##\s+/gm) || []).length;
  const h3 = (body.match(/^###\s+/gm) || []).length;
  const tableRows = countMarkdownTableRows(body);
  const listItems = countListItems(body);
  const paragraphs = getParagraphs(body);
  const faqQuestions = countFaqQuestions(body);
  if (h2 < 4) issues.push(`few_h2:${h2}`);
  if (h2 > 10) issues.push(`too_many_h2:${h2}`);
  const readability = readabilityIssues(body);
  issues.push(...readability);
  issues.push(...aiClicheIssues(`${row.title}\n${body}`));
  issues.push(...overusedSecondPersonIssues(`${row.title}\n${body}`));
  issues.push(...repeatedSentenceIssues(body));
  issues.push(...boilerplatePhraseIssues(`${row.title}\n${body}`, monitoredByDomain.get(row.domain) || []));
  issues.push(...inconsistentListEmojiIssues(body));
  if (!row.design_template_id) issues.push('missing_design_template_id');
  if (!['editorial', 'comparison', 'local-guide', 'checklist', 'conversion', 'custom'].includes(String(row.design_template_id || ''))) issues.push(`unknown_design_template:${row.design_template_id}`);
  if (h2 >= 4 && !hasFinalUtilitySection(body)) issues.push('template_structure_missing_final_utility_section');
  if (hasFlatParagraphRun(paragraphs)) issues.push('too_flat_paragraphs');
  // 사이트 자기 공개 도메인(정상 내부링크 host)과 수강생 리뷰 출처 표기는 누출이 아니므로
  // 검사 전에 제거한다(런타임 게이트와 동일 원칙). 출처 표기는 Legacy Plus 가 필수로 요구하는
  // 공개 콘텐츠라, 여기서 걸면 한쪽에서 필수인 문장 때문에 다른 쪽에서 떨어진다.
  const leakScan = stripPublicReviewAttribution(row.domain ? (body + row.title).split(row.domain).join('') : (body + row.title));
  if (new RegExp(`운전선생|Driving\\s*Plus|DrivingPlus|api-dev\\.drivingplus\\.me|get-all-academy|zipcode/search-seo|localhost:\\d+|127\\.0\\.0\\.1|샘플|데모|sample|demo|dummy|placeholder|TODO|FIXME|내부\\s*(?:API|데이터|자료)|검증된\\s*(?:API|자료|데이터)|API\\s*(?:URL|자료|데이터)|참고\\s*API|${REVIEW_SUPPLEMENT_LEAK_PATTERN}|짧은\\s*실제\\s*문구`, 'i').test(leakScan)) issues.push('internal_or_wrong_brand_leak');
  if (/\d+\s*일\s*(?:만|컷|완성)|삼\s*일\s*(?:만|컷|완성)|하루\s*만|당일\s*합\s*격|무조건\s*합\s*격|합\s*격\s*보장|보장\s*합\s*격/u.test(body + row.title)) issues.push('risky_duration_or_pass_guarantee_claim');
  const candidateActual = Math.min(Number(row.academy_count ?? row.exact_academy_count ?? 0), 5);
  const inflated = candidateActual > 0 ? inflatedCandidateCountClaim(`${row.title}
${body}`, candidateActual) : null;
  if (inflated) issues.push(`inflated_candidate_count:${inflated.claimed}>${inflated.actual}`);
  if (/[가-힣]+(?:시|군|구|읍|면|동)운전면허학원/.test(String(row.title || '') + '\n' + body)) issues.push('keyword_spacing_issue');
  if (/상담전확인|동선확인|비용절약|셔틀편리|비교추천/.test(body + row.title)) issues.push('compact_korean_spacing');
  if (/참고자료/.test(body) && !/도로교통공단|경찰청|정부24|법제처/.test(body)) issues.push('weak_source_section');
  if (/\[(?:TABLE|CTA|FAQ|QUOTE|IMAGE|INTERNAL_LINK)_SLOT:|\[INTERNAL_LINK:/i.test(body)) issues.push('pseudo_slot');
  if (/\[\d+\]/.test(body)) issues.push('visible_citation_marker');
  if (faqQuestions > 0 && faqQuestions < 2) issues.push(`thin_faq:${faqQuestions}`);
  if (!listItems) issues.push('missing_list');
  if (!hasRichStructure({ tableRows, listItems, faqQuestions })) issues.push('missing_rich_structure');
  if (tableRows < 3) issues.push(`missing_summary_or_comparison_table:${tableRows}`);
  const imageKeys = Object.keys(images);
  const usedImageKeys = [...body.matchAll(/\[IMAGE:([A-Za-z0-9_-]+)\]/g)].map((m) => m[1]);
  if (imageKeys.length && !usedImageKeys.length) issues.push('missing_available_image_slot');
  const unknown = usedImageKeys.filter((key) => !imageKeys.includes(key));
  if (unknown.length) issues.push(`unknown_image:${[...new Set(unknown)].join(',')}`);
  const rendered = renderMarkdown(body, images);
  issues.push(...renderedSurfaceIssues(rendered, { h2, tableRows, usedImageKeys }));
  return { issues, chars: body.length, h2, h3, tableRows, listItems, paragraphs: paragraphs.length, faqQuestions, imageCount: imageKeys.length, imageTokens: usedImageKeys.length };
}

function readabilityIssues(body) {
  const issues = [];
  const paragraphs = getParagraphs(body);
  const long = paragraphs.filter((paragraph) => paragraph.length > 420);
  if (long.length) issues.push(`overlong_paragraph:${Math.max(...long.map((p) => p.length))}`);
  if (adjacentHeadingCount(body) > 0) issues.push('adjacent_headings_without_body');
  if (orphanHeadingCount(body) > 1) issues.push('too_many_thin_or_empty_heading_sections');
  issues.push(...sentenceDifficultyIssues(paragraphs));
  return issues;
}

// 내부 누출 검사의 공유 조각: quality-gate.ts 의 동명 상수/함수와 동일해야 한다.
// 어긋나면 test/gate-parity.test.ts 가 실패한다.
const PUBLIC_REVIEW_ATTRIBUTION_PATTERN = "출처:\\s*DrivingPlus\\s+수강생\\s+리뷰";
function stripPublicReviewAttribution(text) {
  return String(text || '').replace(new RegExp(PUBLIC_REVIEW_ATTRIBUTION_PATTERN, 'gi'), '');
}
const REVIEW_SUPPLEMENT_LEAK_PATTERN = "(?:긍정\\s*)?(?:수강생|블로그)\\s*리뷰(?:글)?\\s*보충자료";

// 한 목록 안에서 항목 앞 이모지가 2종 이상 섞이면 실패 — quality-gate.ts 의 inconsistentListEmojiIssues 미러.
// 이모지 자체는 허용하되(체크리스트 ✅ 등) 같은 계열 항목은 같은 이모지로 통일해야 한다는 규칙 중,
// 기계적으로 검출 가능한 부분만 강제한다. 화살표(U+2190~21FF)는 제외해 오탐을 막는다.
const LIST_EMOJI_CLASS = '\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{1F000}-\\u{1FAFF}✅✔✓';
function inconsistentListEmojiIssues(markdown) {
  const emoji = new RegExp(`^\\s*(?:[-*]\\s+|\\d+[.)]\\s+)?([${LIST_EMOJI_CLASS}])\\uFE0F?`, 'u');
  const listItem = new RegExp(`^\\s*(?:[-*]\\s+|\\d+[.)]\\s+|[${LIST_EMOJI_CLASS}])`, 'u');
  let block = null;
  const closeBlock = () => { const bad = !!block && block.size >= 2; block = null; return bad; };
  for (const line of String(markdown || '').split(/\r?\n/)) {
    if (listItem.test(line)) {
      block ??= new Set();
      const m = line.match(emoji);
      if (m) block.add(m[1]);
    } else if (closeBlock()) {
      return ['inconsistent_list_emoji'];
    }
  }
  return closeBlock() ? ['inconsistent_list_emoji'] : [];
}

// 거리·이동시간 단정 검사 — quality-gate.ts 의 distanceClaimIssues 미러.
// 후보를 거리로 뽑더라도 본문에서 거리를 주장하면 안 된다(직선거리는 실제 이동을 설명하지 못한다).
function distanceClaimIssues(markdown) {
  const text = String(markdown || '');
  const issues = [];
  if (/\d+(?:\.\d+)?\s*(?:km|킬로미터)/iu.test(text)) issues.push('distance_number_claim');
  if (/(?:직선\s*거리|도로\s*거리|이동\s*시간|소요\s*시간|차로\s*\d+\s*분|도보\s*\d+\s*분)/u.test(text)) issues.push('travel_time_claim');
  return issues;
}

// 제목 부제가 주장하는 축을 facts 가 뒷받침하는지 — quality-gate.ts 의 titleAxisEvidenceIssues 미러.
function titleAxisEvidenceIssues(title, facts) {
  const t = String(title || '');
  const f = String(facts || '');
  const issues = [];
  const claims = [
    [/후기|리뷰/u, /수강생 리뷰:/u, 'title_claims_review_without_facts'],
    [/셔틀/u, /셔틀:/u, 'title_claims_shuttle_without_facts'],
    [/수강료|비용|최저가|가격/u, /수강료:/u, 'title_claims_price_without_facts'],
    [/야간|주말|운영\s*시간|시간대/u, /영업시간:/u, 'title_claims_hours_without_facts'],
  ];
  for (const [inTitle, inFacts, code] of claims) {
    if (inTitle.test(t) && !inFacts.test(f)) issues.push(code);
  }
  return issues;
}

// AI 상투표현 검사: quality-gate.ts 의 aiClicheIssues 와 동일 목록/규칙(형식적 메타서술·블로그 프레임·판박이 마무리).
const AI_CLICHE_PHRASES = [
  "알아보겠습니다", "알아보도록", "알아보는 시간", "살펴보겠습니다", "살펴보도록", "짚어보겠습니다",
  "정리해보겠습니다", "정리해 보겠습니다", "정리해드리겠습니다", "살펴보았습니다", "알아봤습니다",
  "이 글에서는", "이번 글에서는", "이번 포스팅", "본 포스팅", "포스팅에서는",
  "도움이 되셨", "도움이 되길 바", "도움이 되기를 바", "참고하시기 바랍니다", "마무리하겠습니다", "마치겠습니다",
];

// quality-gate.ts 미러: "여러분"은 2인칭 호칭이라 한 번 등장은 정상이고 남발만 잡는다.
const SECOND_PERSON_ADDRESS = "여러분";
const SECOND_PERSON_ADDRESS_LIMIT = 3;
function overusedSecondPersonIssues(text) {
  const count = String(text || '').split(SECOND_PERSON_ADDRESS).length - 1;
  return count >= SECOND_PERSON_ADDRESS_LIMIT ? [`overused_second_person_${count}`] : [];
}
function aiClicheIssues(text) {
  const found = AI_CLICHE_PHRASES.filter((phrase) => text.includes(phrase));
  return found.length ? [`ai_cliche_expressions:${found.join('·')}`] : [];
}

// quality-gate.ts 의 BOILERPLATE_PHRASES/boilerplatePhraseIssues/repeatedSentenceIssues 와 동일 규칙(미러).
const BOILERPLATE_PHRASES = [
  "확인된 후보 정보와 상담 전 체크포인트를 기준으로",
  "실제로 비교할 때 도움이 되는 내용만",
  "후기 요약에서는 친절한 상담·응대와 강사의 꼼꼼한 설명이 확인됩니다",
  "정리하면 선택 기준은 단순",
];
function boilerplatePhraseIssues(text, extra = []) {
  const found = [...BOILERPLATE_PHRASES, ...extra].filter((phrase) => phrase && text.includes(phrase));
  return found.length ? [`boilerplate_phrase:${found.join('·')}`] : [];
}
// exclusions.ts 의 parseMonitoredPhrases 와 동일(대소문자 보존).
function parseMonitoredPhrases(raw) {
  const source = Array.isArray(raw) ? raw.join('\n') : String(raw || '');
  return [...new Set(source.split(/\r?\n|,/).map((v) => v.trim()).filter(Boolean))];
}
function repeatedSentenceIssues(markdown) {
  const counts = new Map();
  for (const para of getParagraphs(String(markdown || ''))) {
    for (const sentence of splitSentences(para)) {
      const norm = sentence.replace(/\s+/g, ' ').trim();
      if (norm.length < 16) continue;
      counts.set(norm, (counts.get(norm) || 0) + 1);
    }
  }
  const repeated = [...counts.values()].filter((n) => n >= 2).length;
  return repeated ? [`repeated_sentence:${repeated}`] : [];
}

// 문장 난이도(가독성): run-on 문장 검사. quality-gate.ts 의 sentenceDifficultyIssues 와 동일 규칙.
const HARD_SENTENCE_CHARS = 150;
const OVERLONG_SENTENCE_CHARS = 220;
function sentenceDifficultyIssues(paragraphs) {
  const issues = [];
  const lengths = paragraphs.flatMap(splitSentences).map((sentence) => sentence.length);
  if (!lengths.length) return issues;
  const longest = Math.max(...lengths);
  const hard = lengths.filter((n) => n >= HARD_SENTENCE_CHARS).length;
  if (longest >= OVERLONG_SENTENCE_CHARS) issues.push(`overlong_sentence:${longest}`);
  else if (hard >= 2) issues.push(`hard_sentences:${hard}`);
  return issues;
}

// 링크 URL·강조 마커는 독자가 읽는 문장 길이가 아니므로 제거 후 문장 단위로 나눈다.
function splitSentences(paragraph) {
  return String(paragraph || '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\*\*|__|[*_`]/g, '')
    .split(/(?<=[.!?。…])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

// `## 큰 주제` 다음에 `### 개별 항목`이 오는 것(상위→하위)은 정상 구조다. 사람이 쓴 글에서도
// 흔하고, 하위 항목마다 본문이 있으면 읽는 데 문제가 없다. 예전에는 이것도 결함으로 보고
// 후처리(ensureHeadingBodies)가 제목을 되풀이하는 문장을 끼워 넣어 통과시켰는데, 그 문장은
// 정보량이 0이라 모든 글의 품질을 떨어뜨렸다. 같은 깊이 이하가 연달아 나올 때만 결함으로 본다
// (`### 학원A` → `### 학원B` 는 실제로 내용이 빠진 것이다).
function headingDepth(line) {
  return (String(line).trim().match(/^#+/) || [""])[0].length;
}
function adjacentHeadingCount(body) {
  const lines = String(body || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let count = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    const current = lines[i] || '', next = lines[i + 1] || '';
    if (/^#{2,3}\s+/.test(current) && /^#{2,3}\s+/.test(next) && headingDepth(next) <= headingDepth(current)) count++;
  }
  return count;
}

function orphanHeadingCount(body) {
  const sections = String(body || '').split(/^##\s+/gm).slice(1);
  let count = 0;
  for (const section of sections) {
    const lines = section.split(/\r?\n/);
    lines.shift();
    const text = lines.join('\n')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/\[IMAGE:[A-Za-z0-9_-]+\]/g, '')
      .replace(/^\|.+\|$/gm, '')
      .replace(/(^|\n)\s*(?:[-*]\s+|\d+[.)]\s+|✅|✓).*$/gm, '')
      .replace(/^#{3,6}\s+.+$/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length > 0 && text.length < 80) count++;
  }
  return count;
}

function inflatedCandidateCountClaim(markdown, actual) {
  if (!actual || actual < 1) return null;
  const headings = [...String(markdown || '').matchAll(/^#{1,3}\s+(.+)$/gm)].map((m) => m[1] || '');
  const titleLine = String(markdown || '').split(/\r?\n/, 1)[0] || '';
  const targets = [...new Set([titleLine.replace(/^#\s+/, ''), ...headings])];
  let maxClaim = 0;
  for (const target of targets) for (const count of candidateCountClaims(target)) maxClaim = Math.max(maxClaim, count);
  return maxClaim > actual ? { claimed: maxClaim, actual } : null;
}

function candidateCountClaims(value) {
  const text = String(value || '');
  const claims = [];
  const patterns = [
    /(?:BEST|TOP)\s*(\d{1,2})/giu,
    /(?:추천|비교|후보|학원)\s*(\d{1,2})\s*(?:곳|개)/gu,
    /(\d{1,2})\s*(?:곳|개)\s*(?:추천|비교|후보|학원)/gu,
    /운전면허학원\s*(\d{1,2})\s*(?:곳|개)/gu,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const n = Number(match[1]);
      if (Number.isFinite(n)) claims.push(n);
    }
  }
  return claims;
}

function getH1(body) {
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : '';
}

function normalizeTitle(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getParagraphs(body) {
  return body
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part && !/^(?:#{1,6}\s+|\|.+\||[-*]\s+|\d+[.)]\s+|>|\[IMAGE:)/m.test(part));
}

function hasFlatParagraphRun(paragraphs) {
  let run = 0;
  for (const paragraph of paragraphs) {
    if (paragraph.length > 360 || paragraph.split(/[.!?。]|[다요죠음임함됨봄룸움]\./).filter(Boolean).length > 6) {
      run += 1;
      if (run >= 2) return true;
    } else {
      run = 0;
    }
  }
  return false;
}

function countMarkdownTableRows(body) {
  const rows = body.match(/^\|.+\|$/gm) || [];
  return rows.filter((row) => !/^\|?[\s:|-]+\|?$/.test(row)).length;
}

function countListItems(body) {
  return (body.match(/(^|\n)\s*(?:[-*]\s+|\d+[.)]\s+|✅|✓)/g) || []).length;
}

function countFaqQuestions(body) {
  const faqStart = body.search(/^(?:##|###)\s+.*(?:FAQ|자주 묻는 질문|질문과 답변)/im);
  if (faqStart < 0) return 0;
  const faq = body.slice(faqStart);
  const matches = faq.match(/(^|\n)\s*(?:#{2,4}\s*)?(?:[-*]\s*)?(?:Q[.:)]|Q\d+[.)]|질문\s*\d*|[가-힣\s]+(?:인가요|되나요|하나요|좋나요|있나요)\?)/g);
  return matches ? matches.length : 0;
}

function hasFinalUtilitySection(body) {
  const headings = [...body.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1]);
  return headings.some((heading) => /FAQ|자주 묻는 질문|질문과 답변|체크리스트|상담|확인|마무리|요약|추천 대상|선택 기준|고르는 기준|이런 사람|물어보세요/i.test(heading));
}

function hasRichStructure({ tableRows, listItems, faqQuestions }) {
  const blocks = [tableRows >= 3, listItems >= 3, faqQuestions >= 2].filter(Boolean).length;
  return blocks >= 2;
}

function parseImages(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    if (Array.isArray(parsed)) return Object.fromEntries(parsed.map((url, i) => [`image_${i + 1}`, url]));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function renderedSurfaceIssues(html, expected) {
  const issues = [];
  const text = stripTags(html);
  const h1Count = (html.match(/<h1>/g) || []).length;
  const h2Count = (html.match(/<h2>/g) || []).length;
  const tableRowCount = (html.match(/<tr>/g) || []).length;
  const renderedImageCount = (html.match(/<figure class="post-image">/g) || []).length;
  if (!html.trim()) issues.push('rendered_empty');
  if (/\[IMAGE:[A-Za-z0-9_-]+\]/.test(html)) issues.push('rendered_raw_image_token');
  // 이미지 alt 가 비었거나 image key(academy_1, generated_hero 등) 그대로면 접근성·이미지 SEO 저하.
  const badAlts = [...html.matchAll(/<img\b[^>]*\balt="([^"]*)"/g)].map((m) => m[1]).filter((alt) => !alt.trim() || /^(?:academy_\d+|generated_[A-Za-z0-9_]+)$/i.test(alt));
  if (badAlts.length) issues.push(`rendered_low_quality_alt:${badAlts.length}`);
  if (/\[(?:TABLE|CTA|FAQ|QUOTE|IMAGE)_SLOT:/i.test(html)) issues.push('rendered_pseudo_slot');
  if (/[가-힣]+(?:시|군|구|읍|면|동)운전면허학원/.test(text)) issues.push('rendered_keyword_spacing_issue');
  if (h1Count !== 1) issues.push(`rendered_h1_count:${h1Count}`);
  if (h2Count < expected.h2) issues.push(`rendered_missing_h2:${h2Count}/${expected.h2}`);
  if (tableRowCount < expected.tableRows) issues.push(`rendered_missing_table_rows:${tableRowCount}/${expected.tableRows}`);
  if (expected.usedImageKeys.length && renderedImageCount !== expected.usedImageKeys.length) issues.push(`rendered_image_mismatch:${renderedImageCount}/${expected.usedImageKeys.length}`);
  if (/<h1>[\s\S]*\n[\s\S]*<\/h1>/.test(html)) issues.push('rendered_h1_wraps_body');
  // 마크다운 마커가 벗겨지지 않은 채 문단으로 떨어진 경우(리스트가 문단으로 렌더된 흔적).
  // 발행 글 21건 중 7건에서 체크리스트 마지막 항목이 `<p>- ✅ …</p>` 로 새던 것을 잡는다.
  const markerParagraphs = (html.match(/<p>\s*(?:[-*]\s+|\d+[.)]\s+)/g) || []).length;
  if (markerParagraphs) issues.push(`rendered_list_marker_in_paragraph:${markerParagraphs}`);
  return issues;
}

function renderMarkdown(markdown, images = {}) {
  // 이미지 alt 는 직전 섹션 헤딩을 문맥으로 쓴다(post-rendering.ts 와 동일 규칙).
  let currentHeading = '';
  return markdownBlocks(markdown).map((raw) => {
    if (/^#{1,3}\s+/.test(raw)) currentHeading = plainText(raw.replace(/^#{1,3}\s+/, ''));
    return renderMarkdownBlock(raw, images, currentHeading);
  }).filter(Boolean).join('\n');
}

// post-rendering.ts 의 plainText/imageAltFor 와 동일 규칙(미러).
function plainText(md) {
  return String(md || '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function imageAltFor(key, heading = '') {
  const h = plainText(heading);
  if (h) return h;
  return /^generated_/.test(key) ? '운전면허학원 안내 이미지' : '운전면허학원 사진';
}

function markdownBlocks(markdown) {
  const blocks = [];
  let current = [];
  let currentKind = null;
  // 리스트 도중의 빈 줄은 CommonMark 의 loose list 이지 리스트의 끝이 아니다(post-rendering.ts 와 동일 규칙).
  let pendingListBreak = false;
  const flush = () => {
    pendingListBreak = false;
    if (!current.length) return;
    blocks.push(current.join('\n').trim());
    current = [];
    currentKind = null;
  };
  for (const line of String(markdown || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed && currentKind === 'list') { pendingListBreak = true; continue; }
    if (!trimmed || /^\[(?:IMAGE|TABLE|CTA|FAQ|QUOTE)_SLOT:[^\]]+\]$/i.test(trimmed)) { flush(); continue; }
    const mixedImageBlocks = splitMixedImageTokenLine(trimmed);
    if (mixedImageBlocks) { flush(); blocks.push(...mixedImageBlocks); continue; }
    if (/^#{1,3}\s+/.test(trimmed) || /^\[IMAGE:[A-Za-z0-9_-]+\]$/.test(trimmed)) { flush(); blocks.push(trimmed); continue; }
    const kind = trimmed.includes('|') ? 'table' : isListLine(trimmed) ? 'list' : trimmed.startsWith('>') ? 'quote' : 'paragraph';
    if (pendingListBreak) { if (kind !== 'list') flush(); pendingListBreak = false; }
    if (currentKind && currentKind !== kind) flush();
    currentKind = kind;
    current.push(trimmed);
  }
  flush();
  return blocks;
}

function splitMixedImageTokenLine(line) {
  if (!/\[IMAGE:[A-Za-z0-9_-]+\]/.test(line) || line.includes('|')) return null;
  const tokens = [...line.matchAll(/\[IMAGE:[A-Za-z0-9_-]+\]/g)].map((match) => match[0]);
  const text = line
    .replace(/\[IMAGE:[A-Za-z0-9_-]+\]/g, ' ')
    .replace(/[→|,/]+/g, ' ')
    .replace(/(?:사진|이미지)\s*(?:순서)?\s*[:：-]?/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? [text, ...tokens] : tokens;
}

function renderMarkdownBlock(raw, images, heading = '') {
  if (/^\[(?:IMAGE|TABLE|CTA|FAQ|QUOTE)_SLOT:[^\]]+\]$/i.test(raw)) return '';
  const imageMatch = raw.match(/^\[IMAGE:([A-Za-z0-9_-]+)\]$/);
  if (imageMatch) {
    const src = images[imageMatch[1]];
    return src ? `<figure class="post-image"><img src="${escapeAttr(src)}" alt="${escapeAttr(imageAltFor(imageMatch[1], heading))}" loading="lazy" /></figure>` : '';
  }
  if (isMarkdownTable(raw)) return renderMarkdownTable(raw);
  if (isMarkdownListBlock(raw)) return renderMarkdownList(raw);
  if (raw.startsWith('>')) return `<blockquote>${renderInline(raw.replace(/^>\s?/gm, '')).replace(/\n/g, '<br>')}</blockquote>`;
  if (raw.startsWith('# ')) return `<h1>${renderInline(raw.slice(2))}</h1>`;
  if (raw.startsWith('## ')) return `<h2>${renderInline(raw.slice(3))}</h2>`;
  if (raw.startsWith('### ')) return `<h3>${renderInline(raw.slice(4))}</h3>`;
  return `<p>${renderInline(raw).replace(/\n/g, '<br>')}</p>`;
}

function isListLine(line) {
  return /^[-*]\s+/.test(line) || /^\d+[.)]\s+/.test(line) || /^[✅✔✓]\s*/.test(line);
}

function isMarkdownListBlock(raw) {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return false;
  if (lines.length >= 2) return lines.every(isListLine);
  // 한 줄짜리 블록은 진짜 마크다운 마커일 때만 리스트로 본다(post-rendering.ts 와 동일 규칙).
  return /^[-*]\s+/.test(lines[0]) || /^\d+[.)]\s+/.test(lines[0]);
}

function renderMarkdownList(raw) {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const ordered = lines.every((line) => /^\d+[.)]\s+/.test(line));
  const tag = ordered ? 'ol' : 'ul';
  const items = lines.map((line) => line.replace(/^[-*]\s+/, '').replace(/^\d+[.)]\s+/, '').replace(/^[✅✔✓]\s*/, ''));
  return `<${tag}>${items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</${tag}>`;
}

function isMarkdownTable(raw) {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length >= 3 && lines[0].includes('|') && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(lines[1]);
}

function renderMarkdownTable(raw) {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const header = splitTableRow(lines[0]);
  const rows = lines.slice(2).map(splitTableRow).filter((row) => row.length);
  return `<div class="post-table-wrap"><table><thead><tr>${header.map((cell) => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${header.map((_, i) => `<td>${renderInline(row[i] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function splitTableRow(line) {
  return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function renderInline(raw) {
  let s = escapeHtml(raw);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label, url) => `<a href="${escapeAttr(url)}" target="_blank" rel="nofollow noopener">${label}</a>`);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  s = s.replace(/\[(\d+)\]/g, '<sup class="cite">[$1]</sup>');
  return s;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

function stripTags(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ');
}

function detailTemplateQualityIssues() {
  const issues = [];
  let source = '';
  try {
    source = readFileSync('apps/admin-next/components/PostDetailClient.tsx', 'utf8');
  } catch (error) {
    return [`detail_template_unreadable:${error.message}`];
  }
  if (/<h4>\{post\.title\}<\/h4>/.test(source)) issues.push('detail_duplicate_title_after_hero');
  if (/className="[^"]*post-lead[^"]*"/.test(source) || /class="[^"]*post-lead[^"]*"/.test(source)) issues.push('detail_duplicate_meta_description_after_hero');
  if (/preview-hero[\s\S]{0,800}post\.meta_description/.test(source)) issues.push('detail_duplicate_meta_description_in_hero');
  if (/pageBg:\s*"#(?!fff(?:fff)?")/i.test(source)) issues.push('detail_article_background_not_white');
  return issues;
}

function findOutputHtmlArtifacts(root) {
  const found = [];
  walk(root, found);
  return found.sort();
}

function walk(dir, found) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  const isOutputDir = basename(dir) === 'output';
  for (const entry of entries) {
    if (['.git', '.next', 'dist', 'node_modules', '.omx'].includes(entry)) continue;
    const path = join(dir, entry);
    let stat;
    try { stat = statSync(path); } catch { continue; }
    if (stat.isDirectory()) {
      walk(path, found);
    } else if (isOutputDir && entry.endsWith('.html')) {
      found.push(relative(process.cwd(), path));
    }
  }
}

// quality-gate.ts 미러(드리프트 가드용). test/gate-parity.test.ts 가 import 해서 quality-gate 와 대조한다.
export { inconsistentListEmojiIssues, distanceClaimIssues, titleAxisEvidenceIssues, adjacentHeadingCount, AI_CLICHE_PHRASES, SECOND_PERSON_ADDRESS, SECOND_PERSON_ADDRESS_LIMIT, overusedSecondPersonIssues, BOILERPLATE_PHRASES, HARD_SENTENCE_CHARS, OVERLONG_SENTENCE_CHARS, aiClicheIssues, boilerplatePhraseIssues, repeatedSentenceIssues, sentenceDifficultyIssues, PUBLIC_REVIEW_ATTRIBUTION_PATTERN, REVIEW_SUPPLEMENT_LEAK_PATTERN, stripPublicReviewAttribution, renderMarkdown };

// CLI 진입점으로 직접 실행됐을 때만 main() 을 돌린다(import 시에는 부수효과 없음).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
