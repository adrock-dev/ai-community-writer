export const DEFAULT_DRIVINGPLUS_API_BASE_URL = "https://api.drivingplus.me";

export function adminApiBaseUrl(): string {
  return String(
    process.env.SEO_API_BASE_URL ||
      `http://${process.env.ADMIN_HOST || "127.0.0.1"}:${process.env.ADMIN_PORT || 8765}`,
  ).replace(/\/$/, "");
}

export function drivingplusApiBaseUrl(): string {
  return String(process.env.DRIVINGPLUS_API_BASE_URL || DEFAULT_DRIVINGPLUS_API_BASE_URL).replace(/\/$/, "");
}

/**
 * 원천 블로그리뷰 수집 스위치. **기본 꺼짐.**
 *
 * 원천은 네이버 블로그 검색으로 학원명을 느슨하게 매칭해 오배정이 섞인다(2026-07-27 실측 539건:
 * 55건은 학원 고유명이 글 어디에도 없고, 같은 글 18건이 이름이 비슷한 학원 2~3곳에 중복 배정).
 * 글 생성에서는 이미 뺐고(`389ce0d`), 수집까지 멈춰 낡은 자료가 더 쌓이지 않게 한다.
 *
 * 지우지 않고 스위치로 둔 이유: 블로그 글 자체를 검증해 올바른 것만 쓰는 방향을 검토 중이라,
 * 그 판별이 생기면 다시 켜야 한다. 이미 수집된 자료는 그대로 보존된다(학원 상세 화면 참고용).
 *
 * 켜려면 `DRIVINGPLUS_BLOG_REVIEW_SYNC=1`.
 */
export function blogReviewSyncEnabled(): boolean {
  const raw = String(process.env.DRIVINGPLUS_BLOG_REVIEW_SYNC ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}
