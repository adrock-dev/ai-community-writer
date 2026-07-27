import type { ResearchBaseRef } from "./academy-research-llm.js";
import { emptyKnownFacts, type KnownFacts } from "./academy-research-known-facts.js";

// B안: CLI 웹툴에 의존하지 않고, 서버(Node)가 직접 검색·페이지를 fetch 해서
// 그 본문을 LLM에 넘겨 "소스에 있는 사실만" 추출한다. 근거 URL을 함께 확보한다.

export interface WebSource { url: string; title: string; text: string }

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const MAX_SOURCES = 4;
// 플레이스는 사실 밀도가 압도적이라 우선 확보한다. 다만 동명 학원이 섞일 수 있어 개수는 제한한다.
const MAX_PLACE_SOURCES = 2;
const MAX_CHARS_PER_SOURCE = 3500;
const NEEDLE_FIELDS = ["셔틀", "노선", "운행", "시간", "가격", "수강료", "교육비", "주말", "야간"];

// 학원 하나에 대해 후보 URL을 찾아 페이지 본문까지 수집.
export async function gatherSources(base: ResearchBaseRef, opts: { maxSources?: number; timeoutMs?: number } = {}): Promise<WebSource[]> {
  const maxSources = opts.maxSources ?? MAX_SOURCES;
  const timeoutMs = opts.timeoutMs ?? 12000;
  const name = String(base.name ?? "").trim();
  if (!name) return [];

  const queries = dedupe([
    `${name} ${base.region ?? ""}`.trim(),
    `${name} 운전전문학원 ${base.region ?? ""}`.trim(),
    base.phone ? `${name} ${base.phone}` : "",
    base.address ? `${name} ${firstAddrToken(base.address)}` : "",
  ].filter(Boolean));

  // 1) 검색으로 후보 수집. 네이버 플레이스 id 와 일반 URL 을 함께 얻는다.
  const placeIds: string[] = [];
  const urls: string[] = [];
  for (const q of queries) {
    if (urls.length >= maxSources * 3 && placeIds.length) break;
    try {
      const found = await naverSearch(q, timeoutMs);
      placeIds.push(...found.placeIds);
      urls.push(...found.urls);
    } catch { /* 무시 */ }
  }

  const sources: WebSource[] = [];

  // 2) 플레이스 먼저. 영업시간·전화·주소·편의시설이 구조화돼 있어 사실 밀도가 가장 높다.
  for (const placeId of dedupe(placeIds).slice(0, MAX_PLACE_SOURCES)) {
    try {
      const place = await fetchPlaceSource(placeId, timeoutMs, base.address);
      if (place && sourceMatchesTarget(base, place)) sources.push(place);
    } catch { /* 무시 */ }
  }

  // 3) 남는 자리에 일반 페이지. 정적 HTML이 부족하면 Playwright 렌더링으로 보강.
  //
  // 플레이스가 알려준 공식 홈페이지를 최우선 후보로 얹는다. 플레이스에는 영업시간·전화·
  // 주소·편의시설만 있고 수강료·셔틀·합격률이 없는데, 그 셋이 학원별 차별화의 재료다.
  // 검색 결과 파싱에 기대지 않고 확보할 수 있는 가장 확실한 경로다.
  const homepages = new Set(sources.flatMap((s) => homepageUrlsFromPlaceText(s.text)));
  const candidates = limitPerHost(dedupe([...homepages, ...rankCandidates(dedupe(urls))])).slice(0, maxSources);
  for (const url of candidates) {
    if (sources.length >= maxSources) break;
    try {
      const fetched = await fetchReadable(url, timeoutMs);
      let page: WebSource | null = fetched;
      if (shouldTryRenderedFetch(page)) {
        page = await fetchRenderedReadable(url, timeoutMs).catch(() => page);
      }
      if (!page || page.text.length < 200) continue;
      // 플레이스가 그 업체의 홈페이지로 지목한 주소는 신원이 이미 확인된 것이다
      // (플레이스 자체를 sourceMatchesTarget 으로 대조한 뒤에만 여기 온다).
      // 공식 홈페이지는 주소·전화를 이미지로만 싣는 경우가 많아, 다시 대조하면
      // 정작 수강료가 있는 진짜 근거가 탈락한다(목포: 홈페이지 확보 실패 확인).
      const trusted = homepages.has(url);
      if (!trusted && !sourceMatchesTarget(base, page)) continue;
      sources.push({ url: page.url, title: page.title, text: page.text });

      // 신원이 확인된 사이트라면 수강료·셔틀 서브페이지까지 따라간다.
      if (!fetched?.html) continue;
      for (const subUrl of feeSubpageUrls(fetched.html, url, maxSources - sources.length)) {
        if (sources.length >= maxSources) break;
        const sub = await fetchReadable(subUrl, timeoutMs).catch(() => null);
        if (sub && sub.text.length >= 200) sources.push({ url: sub.url, title: sub.title, text: sub.text });
      }
    } catch { /* 무시 */ }
  }
  return sources;
}

// 네이버 모바일 검색으로 후보 수집. DuckDuckGo(html·lite 모두)는 봇 차단으로
// HTTP 202 + 결과 0건을 반환해 조사가 전건 실패했다(2026-07-27 확인). 키가 필요 없고
// 국내 학원 정보가 가장 잘 잡히는 경로로 교체했다.
const NAVER_SKIP = /naver\.net|pstatic|nstatic|ader\.naver|naver\.com\/(v1|adcr|adcr\.naver)|googleads|doubleclick|youtube\.com|facebook|instagram|kakao\.com\/adfit/i;
// 검색 페이지 스크립트에 박힌 네이버 내부 인프라. 검색 결과가 아니라 화면 동작용 엔드포인트라
// 받아봐야 HTTP 500·캡차 이미지다. 이것들이 후보 한도를 먼저 채워 실제 근거 페이지를
// 밀어내고 있었다(구포 북부: 후보 31개 전부 인프라, 공식 홈페이지 0개).
const NAVER_INFRA = /^(?:apis|gw\.in|cr|nid|captcha\.nid|soundcaptcha\.nid|help|policy|about|siape|ssl|ocr|dict|shopping|order|pay|search)\.naver\.com$|^(?:m|www)\.naver\.com$|^gw\.in\.naver\.com$/i;
// 검색 결과에 섞이지만 학원 사실 근거가 될 수 없는 곳.
const NON_EVIDENCE_HOST = /^(?:www\.)?(?:google\.[a-z.]+|maps\.google\.[a-z.]+|youtu\.be|bing\.com|daum\.net)$/i;
// 업체가 아닌 지물 POI 분류(정류장·교차로 등). 학원 앞 정류장이 학원으로 잡히는 걸 막는다.
const NON_BUSINESS_CATEGORY = /방면정보|정류장|정류소|버스|지하철|역$|교차로|나들목|IC$|도로|고속도로|주차장/;

async function naverSearch(query: string, timeoutMs: number): Promise<{ placeIds: string[]; urls: string[] }> {
  const res = await timedFetch(`https://m.search.naver.com/search.naver?query=${encodeURIComponent(query)}`, timeoutMs, {
    headers: { "user-agent": UA, "accept": "text/html", "accept-language": "ko" },
  });
  if (!res.ok) return { placeIds: [], urls: [] };
  const html = await res.text();

  // 지역 결과의 플레이스 id. 같은 id 가 여러 번 나오므로 빈도순으로 정렬해 대표를 앞세운다.
  const freq = new Map<string, number>();
  for (const m of html.matchAll(/place\.naver\.com\/(?:place|restaurant|hairshop)\/(\d{5,})/g)) {
    const id = m[1];
    if (id) freq.set(id, (freq.get(id) ?? 0) + 1);
  }
  const placeIds = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);

  return { placeIds, urls: extractSearchCandidates(html) };
}

// 검색 HTML 에서 근거가 될 만한 외부 링크만 뽑는다.
//
// HTML 전체를 정규식으로 훑으면 안 된다. 검색 페이지는 80만 자가 넘고 상단 스크립트에
// 네이버 내부 API URL 이 잔뜩 박혀 있어, 실제 결과 링크(<a href>)에 닿기 전에 후보 한도가
// 인프라 URL 로 다 차버린다. 링크는 href 속성에서만 읽는다.
export function extractSearchCandidates(html: string, limit = 40): string[] {
  const urls: string[] = [];
  for (const m of html.matchAll(/href=["'](https?:\/\/[^"'\s<>]+)["']/gi)) {
    const url = decodeHtmlEntities(m[1] ?? "");
    if (!isEvidenceCandidate(url)) continue;
    urls.push(url);
    if (urls.length >= limit) break;
  }
  return urls;
}

function isEvidenceCandidate(url: string): boolean {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    host = parsed.host;
  } catch { return false; }
  if (NAVER_INFRA.test(host) || NON_EVIDENCE_HOST.test(host)) return false;
  if (NAVER_SKIP.test(url)) return false;
  // 플레이스는 placeIds 경로로 이미 다룬다. 여기서 또 담으면 같은 곳을 두 번 수집하는데,
  // 일반 페이지 경로로 읽으면 스크립트가 걷혀 품질만 나빠진다.
  if (url.includes("search.naver") || url.includes("place.naver.com") || url.includes("map.naver.com")) return false;
  return true;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// 네이버 플레이스는 화면이 스크립트로 그려져 태그를 걷어내면 700자쯤만 남는다.
// 대신 페이지에 박힌 JSON 에 영업시간·전화·주소·편의시설이 구조화돼 있어 그쪽을 읽는다.
async function fetchPlaceSource(placeId: string, timeoutMs: number, baseAddress?: string | null): Promise<WebSource | null> {
  const res = await timedFetch(`https://m.place.naver.com/place/${placeId}/home`, timeoutMs, {
    headers: { "user-agent": MOBILE_UA, "accept": "text/html", "accept-language": "ko" },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const text = buildPlaceFactText(html, baseAddress);
  if (!text) return null;
  const name = (text.match(/^이름: (.+)$/m) ?? [])[1] ?? "";
  return { url: `https://m.place.naver.com/place/${placeId}`, title: `네이버 플레이스 ${name}`.trim(), text };
}

// 블로그·SNS 는 학원이 홈페이지 대신 쓰는 경우도 있어 후보로는 남기되 뒤로 미룬다.
const BLOG_OR_SNS = /blog\.naver\.com|cafe\.naver\.com|tistory|instagram|facebook|youtube|talk\.naver\.com|pf\.kakao/i;

/**
 * 수집한 소스에서 기계적으로 확정되는 값만 뽑는다.
 *
 * 홈페이지·플레이스 URL 은 네이버 플레이스 JSON 에 구조화돼 있어, LLM 이 본문을 읽고
 * 추론할 이유가 없다. 실제로 조사에 맡겼을 때 채움률이 58% 에 그쳤다(파일럿 26곳).
 * 원천 API 가 홈페이지를 주기 시작하면 이 값은 원천 것으로 대체된다.
 */
export function structuredFactsFromSources(
  sources: Array<Pick<WebSource, "url" | "text">>,
): { homepage_url?: string; naver_place_url?: string } {
  const place = sources.find((s) => s.url.includes("place.naver.com"));
  if (!place) return {};
  const homepages = homepageUrlsFromPlaceText(place.text);
  // 공식 홈페이지를 우선하되, 블로그뿐이면 그거라도 쓴다(소규모 학원은 블로그가 홈페이지다).
  const homepage = homepages.find((u) => !BLOG_OR_SNS.test(u)) ?? homepages[0];
  return { homepage_url: homepage, naver_place_url: place.url };
}

// 페이지 JSON 에서 사실만 뽑아 사람이 읽는 형태로 정리한다.
// 원문 HTML 을 통째로 넘기면 60만 자라 프롬프트에 넣을 수 없다.
export function buildPlaceFactText(html: string, baseAddress?: string | null): string {
  // 한 페이지에 같은 키가 수십 번 나온다(사진 작성자, 주변 시설, 광고…).
  // roadAddress 는 대상 업체 객체에만 있으므로 이걸 앵커로 삼아 "가장 가까운" 값을 고른다.
  // 첫 번째 값을 집으면 엉뚱한 이름(예: 사진 작성자 'RELA')이 학원명으로 잡힌다.
  const anchor = html.indexOf('"roadAddress":');
  if (anchor === -1) return "";

  // 검색에는 정류장·교차로 같은 지물 POI 도 같은 형태로 섞여 나온다
  // (예: '목포자동차운전전문학원입구 · 방면정보'). 업체가 아니므로 소스로 쓰지 않는다.
  const category = jsonStringNear(html, "category", anchor);
  if (category && NON_BUSINESS_CATEGORY.test(category)) return "";

  const lines: string[] = [];
  const push = (label: string, value: string | null | undefined) => {
    if (value && value.trim()) lines.push(`${label}: ${value.trim()}`);
  };
  push("이름", jsonStringNear(html, "name", anchor));
  push("분류", jsonStringNear(html, "category", anchor));
  push("전화", jsonStringNear(html, "phone", anchor));
  push("안내전화", jsonStringNear(html, "virtualPhone", anchor));
  push("도로명주소", normalizeRegionPrefix(jsonStringNear(html, "roadAddress", anchor), baseAddress));
  push("지번주소", normalizeRegionPrefix(jsonStringNear(html, "address", anchor), baseAddress));
  push("소개", jsonStringNear(html, "description", anchor));

  const hours = jsonValueNear<Array<Record<string, any>>>(html, "businessHours", anchor);
  if (Array.isArray(hours) && hours.length) {
    const parts = hours.map((entry) => {
      const day = String(entry?.day ?? "").trim();
      const open = entry?.businessHours;
      const span = open?.start && open?.end ? `${open.start}~${open.end}` : "";
      const breaks = Array.isArray(entry?.breakHours)
        ? entry.breakHours.filter((b: any) => b?.start && b?.end).map((b: any) => `휴게 ${b.start}~${b.end}`).join(" ")
        : "";
      return [day, span, breaks].filter(Boolean).join(" ");
    }).filter(Boolean);
    push("영업시간", parts.join(" / "));
  }

  const conveniences = jsonValueNear<string[]>(html, "conveniences", anchor);
  if (Array.isArray(conveniences) && conveniences.length) push("편의시설", conveniences.join(", "));

  const homepages = jsonValueNear<Record<string, any>>(html, "homepages", anchor);
  const homepageUrls = collectUrls(homepages).slice(0, 3);
  if (homepageUrls.length) push("홈페이지", homepageUrls.join(", "));

  return lines.join("\n");
}

// 플레이스 사실 텍스트의 "홈페이지:" 줄에서 URL 을 되읽는다.
export function homepageUrlsFromPlaceText(text: string): string[] {
  const line = String(text ?? "").split(/\r?\n/).find((l) => l.startsWith("홈페이지: "));
  if (!line) return [];
  return line
    .slice("홈페이지: ".length)
    .split(",")
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//.test(u) && isEvidenceCandidate(u));
}

// 한 사이트의 하위 페이지가 후보 자리를 독식하지 않게 호스트당 개수를 제한한다.
// 공식 홈페이지 게시판이 8개 잡히면 블로그·기관 페이지가 한 자리도 못 들어온다.
export function limitPerHost(urls: string[], perHost = 2): string[] {
  const seen = new Map<string, number>();
  const paths = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    let parsed: URL;
    try { parsed = new URL(url); } catch { continue; }
    // www 유무는 같은 사이트다. 나눠 세면 bbdrive.co.kr 와 www.bbdrive.co.kr 가
    // 두 자리를 차지하고 같은 본문이 프롬프트에 두 번 들어간다(실측 확인).
    const host = parsed.host.replace(/^www\./i, "").toLowerCase();
    const key = `${host}${parsed.pathname.replace(/\/$/, "")}${parsed.search}`;
    if (paths.has(key)) continue;
    const count = seen.get(host) ?? 0;
    if (count >= perHost) continue;
    paths.add(key);
    seen.set(host, count + 1);
    out.push(url);
  }
  return out;
}

function collectUrls(value: unknown, acc: string[] = []): string[] {
  if (!value) return acc;
  if (typeof value === "string") {
    if (/^https?:\/\//.test(value)) acc.push(value);
    return acc;
  }
  if (Array.isArray(value)) { for (const item of value) collectUrls(item, acc); return acc; }
  if (typeof value === "object") { for (const item of Object.values(value as Record<string, unknown>)) collectUrls(item, acc); }
  return acc;
}

// 네이버는 '전남광주' 처럼 두 시·도를 붙인 자체 표기를 쓴다. 그대로 두면 조사 결과에
// 실재하지 않는 지명이 박히므로, 원천 주소의 시·도로 첫 토큰을 바로잡는다.
export function normalizeRegionPrefix(address: string | null, baseAddress?: string | null): string | null {
  if (!address) return address;
  const parts = address.trim().split(/\s+/);
  const head = parts[0];
  const baseHead = String(baseAddress ?? "").trim().split(/\s+/)[0];
  if (!head || !baseHead || head === baseHead) return address;
  const proper = /(특별시|광역시|특별자치시|특별자치도|도)$/;
  // 원천 쪽이 정식 시·도 표기이고 플레이스 쪽이 아니면 갈아끼운다(반대 방향은 건드리지 않는다).
  if (proper.test(baseHead) && !proper.test(head)) return [baseHead, ...parts.slice(1)].join(" ");
  return address;
}

function jsonStringNear(html: string, key: string, anchor: number): string | null {
  const value = jsonValueNear<unknown>(html, key, anchor);
  return typeof value === "string" ? value : null;
}

// "key": 뒤에 오는 값 하나를 괄호 짝을 세어 잘라낸 뒤 JSON 으로 파싱한다.
// 정규식만으로는 중첩 구조(영업시간 배열)를 못 자르고, / 같은 이스케이프도 복원해야 한다.
// 후보가 여럿이면 앵커(대상 업체 객체)에서 가장 가까운 것을 고른다.
function jsonValueNear<T>(html: string, key: string, anchor: number): T | null {
  const marker = `"${key}":`;
  const candidates: Array<{ at: number; value: T }> = [];
  let from = 0;
  while (candidates.length < 60) {
    const at = html.indexOf(marker, from);
    if (at === -1) break;
    from = at + marker.length;
    // 앵커에서 너무 먼 값은 다른 업체·다른 섹션의 것이다.
    if (Math.abs(at - anchor) > 40_000) continue;
    const slice = sliceJsonValue(html, at + marker.length);
    if (!slice) continue;
    try {
      const parsed = JSON.parse(slice) as T;
      if (typeof parsed === "string" && !parsed.trim()) continue;
      if (Array.isArray(parsed) && !parsed.length) continue;
      candidates.push({ at, value: parsed });
    } catch { /* 다음 후보 */ }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => Math.abs(a.at - anchor) - Math.abs(b.at - anchor));
  return candidates[0]!.value;
}

function sliceJsonValue(html: string, start: number): string | null {
  let i = start;
  while (i < html.length && /\s/.test(html[i] ?? "")) i++;
  const first = html[i];
  if (first === undefined) return null;
  if (first === '"') {
    let j = i + 1;
    while (j < html.length) {
      const ch = html[j];
      if (ch === "\\") { j += 2; continue; }
      if (ch === '"') return html.slice(i, j + 1);
      j++;
    }
    return null;
  }
  if (first === "{" || first === "[") {
    const close = first === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let j = i;
    while (j < html.length) {
      const ch = html[j];
      if (inString) {
        if (ch === "\\") j++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === first) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) return html.slice(i, j + 1);
      }
      j++;
      if (j - i > 200_000) return null; // 안전장치
    }
    return null;
  }
  return null;
}

// 공식/지도 도메인을 우선, 잡링크를 뒤로.
function rankCandidates(urls: string[]): string[] {
  const score = (u: string): number => {
    const s = u.toLowerCase();
    if (s.includes("map.naver") || s.includes("place.naver") || s.includes("m.place.naver")) return 0;
    if (s.includes("map.kakao") || s.includes("place.map.kakao")) return 1;
    if (/\.(co\.kr|kr|com)\//.test(s) && !isPortal(s)) return 2; // 공식 홈페이지 추정
    if (s.includes("blog.naver") || s.includes("tistory") || s.includes("cafe.")) return 5;
    return 4;
  };
  return [...urls].sort((a, b) => score(a) - score(b));
}
function isPortal(s: string): boolean {
  return ["search.naver", "google.", "youtube.", "facebook.", "instagram.", "namu.wiki", "wikipedia."].some((p) => s.includes(p));
}

// 페이지를 가져와 읽을 수 있는 텍스트로 정리.
// html 은 하위 링크 추출용으로만 쓴다(프롬프트에는 text 만 들어간다).
async function fetchReadable(url: string, timeoutMs: number): Promise<(WebSource & { html: string }) | null> {
  const res = await timedFetch(url, timeoutMs, { headers: { "user-agent": UA, "accept": "text/html", "accept-language": "ko,en;q=0.8" } });
  if (!res.ok) return null;
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("text/html") && !ct.includes("text/plain")) return null;
  const html = await res.text();
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const text = htmlToText(html).slice(0, MAX_CHARS_PER_SOURCE);
  return { url, title, text, html };
}

// 학원 공식 홈페이지 첫 화면은 메뉴만 있는 경우가 흔하다
// (실측: bbdrive.co.kr 본문 937자에 '수강료안내' 라는 메뉴 글자만 있고 금액은 0건).
// 수강료·셔틀은 서브페이지에 있으므로, 같은 사이트 안에서 그 링크만 따라간다.
const FEE_LINK_TEXT = /수강료|교육비|요금|비용|가격|셔틀|교육과정|과정안내|교육시간/;

export function feeSubpageUrls(html: string, pageUrl: string, limit = 2): string[] {
  let origin: URL;
  try { origin = new URL(pageUrl); } catch { return []; }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of String(html ?? "").matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = htmlToText(m[2] ?? "");
    if (!FEE_LINK_TEXT.test(label)) continue;
    let resolved: URL;
    try { resolved = new URL(decodeHtmlEntities(m[1] ?? ""), origin); } catch { continue; }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
    // 같은 사이트만. 외부로 나가면 신원 확인이 다시 필요해진다.
    if (resolved.host.replace(/^www\./i, "") !== origin.host.replace(/^www\./i, "")) continue;
    const key = `${resolved.pathname}${resolved.search}`;
    if (key === `${origin.pathname}${origin.search}` || seen.has(key)) continue;
    seen.add(key);
    out.push(resolved.toString());
    if (out.length >= limit) break;
  }
  return out;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function shouldTryRenderedFetch(source: WebSource | null): boolean {
  if (!source) return true;
  if (source.text.length < 900) return true;
  return !NEEDLE_FIELDS.some((needle) => source.text.includes(needle));
}

async function fetchRenderedReadable(url: string, timeoutMs: number): Promise<WebSource | null> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      userAgent: UA,
      locale: "ko-KR",
      viewport: { width: 1365, height: 900 },
    });
    page.setDefaultTimeout(timeoutMs);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 5000) }).catch(() => undefined);
    await expandLikelyContent(page);
    const title = (await page.title()).replace(/\s+/g, " ").trim();
    const text = normalizeText(await page.locator("body").innerText({ timeout: Math.min(timeoutMs, 5000) })).slice(0, MAX_CHARS_PER_SOURCE);
    return { url, title, text };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function expandLikelyContent(page: import("playwright").Page): Promise<void> {
  const labels = ["셔틀", "노선", "가격", "수강료", "교육비", "시간", "주말", "야간", "더보기", "자세히"];
  for (const label of labels) {
    const target = page.getByText(label, { exact: false }).first();
    if (await target.count().catch(() => 0)) {
      await target.click({ timeout: 1000 }).catch(() => undefined);
      await page.waitForTimeout(150).catch(() => undefined);
    }
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function timedFetch(url: string, timeoutMs: number, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal, redirect: "follow" }).finally(() => clearTimeout(timer));
}

function sourceMatchesTarget(base: ResearchBaseRef, source: WebSource): boolean {
  const haystack = `${source.title} ${source.text}`;
  return phoneMatches(base, haystack) || addressMatches(base.address, haystack);
}

function phoneMatches(base: ResearchBaseRef, text: string): boolean {
  const textDigits = digits(text);
  const phones = [base.phone, base.vphone]
    .map((value) => digits(value ?? ""))
    .filter((value) => value.length >= 7);
  return phones.some((phone) => textDigits.includes(phone));
}

function addressMatches(address: string | null | undefined, text: string): boolean {
  const tokens = addressTokens(address);
  if (!tokens.length) return false;
  const compactText = compactAddress(text);
  const compactAddr = compactAddress(address ?? "");
  if (compactAddr.length >= 12 && compactText.includes(compactAddr.slice(0, 12))) return true;
  const matched = tokens.filter((token) => compactText.includes(compactAddress(token))).length;
  return matched >= Math.min(3, tokens.length);
}

function addressTokens(address: string | null | undefined): string[] {
  return String(address ?? "")
    .split(/\s+/)
    .map((part) => part.replace(/[(),]/g, "").trim())
    .filter((part) => part.length >= 2 && !/^\d/.test(part));
}

function compactAddress(value: string): string {
  return value.replace(/\s+/g, "").replace(/[(),.-]/g, "").toLowerCase();
}

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

// 수집한 소스 본문으로 추출 프롬프트 구성. "소스에 있는 것만" 강제.
// 조사 스키마. 프롬프트에 그대로 박아 넣지 않고 **필드 하나씩** 조립한다.
// 여러 필드를 한 줄에 묶으면 그중 하나만 빠져도 줄 전체가 남아, 이미 아는 값을 계속 요구하게 된다
// (원천이 홈페이지 URL 을 주기 시작하는 순간 바로 겪을 문제였다).
const SCHEMA_FIELDS: Array<{ key: string; text: string }> = [
  { key: "name_researched", text: `"name_researched": string|null` },
  { key: "address_researched", text: `"address_researched": string|null` },
  { key: "phone_researched", text: `"phone_researched": string|null` },
  { key: "gu", text: `"gu": string|null` },
  { key: "dong", text: `"dong": string|null` },
  { key: "jibun_address", text: `"jibun_address": string|null` },
  { key: "hours", text: `"hours": string|null` },
  { key: "night_class", text: `"night_class": string|null` },
  { key: "weekend", text: `"weekend": string|null` },
  { key: "closed_days", text: `"closed_days": string|null` },
  { key: "shuttle_available", text: `"shuttle_available": "yes"|"no"|"unknown"|null` },
  { key: "shuttle_summary", text: `"shuttle_summary": string|null` },
  { key: "licenses", text: `"licenses": string|null` },
  { key: "self_test", text: `"self_test": string|null` },
  { key: "facilities", text: `"facilities": string|null` },
  { key: "fee_summary", text: `"fee_summary": string|null` },
  { key: "price_disclosed", text: `"price_disclosed": "yes"|"no"|null` },
  { key: "pass_rate", text: `"pass_rate": string|null` },
  { key: "pass_rate_scope", text: `"pass_rate_scope": "official"|"self_claim"|null` },
  { key: "established_year", text: `"established_year": string|null` },
  { key: "scale", text: `"scale": string|null` },
  { key: "homepage_url", text: `"homepage_url": string|null` },
  { key: "naver_place_url", text: `"naver_place_url": string|null` },
  { key: "kakao_url", text: `"kakao_url": string|null` },
];

const COURSES_LINE = `"courses": [{"course_name": string, "price": string|null, "exam_fee_included": "yes"|"no"|"partial"|null, "extra_costs": string|null, "note": string|null, "source_url": string|null}]`;
const SHUTTLE_ROUTES_LINE = `"shuttle_routes": [{"route_name": string, "waypoints": string|null, "coverage": string|null, "interval_text": string|null, "source_url": string|null}]`;

export function buildExtractionPrompt(base: ResearchBaseRef, sources: WebSource[], known: KnownFacts = emptyKnownFacts()): string {
  const ref = [
    base.name ? `- 이름: ${base.name}` : null,
    base.address ? `- 주소(참고): ${base.address}` : null,
    base.phone ? `- 전화(참고): ${base.phone}` : null,
    base.region ? `- 지역: ${base.region}` : null,
  ].filter(Boolean).join("\n");

  const sourceBlocks = sources.map((s, i) => `[소스 ${i + 1}] ${s.url}\n제목: ${s.title}\n본문:\n${s.text}`).join("\n\n---\n\n");

  const schema = SCHEMA_FIELDS
    .filter((field) => !known.skipFields.has(field.key))
    .map((field) => `  ${field.text}`);
  if (!known.skipCourses) schema.push(`  ${COURSES_LINE}`);
  if (!known.skipShuttleRoutes) schema.push(`  ${SHUTTLE_ROUTES_LINE}`);
  schema.push(`  "sources": { "<field_key>": "<근거 소스 URL>" }`);

  // 이미 아는 사실은 "찾지 말라"가 아니라 "이미 확정됐다"로 준다. 모델이 같은 값을 다시
  // 찾느라 소스를 낭비하지 않고, 소스에 다른 값이 보여도 모순되는 답을 내놓지 않는다.
  const knownBlock = known.lines.length
    ? `\n[이미 확정된 사실 — 다시 조사하지 마세요]\n원천 자료로 확인된 값입니다. 아래 항목은 출력 스키마에서 빠져 있으니 채우려 하지 마세요.\n소스에 다른 값이 보이더라도 이 값을 뒤집는 서술을 하지 마세요.\n${known.lines.join("\n")}\n`
    : "";

  return `당신은 자동차운전전문학원 정보를 추출하는 정확성 최우선 분석가입니다.
아래 [대상]과 [소스]가 주어집니다. 웹 검색을 하지 말고, **오직 아래 [소스] 본문에 실제로 적힌 내용만** 사용해 JSON을 만드세요.

[대상]
${ref}
${knownBlock}
[중요]
- 동명 학원이 많습니다. 위 주소·전화와 **일치하는 학원**의 정보만 사용하세요. 소스가 다른 지점/동명 학원이면 그 값은 쓰지 마세요.
- 소스에 없는 값은 반드시 null. 추측·일반지식·날조 금지.
- 각 필드의 근거는 sources 맵에 해당 소스 URL로 남기세요(소스에서 확인한 필드만).

[소스]
${sourceBlocks || "(수집된 소스 없음)"}

[출력 — 순수 JSON 하나만, 설명·코드펜스 없이]
{
${schema.join(",\n")}
}`;
}

function dedupe(arr: string[]): string[] { return [...new Set(arr.map((s) => s.trim()).filter(Boolean))]; }
function firstAddrToken(addr: string): string { const parts = addr.trim().split(/\s+/); return parts.slice(0, 2).join(" "); }
