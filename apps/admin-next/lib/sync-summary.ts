"use client";

// 마지막 DrivingPlus 동기화 요약(개수·시각)을 브라우저별로 기억한다.
// 서버에 seo_regions 개수 조회 API가 없어, 동기화 실행 시점의 응답을 로컬에 남겨 학원/지역자료 탭에 영속 표시한다.
export type SyncKind = "regions" | "academies";
export interface SyncRecord { count: number; at: string; detail?: string }
export type SyncSummary = Partial<Record<SyncKind, SyncRecord>>;

const KEY = (domain: string) => `adrock.sync.${domain}`;

export function getSyncSummary(domain: string): SyncSummary {
  if (typeof window === "undefined" || !domain) return {};
  try {
    const raw = window.localStorage.getItem(KEY(domain));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function recordSync(domain: string, kind: SyncKind, rec: SyncRecord): SyncSummary {
  const next = { ...getSyncSummary(domain), [kind]: rec };
  if (typeof window !== "undefined" && domain) {
    try { window.localStorage.setItem(KEY(domain), JSON.stringify(next)); } catch { /* 프라이빗 모드 등은 무시 */ }
  }
  return next;
}
