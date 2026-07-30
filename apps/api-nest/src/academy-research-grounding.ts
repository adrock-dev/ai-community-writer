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

// --- 서술형 근거 검사 -----------------------------------------------------
//
// 숫자 대조만으로는 학원별 특징이 통째로 무검증이다. 실측(34곳): self_test 13곳 중 11곳,
// facilities 27곳 중 25곳, shuttle_summary 15곳 중 14곳에 숫자가 아예 없다.
// 정작 그 값들이 글의 강조점으로 쓰이고, 틀리면 독자가 헛걸음한다("야간반 운영" 을 믿고 갔는데 없음).
//
// 그래서 필드마다 "이 값이 참이면 수집 소스에 반드시 있어야 할 낱말" 을 정해 대조한다.
// 소스에 그 낱말조차 없으면 모델이 근거 없이 지어낸 것으로 본다.
//
// 한계는 분명하다 — 소스에 "야간반 운영" 이 학원 홍보 문구로 적혀 있으면 통과한다.
// 그건 필드 타입 검사(광고 표현 차단)가 맡는 몫이고, 여기서는 날조만 잡는다.
const EVIDENCE_KEYWORDS: Record<string, string[]> = {
  night_class: ["야간", "야간반", "새벽", "심야", "저녁", "교시", "시간표", "부"],
  weekend: ["주말", "토요일", "일요일", "토·일", "휴무"],
  closed_days: ["휴무", "휴일", "쉬는", "정기휴"],
  self_test: ["자체시험", "자체 시험", "자체 코스", "장내기능", "기능시험", "검정", "채점", "실격", "응시"],
  shuttle_summary: ["셔틀", "통학", "통근", "버스"],
  shuttle_available: ["셔틀", "통학", "통근", "버스"],
  facilities: ["시설", "주차", "휴게", "화장실", "편의", "인터넷", "차량", "코스"],
  enrollment_prep: ["준비", "지참", "신분증", "사진", "접수", "등록", "구비"],
  booking_channel: ["예약", "상담", "신청", "문의", "접수"],
  transit_access: ["지하철", "역", "정류장", "버스", "도보", "노선", "환승", "터미널", "하차", "승차"],
  parking_note: ["주차", "만차", "주차장", "협소", "내비"],
  // 랜드마크는 "무엇이 곁에 있는가"라 고유명사가 근거다. 대학·역·단지·상권 같은 종류어를 둔다.
  nearby_landmarks: ["대학", "대학교", "역", "터미널", "산업단지", "공단", "시장", "상권", "아파트", "청사", "공원", "IC", "사거리", "오거리"],
  licenses: ["종", "면허", "원동기", "견인", "대형"],
  established_year: ["설립", "개원", "창립", "년"],
  scale: ["면적", "규모", "정원", "㎡", "평"],
};

/** 이 필드가 서술형 근거 검사 대상인지. */
export function hasEvidenceRule(field: string): boolean {
  return Boolean(EVIDENCE_KEYWORDS[field]?.length);
}

/**
 * 값이 주장이 아니라 "모름·없음" 인 경우. 근거를 요구할 대상이 아니다.
 * 스키마가 "yes"|"no"|"unknown" 을 허용하는 필드가 있어 실제로 이런 값이 들어온다.
 */
const NON_CLAIM_VALUES = new Set(["unknown", "no", "none", "n/a", "-", "없음", "미확인", "해당없음", "확인불가"]);

export function isNonClaimValue(value: string | null | undefined): boolean {
  const text = String(value ?? "").trim().toLowerCase();
  return !text || NON_CLAIM_VALUES.has(text);
}

/**
 * 값이 주장하는 사실의 근거 낱말이 소스에 있는지.
 * 규칙이 없는 필드는 검사하지 않는다(true 를 돌려 통과시킨다).
 */
export function hasEvidenceKeyword(field: string, haystack: string): boolean {
  const keywords = EVIDENCE_KEYWORDS[field];
  if (!keywords?.length) return true;
  const text = String(haystack ?? "");
  return keywords.some((keyword) => text.includes(keyword));
}

// --- 필드 타입 검증 -------------------------------------------------------
// 그라운딩과 별개 축이다. "소스에 있는가"가 아니라 "이 필드에 들어올 수 있는 값인가"를 본다.
// 소스에 광고 문구가 실제로 적혀 있으면 그라운딩은 통과하지만, 그 문구를 합격률 필드에
// 담으면 안 된다. 두 모델을 붙여도 이건 잡히지 않는다(둘 다 같은 문구를 옮겨 적는다).

const AD_CLAIM_WORDS = [
  "최고", "최상", "제일", "최단", "가장", "1위", "no.1", "넘버원",
  "보장", "100%", "타사보다", "업계 최",
  // 최상급·유일성 주장. "최대" 와 같은 종류인데 목록에 없어 그대로 새어 나갔다 —
  // 2026-07-29 발행 글에 "부산 최초로 1종 대형면허 학원 자체 시험장을 갖추고 있음"(#412)이
  // 실렸다. 확인할 방법이 없는 비교 주장이고, 출처는 학원 자기 소개문이다.
  //
  // 다만 "1996년 전북 최초 전문학원 지정"(#168)처럼 연도가 붙은 이력은 검증 가능한 사실에
  // 가깝다. 기계로는 그 둘을 가르기 어려우므로 차단하지 않고 needs_review 로 내려
  // 사람이 판단하게 둔다(실측 대상 3건).
  "최초", "유일", "독보", "최다",
];

/**
 * "최대" 는 통째로 막을 수 없다. 정원 표기에도 쓰인다 —
 * "최대 수용 가능 인원 4명" 같은 사실이 광고로 잡혔다(실측 13건).
 * 규모·순위를 주장할 때만 걸러낸다.
 */
const AD_CLAIM_PATTERNS: Array<[RegExp, string]> = [
  // "최대" 뒤에 오는 것이 **규모를 가리키는 명사**면 광고 주장이다.
  // 실측에서 "전남권 최대 부지 2만 평"(#234)이 새어 나갔다 — 비교 범위가 앞 목록에 없는
  // 지역명이면 두 번째 패턴도 걸지 못하므로, 명사 쪽을 넓히는 것이 확실하다.
  [/최대\s*(규모|크기|면적|시설|부지|코스|주행로|연습장|학원)/u, "최대 규모"],
  [/(전국|지역|수도권|시내|업계)\s*최대/u, "최대 주장"],
];

/** 개인 거래·중고 플랫폼 가격은 학원 공식 요금이 아니다. */
const PERSONAL_MARKET_WORDS = ["당근", "중고나라", "번개장터", "직거래"];

// transit_access 는 일부러 뺐다. "가장 가까운 정류장"·"최단 도보 경로"는 광고가 아니라
// 길 안내 그 자체라, 여기 넣으면 정확한 값일수록 걸린다. parking_note 는 반대로
// "최대 규모 주차장" 같은 주장이 실제로 들어갈 수 있는 자리다.
const AD_CLAIM_SENSITIVE_FIELDS = new Set([
  "pass_rate", "scale", "facilities", "licenses", "shuttle_summary", "self_test", "fee_summary",
  "parking_note",
]);

export function fieldTypeIssues(field: string, value: string | null | undefined): string[] {
  const text = String(value ?? "").trim();
  if (!text) return [];
  const lower = text.toLowerCase();
  const issues: string[] = [];
  const adWord = AD_CLAIM_WORDS.find((w) => lower.includes(w))
    ?? AD_CLAIM_PATTERNS.find(([re]) => re.test(text))?.[1];

  if (field === "pass_rate" && !/\d/.test(text)) {
    issues.push("합격률에 수치가 없음(서술만)");
  }
  if (field === "fee_summary") {
    // "구체 금액이 공개돼 있지 않음" 은 모델의 정직한 보고다. 결함으로 잡으면
    // 정확히 답할수록 걸리는 규칙이 된다(night_class 에서 겪은 것과 같은 패턴).
    // "금액이 없다" 는 여러 갈래로 적힌다 — "공개돼 있지 않음"·"표기 없음"·"소스에 없음"·"미공개".
    const reportsAbsence = /(금액|가격|요금)[^.]{0,16}(없|미공개|비공개|확인\s*불가|않)/u.test(text)
      || /(공개|표기|게시|명시)[^.]{0,10}(없|않)/u.test(text)
      || /미공개|비공개/u.test(text);
    if (!/\d/.test(text) && !reportsAbsence) issues.push("요금 요약에 금액이 없음");
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

/**
 * 값 자체가 URL 인 필드. 숫자 대조를 하면 안 된다 —
 * 퍼센트 인코딩(%EA·%B0)을 퍼센트 수치로 읽어 "소스에 없는 95%·82%" 를 지적한다(실측 11건).
 */
const URL_FIELDS = new Set(["homepage_url", "naver_place_url", "kakao_url"]);

export function inspectResearchValue(field: string, value: string | null | undefined, sourceText: string): GroundingReport {
  if (URL_FIELDS.has(field)) return { field, ungrounded: [], grounded: 0, typeIssues: [] };
  const claims = extractClaims(value);
  const ungrounded = claims.filter((c) => !isClaimGrounded(c, sourceText));
  const typeIssues = fieldTypeIssues(field, value);
  // 숫자가 하나도 없는 서술형 값은 위 대조를 그냥 통과한다. 근거 낱말로 한 번 더 본다.
  //
  // 두 경우는 면제한다. 실측 5건이 전부 여기 걸렸는데, 하필 **모델이 가장 신중하게 답한 값**이었다.
  //  - 주장이 아닌 값("unknown"·"no"): 근거를 요구할 대상이 아니다.
  //  - 숫자 클레임이 이미 전부 소스에서 확인된 값: 근거가 이미 붙어 있다. 예를 들어
  //    night_class 에 "교육시간표 11부 18:10~19:00" 이라 적고 야간반이라 단정하지 않은 값은,
  //    시각이 소스에 있으니 근거가 있는 것이다. "야간" 이라는 낱말이 없다고 지적하면
  //    정직하게 답할수록 걸리는 규칙이 된다.
  const claimsAllGrounded = claims.length > 0 && ungrounded.length === 0;
  if (!isNonClaimValue(value) && !claimsAllGrounded && !hasEvidenceKeyword(field, sourceText)) {
    typeIssues.push(`수집 소스에 ${field} 근거가 없음(관련 낱말이 소스에 나오지 않음)`);
  }
  return { field, ungrounded, grounded: claims.length - ungrounded.length, typeIssues };
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
