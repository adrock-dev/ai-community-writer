import type { WebSource } from "./academy-research-web.js";

// 운전면허시험장 전용 소스 경로.
//
// 시험장은 학원과 달리 개별 홈페이지가 없다. 조사가 URL을 하나씩 찾다 보니 죽은 도메인
// (dl.koroad.or.kr — 4곳), 민원 랜딩(safedriving.or.kr/mainM.do — 3곳), URL 없음(6곳)이
// 절반을 넘었고, 남은 곳도 렌더링 전에는 전부 같은 페이지(서부)로 읽혔다.
//
// 실제로는 도로교통공단 「지방조직찾기 > 운전면허시험장」 한 페이지의 HTML 안에 전국
// 시험장 블록이 통째로 들어 있다(`<div class="mapCont cateNN">`). JS는 그중 하나만 보여줄
// 뿐이라 렌더링도 필요 없다. 이 한 번의 fetch로 27곳을 모두 덮는다.
//
// 여기서 얻는 것: 주소 · 대표번호 · 팩스 · 대중교통 경로 · 주차 등 주의사항.
// 여기 없는 것: 응시 종별 · 수수료 · 접수 절차 — 전국 공통이라 시험장별 페이지에 없다.

export const KOROAD_TEST_COURSE_PAGE =
  "https://www.koroad.or.kr/main/content/view/MN05010523.do?bcstIdx1=69&bcstIdx2=94";

export interface KoroadBlock {
  cate: string;
  name: string;
  address: string;
  tel: string;
  fax: string;
  transit: string[];
  cautions: string[];
}

// 한 페이지를 시험장 수만큼 다시 받지 않는다. 조사 배치가 시험장 27곳을 연달아 도는데
// 매번 460KB를 받을 이유가 없다.
let cache: { at: number; blocks: KoroadBlock[] } | null = null;
const CACHE_TTL_MS = 30 * 60 * 1000;

export function parseKoroadBlocks(html: string): KoroadBlock[] {
  const starts: Array<{ cate: string; at: number }> = [];
  for (const m of html.matchAll(/<div class="mapCont cate(\d+)"/g)) {
    if (m.index === undefined) continue;
    starts.push({ cate: m[1] ?? "", at: m.index });
  }
  // 마지막 블록은 그대로 두면 푸터까지 삼킨다(제주 940줄).
  const footerAt = html.indexOf("<footer");
  const blocks: KoroadBlock[] = [];
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i]!;
    const next = starts[i + 1];
    const end = next ? next.at : (footerAt > start.at ? footerAt : html.length);
    const block = blockFromLines(start.cate, htmlLines(html.slice(start.at, end)));
    if (block) blocks.push(block);
  }
  return blocks;
}

function htmlLines(segment: string): string[] {
  return segment
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function blockFromLines(cate: string, lines: string[]): KoroadBlock | null {
  const name = lines[0] ?? "";
  if (!name.includes("시험장")) return null;

  const after = (label: string): string => {
    const idx = lines.findIndex((line) => line === label);
    return idx >= 0 ? (lines[idx + 1] ?? "") : "";
  };
  // 우편번호 표기가 `(57764)` `(우편번호:03906)` `(우 : 06175)` 로 제각각이고 인천은 아예
  // 없다. 라벨 다음 줄을 그대로 쓰는 편이 형식에 걸리지 않는다.
  const address = after("주소");
  const tel = after("연락처(call)");
  const fax = after("팩스(fax)");

  const transitAt = lines.findIndex((line) => line.includes("대중교통을 이용하여"));
  const cautionAt = lines.findIndex((line) => line.includes("주의사항"));
  const transitEnd = cautionAt > transitAt ? cautionAt : lines.length;
  const transit = transitAt >= 0 ? lines.slice(transitAt + 1, transitEnd) : [];
  const cautions = cautionAt >= 0 ? lines.slice(cautionAt + 1) : [];

  return { cate, name, address, tel, fax, transit, cautions };
}

// 엉뚱한 시험장 자료가 섞이는 것이 최악이므로, 확실한 근거(주소 또는 이름 완전일치)가
// 없으면 매칭하지 않는다. 블록 이름은 "부산"인데 우리 DB는 "부산 남부"인 식으로 어긋나
// 있어 부분일치를 허용하면 남부·북부가 같은 블록을 가져간다.
export function matchKoroadBlock(blocks: KoroadBlock[], base: { name?: string | null; address?: string | null }): KoroadBlock | null {
  const wantAddress = addressKey(base.address);
  if (wantAddress) {
    const byAddress = blocks.find((block) => addressKey(block.address) === wantAddress);
    if (byAddress) return byAddress;
  }
  const wantName = normalizeName(base.name);
  if (wantName) {
    const byName = blocks.find((block) => normalizeName(block.name) === wantName);
    if (byName) return byName;
  }
  return null;
}

// 시/군/구 뒤의 도로명+번호만 비교한다. 시·도 표기가 원천과 공단 페이지에서 갈리고
// ("전라남도 나주시" vs "전남광주 나주시"), 주소 뒤에 시험장 이름이 덧붙기도 한다.
export function addressKey(value: string | null | undefined): string {
  const compact = String(value ?? "")
    .replace(/\(.*?\)/g, " ")
    .replace(/\(우[^)]*$/, " ")
    .replace(/^\s*\(?\s*(?:우편번호\s*:|우\s*:)?\s*\d{5}\s*\)?/, " ")
    .replace(/[\s,]/g, "");
  if (!compact) return "";
  // 뒤에 무엇이 붙든("…용호로 16(용호동 산 45-3번지) 남부운전면허시험장") 도로명+번호까지만
  // 본다. 원천은 딱 거기까지만 갖고 있다. 이걸 먼저 잘라야 뒤따르는 "시험장"의 '시'가
  // 행정구역으로 오인되지 않는다.
  const road = compact.match(/^.*?(?:로|길)\d+(?:번길\d+)?(?:-\d+)?/)?.[0] ?? compact;
  // 시·도 표기가 원천과 공단 페이지에서 갈린다("전라남도 나주시" vs "전남광주 나주시").
  const cut = Math.max(road.lastIndexOf("시"), road.lastIndexOf("군"), road.lastIndexOf("구"));
  const tail = cut >= 0 ? road.slice(cut + 1) : road;
  // 도로명이 잘려나갈 만큼 짧으면(예: 도로명에 '구'가 들어감) 자르지 않은 쪽을 쓴다.
  return tail.length >= 4 ? tail : road;
}

function normalizeName(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, "");
}

export function koroadBlockToSource(block: KoroadBlock): WebSource {
  const parts: string[] = [block.name];
  if (block.address) parts.push(`주소: ${block.address}`);
  if (block.tel) parts.push(`대표번호: ${block.tel}`);
  if (block.fax) parts.push(`팩스: ${block.fax}`);
  if (block.transit.length) parts.push(`대중교통으로 오는 길:\n${block.transit.join("\n")}`);
  if (block.cautions.length) parts.push(`주의사항:\n${block.cautions.join("\n")}`);
  return {
    url: `${KOROAD_TEST_COURSE_PAGE.split("?")[0]}?bcstIdx2=${block.cate}`,
    title: `${block.name} — 도로교통공단 찾아오시는 길`,
    text: parts.join("\n\n"),
  };
}

// 원천이 준 URL이 우리가 이미 통째로 받아 온 그 공단 페이지인지.
export function isKoroadTestCoursePage(url: string): boolean {
  return /(?:^|\/\/|\.)koroad\.or\.kr\//i.test(url) && url.includes("MN05010523.do");
}

export function isTestCourseType(academyType: string | null | undefined): boolean {
  const type = String(academyType ?? "");
  return type === "license_test_course" || type === "license_center";
}

export async function koroadTestCourseSource(
  base: { name?: string | null; address?: string | null },
  opts: { timeoutMs?: number } = {},
): Promise<WebSource | null> {
  const blocks = await loadKoroadBlocks(opts.timeoutMs ?? 12000);
  const block = matchKoroadBlock(blocks, base);
  return block ? koroadBlockToSource(block) : null;
}

async function loadKoroadBlocks(timeoutMs: number): Promise<KoroadBlock[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.blocks;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(KOROAD_TEST_COURSE_PAGE, {
      headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return cache?.blocks ?? [];
    const blocks = parseKoroadBlocks(await res.text());
    if (!blocks.length) return cache?.blocks ?? [];
    cache = { at: Date.now(), blocks };
    return blocks;
  } catch {
    return cache?.blocks ?? [];
  }
}

export function __resetKoroadCacheForTest(): void {
  cache = null;
}
