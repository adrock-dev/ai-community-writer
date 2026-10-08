import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolvePath } from "../paths.ts";

// 네이버 검색광고 API 키워드 도구(/keywordstool).
// monthlyPcQcCnt / monthlyMobileQcCnt 가 최근 30일 PC·모바일 검색 수다. 10 미만은 "< 10" 문자열로 온다.

export interface SearchadCredentials {
  apiKey: string;
  secretKey: string;
  customerId: string;
}

const KEYS = {
  apiKey: "NAVER_AD_API_KEY",
  secretKey: "NAVER_AD_SECRET_KEY",
  customerId: "NAVER_AD_CUSTOMER_ID",
} as const;

/** KEY=VALUE 형식 파일을 읽는다 (`export `, 따옴표, 주석, CRLF, BOM 허용). */
export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line
      .slice(0, eq)
      .replace(/^export\s+/, "")
      .trim();
    out[key] = line
      .slice(eq + 1)
      .trim()
      .replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

/** 파일 내용을 글자로 읽는다. Windows 메모장의 "유니코드"(UTF-16) 저장도 받는다. */
export function decodeTextFile(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  return buf.toString("utf8");
}

/** 인증 파일(KEY=VALUE)을 읽는다. 없으면 빈 객체. */
export function readEnvFile(envFile: string): Record<string, string> {
  const path = resolvePath(envFile);
  return existsSync(path) ? parseEnvFile(decodeTextFile(readFileSync(path))) : {};
}

/** 인증 정보는 환경 변수가 우선이고, 없으면 설정의 인증 파일에서 읽는다. */
export function loadSearchadCredentials(envFile: string): SearchadCredentials {
  const path = resolvePath(envFile);
  const file = readEnvFile(envFile);
  const pick = (name: string) => process.env[name] || file[name] || "";
  const creds = {
    apiKey: pick(KEYS.apiKey),
    secretKey: pick(KEYS.secretKey),
    customerId: pick(KEYS.customerId),
  };
  const missing = Object.entries(KEYS)
    .filter(([k]) => !creds[k as keyof SearchadCredentials])
    .map(([, name]) => name);
  if (missing.length) {
    throw new Error(`네이버 검색광고 API 인증 정보 없음: ${missing.join(", ")} (파일: ${path})`);
  }
  return creds;
}

export function signature(secretKey: string, timestamp: string, method: string, uri: string) {
  return createHmac("sha256", secretKey).update(`${timestamp}.${method}.${uri}`).digest("base64");
}

export interface KeywordStat {
  keyword: string;
  pc: number;
  mobile: number;
  total: number;
  /** 광고 경쟁 정도: 높음 / 중간 / 낮음 */
  competition: string;
}

/** "< 10" 같은 값은 5로 본다. */
export function toCount(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.includes("<")) return 5;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function toKeywordStat(row: any): KeywordStat {
  const pc = toCount(row?.monthlyPcQcCnt);
  const mobile = toCount(row?.monthlyMobileQcCnt);
  return {
    keyword: String(row?.relKeyword ?? "").trim(),
    pc,
    mobile,
    total: pc + mobile,
    competition: String(row?.compIdx ?? ""),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class SearchadClient {
  private readonly creds: SearchadCredentials;
  private readonly fetchImpl: typeof fetch;
  private readonly delayMs: number;

  constructor(creds: SearchadCredentials, opts: { fetch?: typeof fetch; delayMs?: number } = {}) {
    this.creds = creds;
    this.fetchImpl = opts.fetch ?? fetch;
    this.delayMs = opts.delayMs ?? 300;
  }

  /** 힌트 키워드(최대 5개)의 연관 키워드와 30일 검색 수. 힌트는 공백을 뺀다. */
  async relatedKeywords(hints: string[]): Promise<KeywordStat[]> {
    const cleaned = [...new Set(hints.map((h) => h.replace(/\s+/g, "")).filter(Boolean))];
    if (!cleaned.length) return [];
    if (cleaned.length > 5) throw new Error("hintKeywords는 한 번에 5개까지입니다");
    const uri = "/keywordstool";
    const query = `hintKeywords=${encodeURIComponent(cleaned.join(","))}&showDetail=1`;
    let lastError = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      const ts = String(Date.now());
      const res = await this.fetchImpl(`https://api.searchad.naver.com${uri}?${query}`, {
        headers: {
          "X-Timestamp": ts,
          "X-API-KEY": this.creds.apiKey,
          "X-Customer": this.creds.customerId,
          "X-Signature": signature(this.creds.secretKey, ts, "GET", uri),
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) {
        const body = (await res.json()) as { keywordList?: unknown[] };
        await sleep(this.delayMs);
        return (body.keywordList ?? []).map(toKeywordStat).filter((k) => k.keyword);
      }
      lastError = `${res.status} ${(await res.text()).slice(0, 300)}`;
      // 4xx(429 제외)는 요청 문제라 재시도해도 같다.
      if (res.status < 500 && res.status !== 429) break;
      await sleep(2000 * (attempt + 1));
    }
    throw new Error(`검색광고 API 실패 (${cleaned.join(",")}): ${lastError}`);
  }
}
