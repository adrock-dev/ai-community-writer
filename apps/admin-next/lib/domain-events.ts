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

// 셸 배너처럼 화면 밖에서 도메인 화면의 탭을 여는 요청.
//
// 링크만으로는 **이미 그 주소에 있을 때** 아무 일도 일어나지 않는다. 라우터가 같은 주소로
// 본 이동은 건너뛰므로 initialTab prop 이 바뀌지 않고, 탭도 그대로다(주소만 ?tab=academies 인
// 채 다른 탭을 보고 있는 상태가 실제로 생긴다). 탭 전환을 서버 왕복으로 만들지 않으려면
// — 탭은 9개고 자주 누른다 — 이 요청만 따로 알린다.
export const DOMAIN_TAB_REQUEST_EVENT = "adrock:domain-tab-request";

export function requestDomainTab(domain: string, tab: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DOMAIN_TAB_REQUEST_EVENT, { detail: { domain, tab } }));
}
