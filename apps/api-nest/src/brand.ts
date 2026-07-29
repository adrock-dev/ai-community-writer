/**
 * 공개 브랜드명 해석 — 단일 소스.
 *
 * `domains.display_name` 은 관리자 화면에서 도메인을 구분하려고 붙이는 **내부 라벨**이다
 * ("운전전문학원1", "○○ 샘플" 처럼 운영자 편의로 쓰인다). 반면 생성 프롬프트·HTML 내보내기·
 * 공개 API 는 **독자가 글에서 읽는 이름**을 필요로 한다. 두 값이 한 컬럼을 공유하던 시절
 * "○○ 샘플" 라벨이 글 본문까지 흘러가 qa-posts 의 `internal_or_wrong_brand_leak` 에 걸렸고,
 * 그때 컬럼을 나누는 대신 접미사를 잘라내는 정규식이 들어갔다.
 *
 * 이제 공개용은 `domains.brand_name` 이 소유한다. 접미사 정규식은 지우지 않고 남긴다 —
 * brand_name 이 비면 display_name 으로 폴백하므로 라벨이 새어 나갈 경로가 그대로 남아 있다.
 */
type DomainRow = { brand_name?: unknown; display_name?: unknown; domain?: unknown };

/** 라벨에만 붙는 접미사. 폴백 경로로 들어온 값에서만 의미가 있다. */
function stripInternalSuffix(value: string): string {
  return value.replace(/\s*(?:샘플|데모)\s*$/u, "").trim();
}

/** 저장된 브랜드명 후보를 공개 표기로 정규화한다(빈 값이면 빈 문자열). */
export function normalizeBrandName(value: unknown): string {
  const raw = String(value ?? "").trim();
  return raw ? stripInternalSuffix(raw) || raw : "";
}

/** domains 행 → 공개 브랜드명. brand_name → display_name → domain → "서비스". */
export function publicBrandName(domain: DomainRow): string {
  return normalizeBrandName(domain.brand_name)
    || normalizeBrandName(domain.display_name)
    || normalizeBrandName(domain.domain)
    || "서비스";
}
