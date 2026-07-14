"use client";

import { api, getOptions, listDomains } from "@/lib/api";
import { formatDateTime } from "@/lib/date";
import { getDesignTheme } from "@/lib/design-theme";
import { notifyDomainsChanged } from "@/lib/domain-events";
import { getRecentDomains, rememberDomain } from "@/lib/recent-domain";
import { domainTourHref } from "@/lib/tour";
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

      <div className="card card-pad" style={{ background: "#eff6ff", border: "1px solid #bfdbfe", padding: "12px 16px", marginBottom: 18 }}>
        <p className="small" style={{ margin: 0, color: "#1e3a8a" }}>ℹ️ <b>현재 범위</b> — 이 관리자는 <b>운전면허·운전학원 글 생성에 특화</b>되어 구현돼 있습니다. 프리셋·글유형·품질 규칙이 <code>driving</code> 기준이며, 다른 업종은 추가할 수 있으나 전용 프리셋·품질은 아직 적용되지 않습니다.</p>
      </div>

      {error && <p className="toast-error">{error}</p>}

      {open && (
        <form onSubmit={createDomain} className="card card-pad grid" style={{ maxWidth: 720, marginBottom: 20 }}>
          <div className="grid grid-2">
            <Field label="도메인"><input className="input" name="domain" placeholder="drive.example.com" required pattern="[a-z0-9.\-]+" /></Field>
            <Field label="표시 이름"><input className="input" name="display_name" placeholder="강남 운전면허센터" required /></Field>
          </div>
          <Field label="업종"><select className="select" name="vertical" defaultValue="driving">{options?.verticals.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}</select></Field>
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
                      <span className="badge">{options?.verticals.find((v) => v.key === t.vertical)?.label ?? t.vertical}</span>
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

// href 는 개요 라우트 + ?flow= 로 만든다(domainTourHref): 튜토리얼 ON 이면 진입 시 해당 흐름 오버레이가
// 열리고, OFF 면 그 흐름의 첫 실작업 탭으로 조용히 이동한다. (/generate·/posts 는 focusedPage 라 탭 앵커가
// 없어 튜토리얼이 깨지므로 개요 라우트로 보낸다.)
function getRecommendedDomainAction(domain: DomainConfig): { title: string; desc: string; cta: string; href: string } {
  if ((domain.templates_enabled?.length ?? 0) === 0) return { title: "글 생성 준비 시작", desc: "새 도메인입니다. 원천 데이터·공통 설정(선택)을 준비하고 글 유형을 켜면 후보를 만들 수 있어요.", cta: "글 생성 흐름 시작", href: domainTourHref(domain.domain, "basic") };
  if ((domain.slot_count ?? 0) === 0) return { title: "원천 데이터 준비", desc: "글 유형은 켜져 있습니다. 지역/학원 데이터를 동기화한 뒤 후보를 만드세요.", cta: "원천 데이터", href: domainTourHref(domain.domain, "basic", "source") };
  if ((domain.planned_count ?? 0) > 0) return { title: "글 생성 이어가기", desc: `${(domain.planned_count ?? 0).toLocaleString()}개 대기 후보 중 하나만 먼저 작성해 품질을 확인하세요.`, cta: "테스트 작성", href: domainTourHref(domain.domain, "basic", "test-write") };
  if ((domain.published_count ?? 0) > 0) return { title: "완성 글 검수", desc: `${(domain.published_count ?? 0).toLocaleString()}개 발행 글을 미리보기/export/indexing으로 마감하세요.`, cta: "검수", href: domainTourHref(domain.domain, "review", "posts") };
  return { title: "글 후보 만들기", desc: "운영을 시작할 후보를 먼저 만들어야 합니다.", cta: "후보 만들기", href: domainTourHref(domain.domain, "basic", "slot-create") };
}

function domainHref(domain: string) {
  return `/t/${encodeURIComponent(domain)}`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label><span className="label">{label}</span>{children}</label>; }
function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) { return <div className="card stat"><div className="muted small">{label}</div><div className="num" style={{ color: accent ? "var(--success)" : undefined }}>{value.toLocaleString()}</div></div>; }
function Mini({ label, value }: { label: string; value: number }) { return <div style={{ textAlign: "center", background: "#f8fafc", borderRadius: 12, padding: 10 }}><b>{value.toLocaleString()}</b><div className="muted small">{label}</div></div>; }
function Status({ status }: { status: string }) { const cls = status === "done" ? "success" : status === "failed" ? "danger" : status === "running" ? "info" : ""; return <span className={`badge ${cls}`}>{status}</span>; }
