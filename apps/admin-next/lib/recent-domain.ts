"use client";

// 마지막으로 연 도메인을 기억한다(대시보드 운영 시작 영역의 기본 도메인 선정에 사용).
const STORAGE_KEY = "adrock.recent.domain";

export function rememberDomain(domain: string): void {
  if (typeof window === "undefined" || !domain) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, domain);
  } catch {
    // localStorage 접근 불가(프라이빗 모드 등)면 무시한다.
  }
}

export function getRecentDomain(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
