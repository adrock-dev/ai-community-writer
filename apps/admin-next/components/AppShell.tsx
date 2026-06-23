"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { listDomains } from "@/lib/api";
import type { DomainConfig } from "@/lib/types";

const SIDEBAR_STORAGE_KEY = "adrock.sidebar.open";

export default function AppShell({ children, apiBase }: { children: React.ReactNode; apiBase: string }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [domains, setDomains] = useState<DomainConfig[]>([]);

  useEffect(() => {
    const saved = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (saved !== null) setSidebarOpen(saved === "true");
  }, []);

  useEffect(() => {
    let mounted = true;
    listDomains()
      .then((res) => { if (mounted) setDomains(res.items); })
      .catch(() => undefined);
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
  const generationHref = defaultDomain ? domainHref(defaultDomain.domain, "basic") : "/#dashboard-domains";
  const reviewHref = defaultDomain ? domainHref(defaultDomain.domain, "review") : "/#dashboard-domains";

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
          <SidebarLink href="/#dashboard-domains" active={false} tabIndex={sidebarOpen ? 0 : -1}>도메인 관리</SidebarLink>
          <SidebarLink href={generationHref} active={pathname.startsWith("/t/")} tabIndex={sidebarOpen ? 0 : -1}>글 생성</SidebarLink>
          <SidebarLink href={reviewHref} active={false} tabIndex={sidebarOpen ? 0 : -1}>검수·내보내기</SidebarLink>
          <SidebarLink href="/jobs" active={pathname === "/jobs"} tabIndex={sidebarOpen ? 0 : -1}>작업 큐</SidebarLink>
        </nav>

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

function pickDefaultDomain(domains: DomainConfig[]) {
  return domains.find((domain) => (domain.planned_count ?? 0) > 0)
    ?? domains.find((domain) => (domain.slot_count ?? 0) === 0)
    ?? domains.find((domain) => (domain.published_count ?? 0) > 0)
    ?? domains[0];
}

function domainHref(domain: string, flow: "basic" | "review") {
  const params = new URLSearchParams({ flow });
  return `/t/${encodeURIComponent(domain)}?${params.toString()}`;
}
