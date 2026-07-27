// 조사값 그라운딩 검사: LLM이 채운 값이 "수집한 소스 본문에 실제로 근거가 있는가"를 대조한다.
//
// 왜 값 전체 문자열 대조가 아닌가:
// 실제 저장값은 토큰이 아니라 여러 출처가 섞인 서술문이다.
//   fee_summary: "1종/2종 총 비용 820,000원(학과 30,000원, 장내 270,800원...). 당근 가격: 710,000원~"
// 문장은 모델이 재구성하므로 소스에 그대로 있을 수 없다. 반면 날조는 거의 전부 숫자에서 나므로,
// 문장에서 숫자 클레임만 뽑아 개별 대조한다.
//
// 이 검사는 교차검증(두 모델 대조)과 별개다. 교차검증은 "둘 다 같은 소스를 보고 같은 오답"을 잡지 못한다.

import type { WebSource } from "./academy-research-web.js";

export type ClaimKind = "money" | "percent" | "year" | "time" | "count";

export interface NumericClaim {
  kind: ClaimKind;
  /** 값에 적힌 원문 표기(예: "680,010원"). 사람이 읽는 리포트용. */
  raw: string;
  /** 표기 차이를 흡수한 정규형. money 는 원 단위 정수. */
  norm: number | string;
}

// 금액: "820,000원" / "78만원" / "38만 5천원" 을 모두 잡는다.
const MONEY_RE = /(\d[\d,]*)\s*만\s*(?:(\d[\d,]*)\s*천)?\s*원|(\d[\d,]*)\s*원/g;
const PERCENT_RE = /(\d[\d,]*(?:\.\d+)?)\s*(?:%|퍼센트)/g;
const YEAR_RE = /((?:19|20)\d{2})\s*년/g;
const TIME_RE = /(\d{1,2})\s*:\s*(\d{2})/g;
const COUNT_RE = /(\d[\d,]*)\s*(명|㎡|m2|평|대|개|시간|주|일)(?![\w가-힣])/g;

function toNumber(text: string | undefined): number | null {
  if (!text) return null;
  const n = Number(text.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// 값 문장에서 검증 대상 숫자 클레임을 뽑는다.
export function extractClaims(value: string | null | undefined): NumericClaim[] {
  const text = String(value ?? "");
  if (!text.trim()) return [];
  const claims: NumericClaim[] = [];

  for (const m of text.matchAll(MONEY_RE)) {
    const man = toNumber(m[1]);
    const cheon = toNumber(m[2]);
    const plain = toNumber(m[3]);
    const amount = man != null ? man * 10000 + (cheon ?? 0) * 1000 : plain;
    if (amount != null) claims.push({ kind: "money", raw: m[0].trim(), norm: amount });
  }
  for (const m of text.matchAll(PERCENT_RE)) {
    const n = toNumber(m[1]);
    if (n != null) claims.push({ kind: "percent", raw: m[0].trim(), norm: n });
  }
  for (const m of text.matchAll(YEAR_RE)) {
    const n = toNumber(m[1]);
    if (n != null) claims.push({ kind: "year", raw: m[0].trim(), norm: n });
  }
  for (const m of text.matchAll(TIME_RE)) {
    const hour = toNumber(m[1]);
    const minute = m[2] ?? "00";
    if (hour != null) claims.push({ kind: "time", raw: m[0].trim(), norm: `${hour}:${minute}` });
  }
  for (const m of text.matchAll(COUNT_RE)) {
    const n = toNumber(m[1]);
    if (n != null) claims.push({ kind: "count", raw: m[0].trim(), norm: `${n}${m[2]}` });
  }
  return dedupeClaims(claims);
}

function dedupeClaims(claims: NumericClaim[]): NumericClaim[] {
  const seen = new Set<string>();
  const out: NumericClaim[] = [];
  for (const c of claims) {
    const key = `${c.kind}:${c.norm}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

// 숫자를 소스 본문에서 찾을 때 쓰는 정규식.
// 소스는 "820,000" 처럼 콤마가 섞여 있으므로 자릿수 사이에 콤마·공백을 허용한다.
// 앞뒤에 다른 숫자가 붙으면 다른 수이므로 제외한다(8,200,000 이 820,000 에 걸리지 않게).
function digitsPattern(digits: string): RegExp {
  const body = digits.split("").join("[,\\s]?");
  return new RegExp(`(?<![\\d])${body}(?![\\d])`);
}

function hasNumber(haystack: string, value: number): boolean {
  return digitsPattern(String(value)).test(haystack);
}

// 금액은 표기 변형이 많다. 680,010 / 680010 / 68만 / 68만1천 을 모두 같은 값으로 본다.
function hasMoney(haystack: string, amount: number): boolean {
  if (hasNumber(haystack, amount)) return true;
  if (amount % 10000 === 0) {
    const man = amount / 10000;
    if (new RegExp(`(?<![\\d])${man}\\s*만`).test(haystack)) return true;
  }
  if (amount % 1000 === 0 && amount > 10000) {
    const man = Math.floor(amount / 10000);
    const cheon = (amount % 10000) / 1000;
    if (cheon > 0 && new RegExp(`(?<![\\d])${man}\\s*만\\s*${cheon}\\s*천`).test(haystack)) return true;
  }
  return false;
}

// "09:00" 은 소스에 "9:00" 이나 "9시" 로 적혀 있을 수 있다.
function hasTime(haystack: string, norm: string): boolean {
  const [hourText, minuteText] = norm.split(":");
  const hour = Number(hourText);
  if (!Number.isFinite(hour)) return false;
  const hh = String(hour).padStart(2, "0");
  if (new RegExp(`(?<![\\d])0?${hour}\\s*:\\s*${minuteText}`).test(haystack)) return true;
  if (minuteText === "00" && new RegExp(`(?<![\\d])(?:${hh}|${hour})\\s*시`).test(haystack)) return true;
  return false;
}

// 클레임 하나가 소스 본문에 근거를 갖는지.
export function isClaimGrounded(claim: NumericClaim, haystack: string): boolean {
  if (!haystack) return false;
  switch (claim.kind) {
    case "money":
      return hasMoney(haystack, Number(claim.norm));
    case "time":
      return hasTime(haystack, String(claim.norm));
    case "percent":
    case "year":
      return hasNumber(haystack, Number(claim.norm));
    case "count": {
      const digits = String(claim.norm).match(/^\d+/)?.[0];
      return digits ? hasNumber(haystack, Number(digits)) : false;
    }
    default:
      return false;
  }
}

// --- 필드 타입 검증 -------------------------------------------------------
// 그라운딩과 별개 축이다. "소스에 있는가"가 아니라 "이 필드에 들어올 수 있는 값인가"를 본다.
// 소스에 광고 문구가 실제로 적혀 있으면 그라운딩은 통과하지만, 그 문구를 합격률 필드에
// 담으면 안 된다. 두 모델을 붙여도 이건 잡히지 않는다(둘 다 같은 문구를 옮겨 적는다).

const AD_CLAIM_WORDS = [
  "최고", "최대", "최상", "제일", "최단", "가장", "1위", "no.1", "넘버원",
  "보장", "100%", "타사보다", "업계 최",
];

/** 개인 거래·중고 플랫폼 가격은 학원 공식 요금이 아니다. */
const PERSONAL_MARKET_WORDS = ["당근", "중고나라", "번개장터", "직거래"];

const AD_CLAIM_SENSITIVE_FIELDS = new Set([
  "pass_rate", "scale", "facilities", "licenses", "shuttle_summary", "self_test", "fee_summary",
]);

export function fieldTypeIssues(field: string, value: string | null | undefined): string[] {
  const text = String(value ?? "").trim();
  if (!text) return [];
  const lower = text.toLowerCase();
  const issues: string[] = [];
  const adWord = AD_CLAIM_WORDS.find((w) => lower.includes(w));

  if (field === "pass_rate" && !/\d/.test(text)) {
    issues.push("합격률에 수치가 없음(서술만)");
  }
  if (field === "fee_summary") {
    if (!/\d/.test(text)) issues.push("요금 요약에 금액이 없음");
    const market = PERSONAL_MARKET_WORDS.find((w) => text.includes(w));
    if (market) issues.push(`개인 거래 플랫폼 가격이 섞임(${market})`);
  }
  if (adWord && AD_CLAIM_SENSITIVE_FIELDS.has(field)) {
    issues.push(`광고성 주장 표현 포함(${adWord})`);
  }
  return issues;
}

// --- 종합 -----------------------------------------------------------------

export interface GroundingReport {
  field: string;
  /** 소스에서 근거를 찾지 못한 숫자 클레임. */
  ungrounded: NumericClaim[];
  /** 근거를 찾은 클레임 수. */
  grounded: number;
  /** 필드에 담기면 안 되는 값(광고 문구·개인거래 가격 등). */
  typeIssues: string[];
}

export function inspectResearchValue(field: string, value: string | null | undefined, sourceText: string): GroundingReport {
  const claims = extractClaims(value);
  const ungrounded = claims.filter((c) => !isClaimGrounded(c, sourceText));
  return {
    field,
    ungrounded,
    grounded: claims.length - ungrounded.length,
    typeIssues: fieldTypeIssues(field, value),
  };
}

/** 수집 소스 여러 건을 한 덩어리 본문으로 합친다(어느 소스든 근거가 있으면 통과). */
export function sourceHaystack(sources: Array<Pick<WebSource, "text" | "title">>): string {
  return sources.map((s) => `${s.title ?? ""}\n${s.text ?? ""}`).join("\n");
}

export function hasFinding(report: GroundingReport): boolean {
  return report.ungrounded.length > 0 || report.typeIssues.length > 0;
}

/**
 * 검사에 걸린 값에 붙일 사유 문구(academy_field_meta.note 용).
 * 값을 버리지 않고 사유를 남겨 사람이 판단하게 한다 — 표기 차이로 인한 오탈락이
 * 얼마나 나는지 관측한 뒤에 게이트로 조일지 결정한다.
 */
export function findingNote(report: GroundingReport): string | undefined {
  if (!hasFinding(report)) return undefined;
  const parts: string[] = [];
  if (report.ungrounded.length) {
    parts.push(`소스에서 확인 안 됨: ${report.ungrounded.map((c) => c.raw).join(", ")}`);
  }
  if (report.typeIssues.length) parts.push(report.typeIssues.join(" / "));
  return parts.join(" · ");
}
