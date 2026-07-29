"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { listDomains } from "@/lib/api";
import { DOMAINS_CHANGED_EVENT } from "@/lib/domain-events";
import { isDomainMenuFrom, needDomainHref } from "@/lib/domain-gate";
import { pickDefaultDomain } from "@/lib/domains";
import { getRecentDomain, rememberDomain } from "@/lib/recent-domain";

const SIDEBAR_STORAGE_KEY = "adrock.sidebar.open";

export default function AppShell({ children, apiBase }: { children: React.ReactNode; apiBase: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const menuFrom = isDomainMenuFrom(searchParams.get("from")) ? searchParams.get("from") : null;
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [domains, setDomains] = useState<Awaited<ReturnType<typeof listDomains>>["items"]>([]);
  const [domainsReady, setDomainsReady] = useState(false);
  // 마지막으로 연 도메인(localStorage). 도메인이 URL에 없는 페이지(/jobs, /settings 등)에서 앵커로 쓴다.
  // pathname 이 바뀔 때마다 다시 읽어, 방금 보던 도메인을 반영한다.
  const [recentDomain, setRecentDomain] = useState<string | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (saved !== null) setSidebarOpen(saved === "true");
  }, []);

  useEffect(() => { setRecentDomain(getRecentDomain()); }, [pathname]);

  // 화면을 옮길 때마다 도메인 상태를 다시 읽는다. 배너(pending_link)가 이 목록에 실려 오므로,
  // 이벤트를 못 받은 경로(다른 탭에서 승인 등)로 바뀐 상태도 이동 한 번이면 따라잡는다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (domainsReady) void loadDomains(); }, [pathname]);

  async function loadDomains() {
    try {
      const res = await listDomains();
      setDomains(res.items);
    } catch {
      setDomains([]);
    } finally {
      setDomainsReady(true);
    }
  }

  // 마운트 시 1회 조회 + 도메인 생성/삭제 이벤트 시 재조회(루트 레이아웃이라 다른 방법으론 안 갱신됨).
  useEffect(() => {
    loadDomains();
    const onChange = () => loadDomains();
    window.addEventListener(DOMAINS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(DOMAINS_CHANGED_EVENT, onChange);
  }, []);

  function toggleSidebar() {
    setSidebarOpen((current) => {
      const next = !current;
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      return next;
    });
  }

  const defaultDomain = useMemo(() => pickDefaultDomain(domains), [domains]);
  // 현재 보고 있는 도메인(/t/{domain}/...)을 우선 사용한다. 없을 때만(대시보드 등) 기본 도메인으로 폴백.
  // 이렇게 하지 않으면 사이드바 메뉴가 지금 보는 도메인이 아니라 기본 도메인으로 이동해 버린다.
  const currentDomain = useMemo(() => {
    const seg = pathname.match(/^\/t\/([^/]+)/)?.[1];
    return seg ? decodeURIComponent(seg) : null;
  }, [pathname]);
  // 우선순위: 현재 URL 도메인 → 마지막 접속 도메인(아직 존재할 때) → 작업량 휴리스틱 기본 도메인.
  const rememberedDomain = recentDomain && domains.some((d) => d.domain === recentDomain) ? recentDomain : null;
  const activeDomain = currentDomain ?? rememberedDomain ?? defaultDomain?.domain ?? null;
  const hasDomain = Boolean(activeDomain);
  const domainBase = activeDomain ? `/t/${encodeURIComponent(activeDomain)}` : "";
  const manageHref = hasDomain ? domainBase : needDomainHref("manage");
  const generationHref = hasDomain ? `${domainBase}/generate` : needDomainHref("generate");
  const reviewHref = hasDomain ? `${domainBase}/posts` : needDomainHref("review");
  const onNeedDomainPage = pathname === "/need-domain";
  // /t/{domain} 접두를 뗀 하위 경로로 정확 매칭한다(도메인 이름에 generate/posts 가 들어가도 오판정 방지).
  const domainSubPath = pathname.startsWith("/t/") ? pathname.replace(/^\/t\/[^/]+/, "") : null;
  const onDomainOverview = domainSubPath === "";
  const onGenerate = domainSubPath === "/generate";
  const onReview = domainSubPath === "/posts" || (domainSubPath?.startsWith("/post/") ?? false);
  const activeDomainRow = domains.find((d) => d.domain === activeDomain);
  const activeDomainColor = activeDomainRow?.brand_color ?? "var(--primary)";
  /*
    조사 자료가 마지막 「학원자료 연결」보다 새로우면 그 도메인 글은 아직 옛 값으로 나간다.
    자료를 승인하는 화면(자료관리)은 도메인을 모르는 전역 화면이라 거기서는 알릴 수 없다 —
    도메인을 아는 것은 운영 대상 선택기를 가진 이 셸이다. 그래서 배너의 주인은 셸이다.

    닫기 버튼은 두지 않는다. 닫고 잊으면 놓치는 것과 같고, 대기가 풀리면 스스로 사라진다.
    실행(연결)은 여기서 하지 않는다 — 연결은 원천에서 내려간 학원 정리까지 하므로 결과를
    보여줄 화면이 필요하다. 원천 데이터 탭으로 보내고 실행은 거기 안내가 맡는다.
  */
  const pendingLinkDomain = activeDomainRow?.pending_link ? activeDomainRow : null;
  function switchDomain(next: string) {
    if (!next || next === activeDomain) return;
    rememberDomain(next);
    setRecentDomain(next);
    // 현재 보던 하위 화면을 유지한다(글 상세는 목록으로, 도메인 무관 페이지는 관리 화면으로).
    const sub = onGenerate ? "/generate" : onReview ? "/posts" : "";
    router.push(`/t/${encodeURIComponent(next)}${sub}`);
  }

  return (
    <div className={`shell ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}>
      <button
        type="button"
        className="sidebar-toggle"
        aria-label={sidebarOpen ? "사이드바 닫기" : "사이드바 열기"}
        aria-expanded={sidebarOpen}
        onClick={toggleSidebar}
      >
        {sidebarOpen ? "‹" : "☰"}
      </button>
      <aside className="sidebar" aria-hidden={!sidebarOpen}>
        <Link href="/" className="brand" tabIndex={sidebarOpen ? 0 : -1}>
          <span className="brand-mark">A</span>
          <span><b>Adrock Ops</b><small>Internal</small></span>
        </Link>

        <nav className="side-nav" aria-label="관리 메뉴">
          <p>콘텐츠 운영</p>
          <div className="side-domain in-nav">
            <p><span aria-hidden style={{ color: domains.length ? activeDomainColor : "#cbd5e1" }}>●</span> 운영 대상</p>
            <select
              className="select"
              value={domains.length ? (activeDomain ?? "") : ""}
              onChange={(e) => switchDomain(e.target.value)}
              disabled={!sidebarOpen || domains.length === 0}
              tabIndex={sidebarOpen ? 0 : -1}
              aria-label="현재 도메인 전환"
            >
              {domains.length === 0
                ? <option value="">도메인 없음 — 먼저 생성</option>
                : domains.map((d) => <option key={d.domain} value={d.domain}>{d.display_name || d.domain}</option>)}
            </select>
          </div>
          <SidebarLink href="/" active={pathname === "/"} tabIndex={sidebarOpen ? 0 : -1}>대시보드</SidebarLink>
          <SidebarLink href={manageHref} active={onDomainOverview || (onNeedDomainPage && menuFrom === "manage")} tabIndex={sidebarOpen ? 0 : -1}>도메인 관리</SidebarLink>
          <SidebarLink href={generationHref} active={onGenerate || (onNeedDomainPage && menuFrom === "generate")} tabIndex={sidebarOpen ? 0 : -1}>글 생성</SidebarLink>
          <SidebarLink href={reviewHref} active={onReview || (onNeedDomainPage && menuFrom === "review")} tabIndex={sidebarOpen ? 0 : -1}>검수·보내기</SidebarLink>
          <SidebarLink href="/jobs" active={pathname === "/jobs"} tabIndex={sidebarOpen ? 0 : -1}>작업 큐</SidebarLink>
          <p style={{ marginTop: 12 }}>자료 관리</p>
          {/* 자료는 도메인이 아니라 업종에 딸린다. 업종이 늘면 여기 업종 선택이 붙는다. */}
          <SidebarLink href="/academies" active={pathname.startsWith("/academies")} tabIndex={sidebarOpen ? 0 : -1}>운전학원 자료</SidebarLink>
          <p style={{ marginTop: 12 }}>설정</p>
          <SidebarLink href="/settings" active={pathname === "/settings"} tabIndex={sidebarOpen ? 0 : -1}>작업환경</SidebarLink>
        </nav>

        <div className="side-note">
          <b>백엔드</b>
          <code>{apiBase}</code>
        </div>
      </aside>
      <main className="main">
        {pendingLinkDomain && (
          <div className="action-hint" style={{ marginBottom: 16 }}>
            <span>
              <span>선택된 운영 대상에 원천 자료가 아직 반영되지 않았습니다. 조사값 승인·지역 사전 갱신·지역 목록 동기화는 「학원자료 연결」을 눌러야 그 도메인 글에 반영됩니다.</span>
              <span style={{ fontWeight: 400 }}>{` (${pendingLinkDomain.display_name || pendingLinkDomain.domain})`}</span>
            </span>
            <Link className="btn primary" href={`/t/${encodeURIComponent(pendingLinkDomain.domain)}?tab=academies`}>연결하러 가기</Link>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

function SidebarLink({ href, active, tabIndex, children }: { href: string; active: boolean; tabIndex: 0 | -1; children: React.ReactNode }) {
  return <Link href={href} tabIndex={tabIndex} className={active ? "active" : ""}>{children}</Link>;
}
