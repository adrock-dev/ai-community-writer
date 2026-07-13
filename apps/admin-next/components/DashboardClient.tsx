"use client";

import { api, getOptions, listDomains } from "@/lib/api";
import { formatDateTime } from "@/lib/date";
import { getDesignTheme } from "@/lib/design-theme";
import { notifyDomainsChanged } from "@/lib/domain-events";
import { getRecentDomains, rememberDomain } from "@/lib/recent-domain";
import type { AdminOptions, DomainConfig, Job } from "@/lib/types";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

const DEFAULT_BRAND_COLOR = "#2563eb";

export default function DashboardClient() {
  const [domains, setDomains] = useState<DomainConfig[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [options, setOptions] = useState<AdminOptions | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [brandColor, setBrandColor] = useState(DEFAULT_BRAND_COLOR);
  const [recentDomains, setRecentDomains] = useState<string[]>([]);
  const previewTheme = getDesignTheme("local-guide", brandColor);

  async function refresh() {
    const [opts, domainRes, jobRes] = await Promise.all([
      getOptions(),
      listDomains(),
      api<{ count: number; items: Job[] }>("/jobs?limit=8"),
    ]);
    setOptions(opts);
    setDomains(domainRes.items);
    setJobs(jobRes.items);
  }

  useEffect(() => { refresh().catch((e) => setError(e.message)); }, []);
  useEffect(() => { setRecentDomains(getRecentDomains()); }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("create") !== "domain") return;
    setOpen(true);
    params.delete("create");
    const query = params.toString();
    window.history.replaceState(null, "", `/${query ? `?${query}` : ""}`);
  }, []);

  async function createDomain(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true); setError("");
    const fd = new FormData(form);
    const newDomain = String(fd.get("domain") || "").trim();
    try {
      await api("/domains", {
        method: "POST",
        body: JSON.stringify({
          domain: newDomain,
          display_name: String(fd.get("display_name") || "").trim(),
          vertical: String(fd.get("vertical") || "").trim(),
          brand_color: String(fd.get("brand_color") || "#2563eb"),
          daily_limit: Number(fd.get("daily_limit") || 0),
          apply_preset: fd.get("apply_preset") === "on",
        }),
      });
      form.reset();
      setBrandColor(DEFAULT_BRAND_COLOR);
      setOpen(false);
      // 방금 만든 도메인을 "최근 접근"으로 기록해 도메인 현황 목록 맨 위에 오게 한다.
      rememberDomain(newDomain);
      setRecentDomains(getRecentDomains());
      await refresh();
      notifyDomainsChanged(); // 사이드바(AppShell) 도메인 드롭다운 즉시 갱신
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  }

  const sortedDomains = useMemo(() => {
    const rank = new Map(recentDomains.map((domain, index) => [domain, index]));
    return [...domains].sort((a, b) => {
      const ar = rank.get(a.domain) ?? Number.MAX_SAFE_INTEGER;
      const br = rank.get(b.domain) ?? Number.MAX_SAFE_INTEGER;
      return ar === br ? 0 : ar - br;
    });
  }, [domains, recentDomains]);
  const latestDomain = recentDomains.find((domain) => domains.some((item) => item.domain === domain)) ?? null;

  return (
    <div>
      <div className="page-head">
        <div>
          <p className="eyebrow">Adrock 사내 운영</p>
          <h1>대시보드</h1>
          <p className="muted">운전면허·운전학원 도메인의 콘텐츠 생성·발행 작업을 운영하는 내부 관리자 화면입니다.</p>
        </div>
        <button className="btn primary" onClick={() => setOpen((v) => !v)}>+ 새 도메인</button>
      </div>

      {error && <p className="toast-error">{error}</p>}

      {open && (
        <form onSubmit={createDomain} className="card card-pad grid" style={{ maxWidth: 720, marginBottom: 20 }}>
          <div className="grid grid-2">
            <Field label="도메인"><input className="input" name="domain" placeholder="drive.example.com" required pattern="[a-z0-9.\-]+" /></Field>
            <Field label="표시 이름"><input className="input" name="display_name" placeholder="강남 운전면허센터" required /></Field>
          </div>
          <Field label="업종"><select className="select" name="vertical" defaultValue="driving">{options?.verticals.map((v) => <option key={v} value={v}>{v === "driving" ? "운전면허/운전학원" : v}</option>)}</select></Field>
          <div className="grid grid-2">
            <Field label="브랜드 컬러">
              <div className="row">
                <input className="input-color" name="brand_color" type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} />
                <code className="mono small">{brandColor}</code>
              </div>
            </Field>
            <Field label="일일 한도 (0=무제한)"><input className="input" name="daily_limit" type="number" defaultValue={0} min={0} max={500} /></Field>
          </div>
          <label className="row small"><input type="checkbox" name="apply_preset" defaultChecked /> 운전학원 지역/키워드 프리셋 자동 적용</label>
          <div className="brand-color-preview" style={{ ["--accent" as string]: previewTheme.accent, ["--accent-soft" as string]: previewTheme.soft, ["--primary" as string]: previewTheme.accent }}>
            <div className="preview-top"><b>브랜드 컬러 미리보기</b><span className="preview-cta">CTA</span></div>
            <div className="preview-bottom-cta"><b>발행 글 상단/버튼에 적용됩니다</b><button type="button" className="btn primary">버튼</button></div>
          </div>
          <div className="row"><button className="btn primary" disabled={busy}>{busy ? "생성 중..." : "생성"}</button><button type="button" className="btn" onClick={() => { setOpen(false); setBrandColor(DEFAULT_BRAND_COLOR); }}>닫기</button></div>
        </form>
      )}

      <div className="grid grid-3" style={{ marginBottom: 22 }}>
        <Stat label="도메인" value={domains.length} />
        <Stat label="전체 후보" value={domains.reduce((a, t) => a + (t.slot_count ?? 0), 0)} />
        <Stat label="발행 글" value={domains.reduce((a, t) => a + (t.published_count ?? 0), 0)} accent />
      </div>

      {domains.length === 0 ? (
        <div id="dashboard-domain-setup" className="card card-pad" style={{ textAlign: "center", padding: 52 }}>
          <h2>아직 도메인이 없습니다</h2>
          <p className="muted">운전 도메인을 만들면 지역/키워드 프리셋이 자동으로 들어갑니다. 도메인이 있어야 도메인 관리, 글 생성, 검수·보내기 메뉴를 사용할 수 있습니다.</p>
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => setOpen(true)}>첫 도메인 만들기</button>
        </div>
      ) : (
        <div className="grid">
          <section id="dashboard-domains">
            <div className="spread" style={{ marginBottom: 10 }}>
              <div>
                <h2>도메인 현황</h2>
                <p className="muted small">전체 도메인의 후보·대기·발행 상태를 보고 필요한 화면으로 이동합니다.</p>
              </div>
            </div>
            <div className="grid grid-3">
              {sortedDomains.map((t) => (
                <article className="card card-pad domain-card" key={t.domain}>
                  <div className="domain-card-head">
                    <h3>{t.display_name}</h3>
                    <div className="domain-card-badges">
                      {t.domain === latestDomain && <span className="badge info">최근 접근</span>}
                      <span className="badge">{t.vertical}</span>
                    </div>
                  </div>
                  <p className="muted mono small">{t.domain}</p>
                  <RecommendedDomainAction domain={t} />
                  <div className="grid grid-3" style={{ gap: 8, marginTop: 16 }}>
                    <Mini label="후보" value={t.slot_count ?? 0} />
                    <Mini label="대기" value={t.planned_count ?? 0} />
                    <Mini label="발행" value={t.published_count ?? 0} />
                  </div>
                  <div className="domain-actions">
                    <Link className="btn" href={domainHref(t.domain)}>열기</Link>
                    <Link className="btn primary" href={`${domainHref(t.domain)}/generate`}>글 생성</Link>
                    <Link className="btn" href={`${domainHref(t.domain)}/posts`}>검수</Link>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}

      <section style={{ marginTop: 28 }}>
        <div className="spread" style={{ marginBottom: 10 }}><h2>최근 작업 큐</h2><Link className="btn" href="/jobs">전체 보기</Link></div>
        <div className="table-wrap">
          <table><thead><tr><th>도메인</th><th>종류</th><th>상태</th><th>예약</th><th>완료</th></tr></thead><tbody>
            {jobs.length === 0 && <tr><td colSpan={5} className="muted">작업 없음</td></tr>}
            {jobs.map((j) => <tr key={j.id}><td className="mono small">{j.domain ?? ""}</td><td>{j.kind}</td><td><Status status={j.status} /></td><td className="small muted">{formatDateTime(j.scheduled_at)}</td><td className="small muted">{formatDateTime(j.finished_at)}</td></tr>)}
          </tbody></table>
        </div>
      </section>
    </div>
  );
}

function RecommendedDomainAction({ domain, large }: { domain: DomainConfig; large?: boolean }) {
  const action = getRecommendedDomainAction(domain);
  return <div className={`next-action ${large ? "large" : ""}`}>
    <div>
      <span className="badge success">추천 다음 작업</span>
      <b>{action.title}</b>
      <p className="muted small">{action.desc}</p>
    </div>
    <Link className="btn success" href={action.href}>{action.cta}</Link>
  </div>;
}

function getRecommendedDomainAction(domain: DomainConfig): { title: string; desc: string; cta: string; href: string } {
  if ((domain.slot_count ?? 0) === 0) return { title: "도메인 개요 확인", desc: "새 도메인입니다. 도메인 관리 개요에서 기본 생성 흐름을 확인하세요.", cta: "개요 열기", href: domainHref(domain.domain) };
  if ((domain.planned_count ?? 0) > 0) return { title: "글 생성 이어가기", desc: `${(domain.planned_count ?? 0).toLocaleString()}개 대기 후보 중 하나만 먼저 작성해 품질을 확인하세요.`, cta: "글 생성", href: `${domainHref(domain.domain)}/generate` };
  if ((domain.published_count ?? 0) > 0) return { title: "완성 글 검수", desc: `${(domain.published_count ?? 0).toLocaleString()}개 발행 글을 미리보기/export/indexing으로 마감하세요.`, cta: "검수", href: `${domainHref(domain.domain)}/posts` };
  return { title: "글 후보 만들기", desc: "운영을 시작할 후보를 먼저 만들어야 합니다.", cta: "글 생성", href: `${domainHref(domain.domain)}/generate` };
}

function domainHref(domain: string) {
  return `/t/${encodeURIComponent(domain)}`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label><span className="label">{label}</span>{children}</label>; }
function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) { return <div className="card stat"><div className="muted small">{label}</div><div className="num" style={{ color: accent ? "var(--success)" : undefined }}>{value.toLocaleString()}</div></div>; }
function Mini({ label, value }: { label: string; value: number }) { return <div style={{ textAlign: "center", background: "#f8fafc", borderRadius: 12, padding: 10 }}><b>{value.toLocaleString()}</b><div className="muted small">{label}</div></div>; }
function Status({ status }: { status: string }) { const cls = status === "done" ? "success" : status === "failed" ? "danger" : status === "running" ? "info" : ""; return <span className={`badge ${cls}`}>{status}</span>; }
