"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { listDomains } from "@/lib/api";
import { isDomainMenuFrom, needDomainHref } from "@/lib/domain-gate";
import { pickDefaultDomain } from "@/lib/domains";

const SIDEBAR_STORAGE_KEY = "adrock.sidebar.open";

export default function AppShell({ children, apiBase }: { children: React.ReactNode; apiBase: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const menuFrom = isDomainMenuFrom(searchParams.get("from")) ? searchParams.get("from") : null;
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [domains, setDomains] = useState<Awaited<ReturnType<typeof listDomains>>["items"]>([]);
  const [domainsReady, setDomainsReady] = useState(false);
  const [domainsError, setDomainsError] = useState("");

  useEffect(() => {
    const saved = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (saved !== null) setSidebarOpen(saved === "true");
  }, []);

  useEffect(() => {
    let mounted = true;
    setDomainsReady(false);
    setDomainsError("");
    listDomains()
      .then((res) => {
        if (!mounted) return;
        setDomains(res.items);
        setDomainsReady(true);
      })
      .catch((err) => {
        if (!mounted) return;
        setDomains([]);
        setDomainsError((err as Error).message || "도메인 목록을 불러오지 못했습니다.");
        setDomainsReady(true);
      });
    return () => { mounted = false; };
  }, []);

  function toggleSidebar() {
    setSidebarOpen((current) => {
      const next = !current;
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      return next;
    });
  }

  const defaultDomain = useMemo(() => pickDefaultDomain(domains), [domains]);
  const hasDomain = Boolean(defaultDomain);
  const domainBase = defaultDomain ? `/t/${encodeURIComponent(defaultDomain.domain)}` : "";
  const manageHref = hasDomain ? domainBase : needDomainHref("manage");
  const generationHref = hasDomain ? `${domainBase}/generate` : needDomainHref("generate");
  const reviewHref = hasDomain ? `${domainBase}/posts` : needDomainHref("review");
  const onNeedDomainPage = pathname === "/need-domain";

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
          <p>메뉴</p>
          <SidebarLink href="/" active={pathname === "/"} tabIndex={sidebarOpen ? 0 : -1}>대시보드</SidebarLink>
          <SidebarLink href={manageHref} active={(pathname.startsWith("/t/") && !pathname.includes("/generate") && !pathname.includes("/posts") && !pathname.includes("/post/")) || (onNeedDomainPage && menuFrom === "manage")} tabIndex={sidebarOpen ? 0 : -1}>도메인 관리</SidebarLink>
          <SidebarLink href={generationHref} active={pathname.includes("/generate") || (onNeedDomainPage && menuFrom === "generate")} tabIndex={sidebarOpen ? 0 : -1}>글 생성</SidebarLink>
          <SidebarLink href={reviewHref} active={pathname.includes("/posts") || pathname.includes("/post/") || (onNeedDomainPage && menuFrom === "review")} tabIndex={sidebarOpen ? 0 : -1}>검수·보내기</SidebarLink>
          <SidebarLink href="/jobs" active={pathname === "/jobs"} tabIndex={sidebarOpen ? 0 : -1}>작업 큐</SidebarLink>
        </nav>

        {domainsReady && !hasDomain && (
          <div className="side-alert" role="status">
            <b>{domainsError ? "API 연결 필요" : "도메인이 필요합니다"}</b>
            <p className="small">
              {domainsError
                ? `백엔드(${apiBase})에 연결한 뒤 대시보드에서 도메인을 만드세요.`
                : "글 생성·검수 메뉴는 운영 도메인을 만든 뒤 사용할 수 있습니다."}
            </p>
            <Link className="btn primary" href={needDomainHref("manage")} tabIndex={sidebarOpen ? 0 : -1}>시작 안내 보기</Link>
          </div>
        )}

        <div className="side-note">
          <b>백엔드</b>
          <code>{apiBase}</code>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

function SidebarLink({ href, active, tabIndex, children }: { href: string; active: boolean; tabIndex: 0 | -1; children: React.ReactNode }) {
  return <Link href={href} tabIndex={tabIndex} className={active ? "active" : ""}>{children}</Link>;
}
