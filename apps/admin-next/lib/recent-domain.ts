"use client";

// 최근 접근한 도메인을 브라우저별로 기억한다. 사이드바 기본 도메인과 대시보드 정렬에 사용한다.
const STORAGE_KEY = "adrock.recent.domain";
const HISTORY_STORAGE_KEY = "adrock.recent.domains";
const MAX_HISTORY = 20;

export function rememberDomain(domain: string): void {
  if (typeof window === "undefined" || !domain) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, domain);
    const next = [domain, ...getRecentDomains().filter((item) => item !== domain)].slice(0, MAX_HISTORY);
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
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

export function getRecentDomains(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const history = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
    const recent = window.localStorage.getItem(STORAGE_KEY);
    return recent && !history.includes(recent) ? [recent, ...history].slice(0, MAX_HISTORY) : history.slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}
