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
  // 정보량이 높은 후기를 먼저 고른다. 예전에는 시드 균등 무작위라 "하하^^ 엄청 좋아요!!" 같은
  // 빈약한 후기가 화면 인용으로 뽑히고, 정작 카드 바닥 분위기 문장의 근거가 된 긴 후기는 안 보였다.
  // Legacy Plus 선택(selectEligibleReviewsByAcademy)과 같은 점수 기준을 쓰고, 시드는 동점 처리로만
  // 남겨 재현성을 유지한다.
  // 다른 리뷰·평점 논평형과 수강 전 다짐 글은 화면 인용으로 쓰지 않는다. 남는 후보가 없으면 인용을
  // 생략한다(억지로 부적절한 후기를 '실제 수강생 리뷰'로 노출하지 않는다). 이때 studentReviewFactLines
  // 가 빈 배열을 돌려 후기 근거가 프롬프트에 아예 들어가지 않으므로, 카드는 자료 차별점으로 열린다.
  const preferred = reviews.filter((review) => !isReviewAboutOtherReviews(review.quote) && !isPreEnrollmentStatement(review.quote));
  if (!preferred.length) return null;
  return [...preferred].sort((left, right) =>
    reviewSelectionScore(right.quote) - reviewSelectionScore(left.quote)
    || stableRank(`${seed}|${left.quote}`) - stableRank(`${seed}|${right.quote}`)
    || left.quote.localeCompare(right.quote))[0] ?? null;
}

/**
 * 본문 인용 값어치 점수 — 길이(정보량) + 구체 소재(설명·상담·수업 등) − 과장 상투어.
 * Legacy Plus 경로와 facts 경로가 같은 기준으로 고르도록 한 곳에 둔다.
 */
function reviewSelectionScore(text: string): number {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  return 30
    + Math.min(25, Math.floor(normalized.length / 8))
    + (/(?:설명|상담|수업|강사|일정|차량|연습|안내|예약)/u.test(normalized) ? 18 : 0)
    - (/(?:추천|최고|대박|완벽|무조건|강력)/u.test(normalized) ? 8 : 0)
    // Legacy Plus 경로에서도 메타 논평 후기가 밀리도록 감점(표시 경로는 아래 하드 필터가 담당).
    - (isReviewAboutOtherReviews(normalized) ? 30 : 0);
}

/**
 * 다른 리뷰·평점을 논평하거나 강사 편차·불안을 말하는 후기.
 * 내용은 사실이지만 카드를 부정적 인상으로 열게 하므로 화면 인용 후보에서 뺀다
 * (카드 도입부 개성 문장에 적용한 기준과 같다).
 *
 * 네 갈래로 본다.
 *  1) 다른 리뷰·평점을 직접 가리키는 말(기존 규칙).
 *  2) **"리뷰/후기"를 부정적 반응과 함께 말하는 문장.** 이쪽이 실제로 새는 자리였다 —
 *     "솔직히 처음에 후기를 봤을 때는 조금 걱정되고 망설여졌어요"(홍천, 평균 3.3점)가
 *     5점 리뷰라 그대로 통과해 발행 글에 인용됐다. 호평이어도 첫 문장이 "이 학원 평판이
 *     나쁘다"를 독자에게 알린다. 1번 규칙은 "후기"라는 낱말을 보지 않아 못 잡았다.
 *  3) **낱말 없이 지시대명사로 남들 말을 가리키며 반박하는 문장.** 1·2번은 "리뷰/후기"라는
 *     낱말을 찾으므로 "다들 이러는데"로 가리키면 통과한다. 실제 누락: "강사분이 뭐 뭐라한다
 *     틱틱댄다 다들 이러는데 그정도는 아님"(강남 삼일)이 후기 3건 중 1위로 뽑혀 카드가
 *     방어적인 문장으로 닫혔다. 반박("그정도는 아님")이 함께 있을 때만 잡는다 —
 *     전언 어미만으로 넓히면 "다들 친절하시던데"까지 걸린다(실측: 넓혀도 추가 0건).
 *  4) **"리뷰/후기"가 부정 방향 지시어와 붙은 문장.** 2번의 부정 어휘는 활용형을 못 따라가
 *     "후기나쁜이유는 모르겠고"를 놓쳤다(`나쁘` 만 있고 `나쁜` 이 없다).
 *
 * 반대로 다음은 걸리면 안 된다.
 *  - "면허 딴 후기 남깁니다" — 자기 글을 후기라 부르는 표현
 *  - "앱에서 남기는 후기들도 학원에서 보는지 모르겠지만" — 자기 후기의 전달 여부 얘기
 *  - "후기 많이 찾아봤는데 왜 평이 좋은지 알겠더라" — **긍정** 논평은 카드를 부정적으로 열지 않는다
 * 그래서 3·4번은 `왜`·`모르겠` 같은 중립어가 아니라 반박·부정 방향일 때만 잡는다
 * (실측 1,223건: 3·4번으로 +5건, 위 세 유형 0건 오탐).
 */
const OTHER_REVIEW_COMMENTARY = /(?:리뷰\s*보고|리뷰들|옛날\s*리뷰|별점|평점|믿지\s*마|운빨|겁먹)/u;
const NEGATIVE_REPUTATION_MENTION = /(?:리뷰|후기|평가|평이)[^.!?\n]{0,15}(?:걱정|망설|겁|쫄|고민|무서|불안|낮|나쁘|안\s*좋|안좋|욕|너무하|조작|어이없)|(?:걱정|망설|겁\s*먹|겁먹|쫄|고민|불안)[^.!?\n]{0,15}(?:리뷰|후기|별점|평점)/u;
const HEARSAY_REBUTTAL = /(?:다들|남들|사람들)[^.!?\n]{0,20}(?:는데|던데|더라|길래)[^.!?\n]{0,25}(?:아님|아니|그정도|그 정도|지장\s*없|상관\s*없)/u;
const REPUTATION_DOUBT = /(?:리뷰|후기|별점|평점)[^.!?\n]{0,10}(?:나쁜|나쁘|이런지|그런지|이상하|의아)/u;

export function isReviewAboutOtherReviews(text: unknown): boolean {
  const normalized = String(text || "").replace(/\s+/g, " ");
  return OTHER_REVIEW_COMMENTARY.test(normalized) || NEGATIVE_REPUTATION_MENTION.test(normalized)
    || HEARSAY_REBUTTAL.test(normalized) || REPUTATION_DOUBT.test(normalized);
}

/**
 * 아직 다니지 않은 사람의 다짐·계획 글("다시 여기서 도전해보려합니다").
 * 수강 경험 서술 없이 앞으로 하겠다는 말만 있으면 '실제 수강생 리뷰'로 노출하기에 부적절하다.
 * 실제 경험을 쓴 뒤 재방문 계획을 덧붙인 후기는 과거 경험 표현이 있어 제외되지 않는다.
 */
export function isPreEnrollmentStatement(text: unknown): boolean {
  const normalized = String(text || "").replace(/\s+/g, " ");
  const futureIntent = /(?:해보려|해볼|도전하겠|다녀볼|등록하려|다니려|가보려|시작하려)/u.test(normalized);
  const pastExperience = /(?:주셨|주십니다|주세요|하셨|했어요|했습니다|받았|배웠|다녔|합격했|알려주|가르쳐|친절하)/u.test(normalized);
  return futureIntent && !pastExperience;
}

/** 본문 인용 적격 조건. reviewContentCandidate 의 제외 사유와 같은 기준을 쓴다. */
export function isContentEligibleReviewText(text: unknown): boolean {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length < 12) return false;
  if (/\b(?:\d{2,3}-\d{3,4}-\d{4}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})\b/u.test(normalized)) return false;
  return !isPromotionalOnly(normalized);
}

/**
 * 문장이 끝나는 자리(끝 문자 다음 인덱스). 없으면 -1.
 *
 * 한국어 후기는 마침표 없이 종결어미로 끊기는 경우가 많아 어미도 함께 본다
 * ("…일정 잡기도 수월했어요 연세대" 의 경계는 "요" 다음이다).
 *
 * **뒤에 공백이 이어질 때만 인정한다.** 잘린 자리의 끝 글자까지 경계로 보면 절단이 만든
 * 가짜 경계에 속는다 — "그리고 이어지는 다른" 이 99자에서 "…이어지는 다" 로 잘리면 그 "다"가
 * 종결어미처럼 보인다.
 */
const SENTENCE_END_RE = /(?:[.!?]+|~+|[다요죠까네])(?=\s)/gu;
function lastSentenceEnd(text: string): number {
  let end = -1;
  for (const match of text.matchAll(SENTENCE_END_RE)) {
    const at = match.index;
    const token = match[0];
    if (at === undefined || token === undefined) continue;
    end = at + token.length;
  }
  return end;
}

/** 문장 경계로 물릴 수 있는 최소 지점(한도 대비). 이보다 앞이면 버리는 양이 너무 많다. */
const SENTENCE_TRIM_FLOOR = 0.8;

/**
 * 리뷰 원문이 한도를 넘으면 끝을 …로 줄인다.
 *
 * 자른 자리 가까이에 문장 경계가 있으면 거기까지 물린다. 글자 수만 보고 끊으면 문장
 * 한복판에서 끝나 읽다 만 인용이 된다(실측: 발행 인용 42건 중 23건이 잘렸고 그중 17건은
 * 50자 이후에 경계가 있었다. "…일정 잡기도 수월했어요 연세대 …" 는 6자만 덜 갔으면 됐다).
 * 다만 경계가 한도의 80%보다 앞이면 버리는 양이 커져 그대로 끊는다.
 *
 * t01-legacy-plus.truncateLegacyPlusReview 와 같은 규칙(순환 의존을 피해 로컬 복제 —
 * 규칙을 바꿀 때 함께 맞춘다. postedit 이 이 값으로 인용을 매칭해 어긋나면 매칭이 깨진다).
 */
export function truncateReviewQuote(text: string, maximumLength = 100): string {
  const chars = Array.from(String(text || "").trim());
  // 경계값은 "100자 이상이면 줄인다" 그대로 둔다(전용 테스트가 있는 의도된 규칙이다).
  if (chars.length < maximumLength) return chars.join("");
  const head = chars.slice(0, Math.max(0, maximumLength - 1)).join("");
  const end = lastSentenceEnd(head);
  return `${end >= Math.floor((maximumLength - 1) * SENTENCE_TRIM_FLOOR) ? head.slice(0, end) : head}…`;
}

/**
 * 본문 인용용 1건 + 분위기 판단 근거용 나머지 적격 후기.
 *
 * 카드 바닥의 '학원 분위기 한 문장'은 단정형 직접 서술이라, 근거가 후기 1건뿐이면 표본이 얇다.
 * 그래서 그 학원의 적격 후기 전체를 근거로 함께 넘긴다(예: 동해 5건이 모두 '친절'을 말하면
 * 단정이 안전해진다). 인용은 여전히 1건만 — 나머지는 근거 전용이라 본문에 옮기지 않는다
 * (카드 레이아웃과 Legacy Plus 인용 잠금을 그대로 유지하기 위함).
 */
export function studentReviewFactLines(row: Row, seed: string): string[] {
  const review = selectedStudentReviewForAcademy(row, seed);
  if (!review) return [];
  const lines = [`수강생 리뷰: “${truncateReviewQuote(review.quote)}” (출처: ${review.source})`];
  const others = studentReviewsForAcademy(row)
    .filter((item) => isContentEligibleReviewText(item.quote) && item.quote !== review.quote)
    .map((item) => `“${truncateReviewQuote(item.quote)}”`);
  if (others.length) lines.push(`추가 후기(내부 판단용 · 본문에 인용·언급 금지): ${others.join(" | ")}`);
  return lines;
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
  const selectionScore = reviewSelectionScore(normalized);
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
