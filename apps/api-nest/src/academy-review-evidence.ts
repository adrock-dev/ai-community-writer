type Row = Record<string, any>;

export const STUDENT_REVIEW_SOURCE = "DrivingPlus 수강생 리뷰";

export type StudentReviewEvidence = {
  quote: string;
  source: typeof STUDENT_REVIEW_SOURCE;
  rating: number | null;
  postedAt: string | null;
  authorMasked: string | null;
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

/** One review per academy is selected reproducibly for a slot, without exposing
 * author, date, or rating in generation facts. */
export function selectedStudentReviewForAcademy(row: Row, seed: string): StudentReviewEvidence | null {
  const reviews = studentReviewsForAcademy(row);
  if (!reviews.length) return null;
  return reviews[stableIndex(`${seed}|${row.external_id ?? row.id ?? row.name ?? ""}`, reviews.length)] ?? null;
}

export function studentReviewFactLines(row: Row, seed: string): string[] {
  const review = selectedStudentReviewForAcademy(row, seed);
  return review ? [`수강생 리뷰: “${review.quote}” (출처: ${review.source})`] : [];
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
