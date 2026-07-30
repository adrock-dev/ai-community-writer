"use client";

/*
  사용자가 접은 작업 카드를 브라우저별로 기억한다.

  실패·진행 중 카드는 기본으로 펼쳐 둔다 — 눈에 띄어야 하는 상태이므로 그 기본값 자체는 맞다.
  문제는 **읽고 나서 치울 수 없었다**는 것이다. open 을 상태 없이 매 렌더마다 계산해 넘겼기
  때문에, 접어도 다른 메뉴에 다녀오면 컴포넌트가 새로 마운트되며 다시 펼쳐졌다(같은 화면에
  머무는 동안에는 유지됐다 — 그래서 "다른 메뉴 다녀오면"이라는 증상으로 보였다).

  접은 선택만 기억하면 새 실패는 여전히 펼쳐져 눈에 띄고, 이미 확인한 것은 접힌 채 남는다.
  펼친 선택은 저장하지 않는다 — 기본이 펼침이므로 저장할 것이 없고, 목록이 무의미하게 커진다.

  상한을 두는 이유는 recent-domain 과 같다: 잡은 계속 쌓이므로 무한히 모으지 않는다.
*/
const STORAGE_KEY = "adrock.collapsed.jobs";
const MAX = 200;

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string" && v.length > 0) : [];
  } catch {
    return [];
  }
}

export function isJobCollapsed(jobId: string): boolean {
  return read().includes(jobId);
}

/** collapsed=true 면 기억하고, false 면 기억에서 지운다(기본이 펼침이라 저장할 것이 없다). */
export function setJobCollapsed(jobId: string, collapsed: boolean): void {
  if (typeof window === "undefined" || !jobId) return;
  try {
    const rest = read().filter((id) => id !== jobId);
    const next = collapsed ? [jobId, ...rest].slice(0, MAX) : rest;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage 접근 불가(프라이빗 모드 등)면 무시한다. 접기 자체는 화면에서 동작한다.
  }
}
