import type { ResearchBaseRef } from "./academy-research-llm.js";

// B안: CLI 웹툴에 의존하지 않고, 서버(Node)가 직접 검색·페이지를 fetch 해서
// 그 본문을 LLM에 넘겨 "소스에 있는 사실만" 추출한다. 근거 URL을 함께 확보한다.

export interface WebSource { url: string; title: string; text: string }

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_SOURCES = 4;
const MAX_CHARS_PER_SOURCE = 3500;

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

  // 1) 검색으로 후보 URL 수집
  const urls: string[] = [];
  for (const q of queries) {
    if (urls.length >= maxSources * 3) break;
    try { urls.push(...await ddgSearch(q, timeoutMs)); } catch { /* 무시 */ }
  }
  const candidates = rankCandidates(dedupe(urls)).slice(0, maxSources);

  // 2) 각 후보 페이지 본문 수집
  const sources: WebSource[] = [];
  for (const url of candidates) {
    try {
      const page = await fetchReadable(url, timeoutMs);
      if (page && page.text.length >= 200) sources.push(page);
    } catch { /* 무시 */ }
    if (sources.length >= maxSources) break;
  }
  return sources;
}

// DuckDuckGo HTML(정적) 엔드포인트로 검색 → 결과 링크 추출(JS 불필요, 키 불필요).
async function ddgSearch(query: string, timeoutMs: number): Promise<string[]> {
  const res = await timedFetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, timeoutMs, {
    headers: { "user-agent": UA, "accept": "text/html", "accept-language": "ko,en;q=0.8" },
  });
  if (!res.ok) return [];
  const html = await res.text();
  const out: string[] = [];
  // <a class="result__a" href="...">  또는 리다이렉트 uddg 파라미터
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 20) {
    const real = decodeDdgHref(m[1] ?? "");
    if (real) out.push(real);
  }
  return out;
}

function decodeDdgHref(href: string): string | null {
  try {
    const raw = href.startsWith("//") ? `https:${href}` : href;
    const u = new URL(raw);
    const uddg = u.searchParams.get("uddg");
    if (uddg) return uddg; // 이미 디코드됨(URLSearchParams)
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
    return null;
  } catch { return null; }
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
async function fetchReadable(url: string, timeoutMs: number): Promise<WebSource | null> {
  const res = await timedFetch(url, timeoutMs, { headers: { "user-agent": UA, "accept": "text/html", "accept-language": "ko,en;q=0.8" } });
  if (!res.ok) return null;
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("text/html") && !ct.includes("text/plain")) return null;
  const html = await res.text();
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const text = htmlToText(html).slice(0, MAX_CHARS_PER_SOURCE);
  return { url, title, text };
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

function timedFetch(url: string, timeoutMs: number, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal, redirect: "follow" }).finally(() => clearTimeout(timer));
}

// 수집한 소스 본문으로 추출 프롬프트 구성. "소스에 있는 것만" 강제.
export function buildExtractionPrompt(base: ResearchBaseRef, sources: WebSource[]): string {
  const ref = [
    base.name ? `- 이름: ${base.name}` : null,
    base.address ? `- 주소(참고): ${base.address}` : null,
    base.phone ? `- 전화(참고): ${base.phone}` : null,
    base.region ? `- 지역: ${base.region}` : null,
  ].filter(Boolean).join("\n");

  const sourceBlocks = sources.map((s, i) => `[소스 ${i + 1}] ${s.url}\n제목: ${s.title}\n본문:\n${s.text}`).join("\n\n---\n\n");

  return `당신은 자동차운전전문학원 정보를 추출하는 정확성 최우선 분석가입니다.
아래 [대상]과 [소스]가 주어집니다. 웹 검색을 하지 말고, **오직 아래 [소스] 본문에 실제로 적힌 내용만** 사용해 JSON을 만드세요.

[대상]
${ref}

[중요]
- 동명 학원이 많습니다. 위 주소·전화와 **일치하는 학원**의 정보만 사용하세요. 소스가 다른 지점/동명 학원이면 그 값은 쓰지 마세요.
- 소스에 없는 값은 반드시 null. 추측·일반지식·날조 금지.
- 각 필드의 근거는 sources 맵에 해당 소스 URL로 남기세요(소스에서 확인한 필드만).

[소스]
${sourceBlocks || "(수집된 소스 없음)"}

[출력 — 순수 JSON 하나만, 설명·코드펜스 없이]
{
  "name_researched": string|null, "address_researched": string|null, "phone_researched": string|null,
  "gu": string|null, "dong": string|null, "jibun_address": string|null,
  "hours": string|null, "night_class": string|null, "weekend": string|null, "closed_days": string|null,
  "shuttle_available": "yes"|"no"|"unknown"|null, "shuttle_summary": string|null,
  "licenses": string|null, "self_test": string|null, "facilities": string|null,
  "fee_summary": string|null, "price_disclosed": "yes"|"no"|null,
  "pass_rate": string|null, "pass_rate_scope": "official"|"self_claim"|null,
  "established_year": string|null, "scale": string|null,
  "homepage_url": string|null, "naver_place_url": string|null, "kakao_url": string|null,
  "courses": [{"course_name": string, "price": string|null, "exam_fee_included": "yes"|"no"|"partial"|null, "extra_costs": string|null, "note": string|null, "source_url": string|null}],
  "shuttle_routes": [{"route_name": string, "waypoints": string|null, "coverage": string|null, "interval_text": string|null, "source_url": string|null}],
  "sources": { "<field_key>": "<근거 소스 URL>" }
}`;
}

function dedupe(arr: string[]): string[] { return [...new Set(arr.map((s) => s.trim()).filter(Boolean))]; }
function firstAddrToken(addr: string): string { const parts = addr.trim().split(/\s+/); return parts.slice(0, 2).join(" "); }
