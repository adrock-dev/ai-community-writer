"use client";

// 도메인 목록이 바뀌었음(생성/삭제)을 알리는 브라우저 이벤트.
// 루트 레이아웃(AppShell)은 마운트 시 한 번만 도메인을 조회하므로, 같은 페이지에서 도메인을
// 만들거나 지워도 사이드바가 갱신되지 않는다. 변경 측에서 이 이벤트를 쏘면 AppShell 이 재조회한다.
export const DOMAINS_CHANGED_EVENT = "adrock:domains-changed";

export function notifyDomainsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DOMAINS_CHANGED_EVENT));
}
