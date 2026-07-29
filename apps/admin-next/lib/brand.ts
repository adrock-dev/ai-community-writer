/**
 * 관리자 UI 쪽 브랜드 해석·검증. API 의 `apps/api-nest/src/brand.ts` 와 짝을 이룬다
 * (두 앱은 npm workspace 로 묶여 있지 않아 모듈을 공유할 수 없다 — 규칙을 바꾸면 양쪽을 함께 고쳐라).
 *
 * `display_name` 은 관리자 목록에서 도메인을 구분하는 내부 라벨이고,
 * `brand_name` 은 글 본문·CTA·공개 API 에 노출되는 이름이다. 비면 라벨로 폴백한다.
 */

function normalizeBrandName(value: unknown): string {
  const raw = String(value ?? "").trim();
  return raw ? raw.replace(/\s*(?:샘플|데모)\s*$/u, "").trim() || raw : "";
}

export function publicBrandName(source: { brand_name?: string | null; display_name?: string | null } | string | null | undefined): string {
  if (typeof source === "string") return normalizeBrandName(source) || "서비스";
  return normalizeBrandName(source?.brand_name) || normalizeBrandName(source?.display_name) || "서비스";
}

/**
 * 업종 일반명사. 브랜드명이 이 중 하나에 포함되면 글 안에서 브랜드인지 일반명사인지
 * 구분되지 않는다 — 예: 브랜드명 "운전면허" + 주 키워드 "○○시 운전면허학원".
 */
const GENERIC_BRAND_TERMS = [
  "운전면허학원", "자동차운전전문학원", "운전전문학원", "자동차운전학원",
  "운전면허시험장", "운전학원", "운전면허", "면허학원", "운전",
];

/** 저장 전 안내용 경고(차단하지 않는다). 비어 있으면 문제 없음. */
export function brandNameWarnings(value: string): string[] {
  const brand = String(value ?? "").trim();
  if (!brand) return [];
  const warnings: string[] = [];
  const compact = brand.replace(/\s+/gu, "");
  // 양방향 포함 검사: "운전면허"(⊂ 운전면허학원)도, "운전면허학원"(= 일반명사)도 잡는다.
  if (GENERIC_BRAND_TERMS.some((term) => term === compact || term.includes(compact) || compact === term)) {
    warnings.push(`"${brand}"은 업종 일반명사라 주 키워드와 겹칩니다. 글 안에서 브랜드인지 일반 단어인지 구분되지 않고, CTA가 "${brand}에서 상담받으세요"처럼 어색해집니다.`);
  }
  if (/\s*(?:샘플|데모)\s*$/u.test(brand)) {
    warnings.push('"샘플"·"데모" 접미사는 공개 글에 나가면 품질 게이트에 걸리므로 저장 시 자동으로 제거됩니다.');
  }
  return warnings;
}
