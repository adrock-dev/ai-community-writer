"use client";

// 도메인 목록(과 그 상태)이 바뀌었음을 알리는 브라우저 이벤트.
// 루트 레이아웃(AppShell)은 마운트 시 한 번만 도메인을 조회하므로, 같은 페이지에서 도메인을
// 만들거나 지워도 사이드바가 갱신되지 않는다. 변경 측에서 이 이벤트를 쏘면 AppShell 이 재조회한다.
//
// 생성/삭제뿐 아니라 **도메인 상태가 바뀌는 일**(조사값 승인 → pending_link 켜짐, 학원자료
// 연결 → 꺼짐)에도 쏜다. 셸 배너가 그 값을 읽으므로, 안 쏘면 승인 직후에는 안 뜨고
// 연결 직후에도 안 사라진다. 폴링 대신 이 이벤트를 쓰는 이유다.
export const DOMAINS_CHANGED_EVENT = "adrock:domains-changed";

export function notifyDomainsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DOMAINS_CHANGED_EVENT));
}
