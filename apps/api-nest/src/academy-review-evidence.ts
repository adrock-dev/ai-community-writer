import type { T01AcademyCandidate } from "./t01-data-gated.js";

type Row = Record<string, any>;

export const STUDENT_REVIEW_SOURCE = "운전면허PLUS 실제 수강생 리뷰";

export type StudentReviewEvidence = {
  quote: string;
  source: typeof STUDENT_REVIEW_SOURCE;
  rating: number | null;
  postedAt: string | null;
  authorMasked: string | null;
};

/** A presentation-safe review selected for one final article candidate. */
export type AcademyContentReviewCandidate = {
  academyId: string;
  academyName: string;
  text: string;
  source: { label: typeof STUDENT_REVIEW_SOURCE; url: null; identifier: null };
  eligibleForContent: boolean;
  exclusionReasons: string[];
  selectionScore: number;
};

/**
 * Generation uses the original per-student review records, not a theme summary.
 * The upstream sync has already applied its content-safety filter; this adapter
 * only removes presentation-only markup and masks author identity.
 */
export function studentReviewsForAcademy(row: Row): StudentReviewEvidence[] {
  const stored = parseJsonArray(row.review_json);
  const fallback: Row[] = stored.length ? stored : String(row.review || "").split(/\n+/).map((content) => ({ content }));
  const seen = new Set<string>();
  const reviews: StudentReviewEvidence[] = [];
  for (const item of fallback) {
    const quote = cleanReviewText(item?.content);
    if (!quote || seen.has(quote)) continue;
    seen.add(quote);
    reviews.push({
      quote,
      source: STUDENT_REVIEW_SOURCE,
      rating: finiteRating(item?.point),
      postedAt: safePostedAt(item?.date),
      authorMasked: maskReviewAuthor(item?.author),
    });
  }
  return reviews;
}

/**
 * 학원마다 본문에 실을 수강생 리뷰를 하나 고른다. 같은 슬롯이면 같은 리뷰가 나온다(재현성).
 * 작성자·작성일·평점은 생성 facts 에 노출하지 않는다.
 *
 * 반드시 '적격 리뷰 중에서' 뽑는다. 예전에는 전체에서 먼저 뽑고 나중에 적격 검사를 했는데,
 * 그러면 뽑힌 하나가 탈락할 때 다른 적격 리뷰가 있어도 그 학원은 리뷰를 통째로 잃는다.
 * (현재 데이터에서는 동기화 시점 긍정 필터 덕분에 손실 0건이지만, 적격 조건이 강해지면
 *  조용히 리뷰가 사라지는 구조였다.)
 */
export function selectedStudentReviewForAcademy(row: Row, seed: string): StudentReviewEvidence | null {
  const all = studentReviewsForAcademy(row);
  const reviews = all.filter((review) => isContentEligibleReviewText(review.quote));
  if (!reviews.length) return null;
  return reviews[stableIndex(`${seed}|${row.external_id ?? row.id ?? row.name ?? ""}`, reviews.length)] ?? null;
}

/** 본문 인용 적격 조건. reviewContentCandidate 의 제외 사유와 같은 기준을 쓴다. */
export function isContentEligibleReviewText(text: unknown): boolean {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length < 12) return false;
  if (/\b(?:\d{2,3}-\d{3,4}-\d{4}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})\b/u.test(normalized)) return false;
  return !isPromotionalOnly(normalized);
}

// 리뷰 원문이 100자 이상이면 끝을 …로 줄인다.
// t01-legacy-plus.truncateLegacyPlusReview 와 같은 규칙(순환 의존을 피해 로컬 복제 — 규칙을 바꿀 때 함께 맞춘다).
export function truncateReviewQuote(text: string, maximumLength = 100): string {
  const chars = Array.from(String(text || "").trim());
  if (chars.length < maximumLength) return chars.join("");
  return `${chars.slice(0, Math.max(0, maximumLength - 1)).join("")}…`;
}

export function studentReviewFactLines(row: Row, seed: string): string[] {
  const review = selectedStudentReviewForAcademy(row, seed);
  return review ? [`수강생 리뷰: “${truncateReviewQuote(review.quote)}” (출처: ${review.source})`] : [];
}

/**
 * Select at most one source review for each final academy.  This belongs to
 * the reusable evidence adapter rather than a retired generation mode, and
 * preserves final candidate order for deterministic article assembly.
 */
export function selectEligibleReviewsByAcademy(candidates: T01AcademyCandidate[], seed: string): AcademyContentReviewCandidate[] {
  return candidates.flatMap((candidate) => {
    const eligible = (candidate.studentReviews || [])
      .map((review) => reviewContentCandidate(candidate, review.quote, review.source))
      .filter((review) => review.eligibleForContent)
      .sort((left, right) => right.selectionScore - left.selectionScore
        || stableRank(`${seed}|${left.academyId}|${left.text}`) - stableRank(`${seed}|${right.academyId}|${right.text}`)
        || left.text.localeCompare(right.text));
    return eligible.slice(0, 1);
  });
}

function reviewContentCandidate(candidate: T01AcademyCandidate, text: string, source: typeof STUDENT_REVIEW_SOURCE): AcademyContentReviewCandidate {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  const exclusionReasons: string[] = [];
  if (!normalized) exclusionReasons.push("empty_text");
  if (normalized.length < 12) exclusionReasons.push("too_short");
  if (/\b(?:\d{2,3}-\d{3,4}-\d{4}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})\b/u.test(normalized)) exclusionReasons.push("personal_data");
  if (isPromotionalOnly(normalized)) exclusionReasons.push("promotional_only");
  if (!source) exclusionReasons.push("missing_source");
  const selectionScore = 30
    + Math.min(25, Math.floor(normalized.length / 8))
    + (/(?:설명|상담|수업|강사|일정|차량|연습|안내|예약)/u.test(normalized) ? 18 : 0)
    - (/(?:추천|최고|대박|완벽|무조건|강력)/u.test(normalized) ? 8 : 0);
  return {
    academyId: candidate.academyId,
    academyName: candidate.academyName,
    text: normalized,
    source: { label: source, url: null, identifier: null },
    eligibleForContent: exclusionReasons.length === 0,
    exclusionReasons,
    selectionScore,
  };
}

function isPromotionalOnly(text: string): boolean {
  const signals = text.match(/(?:최고|대박|완벽|무조건|강력\s*추천|가성비\s*최고|친절)/gu) || [];
  return signals.length >= 2 && text.length < 70;
}

function parseJsonArray(value: unknown): Row[] {
  if (Array.isArray(value)) return value.filter((item): item is Row => Boolean(item && typeof item === "object"));
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is Row => Boolean(item && typeof item === "object")) : [];
  } catch {
    return [];
  }
}

function cleanReviewText(value: unknown): string {
  return String(value ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/#[0-9A-Za-z_가-힣]+/g, " ")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function finiteRating(value: unknown): number | null {
  const rating = Number(value);
  return Number.isFinite(rating) && rating >= 0 && rating <= 5 ? rating : null;
}

function safePostedAt(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return /^\d{4}(?:[-./]\d{1,2}){1,2}/.test(text) ? text.slice(0, 10) : null;
}

function maskReviewAuthor(value: unknown): string | null {
  const name = String(value ?? "").trim();
  if (!name) return null;
  const characters = [...name];
  return `${characters[0] ?? ""}${"*".repeat(Math.max(1, characters.length - 1))}`;
}

function stableIndex(seed: string, modulo: number): number {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return modulo <= 1 ? 0 : hash % modulo;
}

function stableRank(seed: string): number {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}
