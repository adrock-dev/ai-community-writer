"use client";

import { api, getOptions, listDomains } from "@/lib/api";
import { formatDateTime } from "@/lib/date";
import { getDesignTheme } from "@/lib/design-theme";
import { notifyDomainsChanged } from "@/lib/domain-events";
import { getRecentDomain } from "@/lib/recent-domain";
import { domainTourHref, type TourFocus, type TourMode } from "@/lib/tour";
import type { AdminOptions, DomainConfig, Job } from "@/lib/types";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

const DEFAULT_BRAND_COLOR = "#2563eb";

export default function DashboardClient() {
  const [domains, setDomains] = useState<DomainConfig[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [options, setOptions] = useState<AdminOptions | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [brandColor, setBrandColor] = useState(DEFAULT_BRAND_COLOR);
  // 마지막 접속 도메인은 localStorage 라서 마운트 후에 읽는다(SSR 하이드레이션 불일치 방지).
  const [recentDomain, setRecentDomain] = useState<string | null>(null);
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

  useEffect(() => { setRecentDomain(getRecentDomain()); }, []);

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
    try {
      await api("/domains", {
        method: "POST",
        body: JSON.stringify({
          domain: String(fd.get("domain") || "").trim(),
          display_name: String(fd.get("display_name") || "").trim(),
          vertical: String(fd.get("vertical") || "").trim(),
          theme: String(fd.get("theme") || "clean"),
          brand_color: String(fd.get("brand_color") || "#2563eb"),
          daily_limit: Number(fd.get("daily_limit") || 0),
          apply_preset: fd.get("apply_preset") === "on",
        }),
      });
      form.reset();
      setBrandColor(DEFAULT_BRAND_COLOR);
      setOpen(false);
      await refresh();
      notifyDomainsChanged(); // 사이드바(AppShell) 도메인 드롭다운 즉시 갱신
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  }

  const defaultDomain = pickDefaultDomain(domains, recentDomain);

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
          <div className="grid grid-3">
            <Field label="테마"><select className="select" name="theme">{options?.themes.map((v) => <option key={v}>{v}</option>)}</select></Field>
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
        <Stat label="전체 슬롯" value={domains.reduce((a, t) => a + (t.slot_count ?? 0), 0)} />
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
          <DashboardFlowStarter domain={defaultDomain} domainCount={domains.length} />
          <section id="dashboard-domains">
            <div className="spread" style={{ marginBottom: 10 }}>
              <div>
                <h2>도메인별 시작</h2>
                <p className="muted small">도메인을 고른 뒤 같은 방식으로 기본/고급/검수 흐름을 바로 시작합니다.</p>
              </div>
            </div>
            <div className="grid grid-3">
              {domains.map((t) => (
                <article className="card card-pad domain-card" key={t.domain}>
                  <div className="spread"><h3>{t.display_name}</h3><span className="badge">{t.vertical}</span></div>
                  <p className="muted mono small">{t.domain}</p>
                  <RecommendedDomainAction domain={t} />
                  <div className="grid grid-3" style={{ gap: 8, marginTop: 16 }}>
                    <Mini label="슬롯" value={t.slot_count ?? 0} />
                    <Mini label="대기" value={t.planned_count ?? 0} />
                    <Mini label="발행" value={t.published_count ?? 0} />
                  </div>
                  <div className="domain-actions">
                    <Link className="btn" href={domainHref(t.domain)}>열기</Link>
                    <Link className="btn primary" href={domainHref(t.domain, "basic")}>기본 생성</Link>
                    <Link className="btn" href={domainHref(t.domain, "advanced")}>고급 슬롯</Link>
                    <Link className="btn" href={domainHref(t.domain, "review")}>검수</Link>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}

      <section style={{ marginTop: 28 }}>
        <div className="spread" style={{ marginBottom: 10 }}><h2>최근 작업</h2><Link className="btn" href="/jobs">전체 보기</Link></div>
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

const DASHBOARD_STEP_GROUPS: Array<{ title: string; desc: string; steps: Array<{ flow: TourMode; focus: TourFocus; no: string; title: string; desc: string; tone?: "primary" }> }> = [
  {
    title: "기본 글 생성",
    desc: "처음 쓰는 운영자가 가장 적게 눌러도 되는 순서",
    steps: [
      { flow: "basic", focus: "workflow", no: "기본 1", title: "흐름 개요", desc: "기본 흐름 한눈에", tone: "primary" },
      { flow: "basic", focus: "source", no: "기본 2", title: "원천 데이터 준비", desc: "지역/학원 동기화" },
      { flow: "basic", focus: "slot-create", no: "기본 3", title: "글 후보 만들기", desc: "슬롯 후보 생성" },
      { flow: "basic", focus: "test-write", no: "기본 4", title: "1개 테스트 작성", desc: "대량 전 안전 확인" },
    ],
  },
  {
    title: "고급 슬롯 생성",
    desc: "정교하게 후보를 설계하고 확장할 때",
    steps: [
      { flow: "advanced", focus: "workflow", no: "고급 1", title: "흐름 개요", desc: "고급 흐름 한눈에", tone: "primary" },
      { flow: "advanced", focus: "plan", no: "고급 2", title: "기획/제외어", desc: "방향과 금지어" },
      { flow: "advanced", focus: "template-design", no: "고급 3", title: "유형/디자인", desc: "글 구조 선택" },
      { flow: "advanced", focus: "academy-types", no: "고급 4", title: "학원 타입 제한", desc: "원천 타입 정책" },
      { flow: "advanced", focus: "slot-filter", no: "고급 5", title: "슬롯 필터", desc: "후보 조건 좁히기" },
    ],
  },
  {
    title: "검수/마감",
    desc: "생성 이후 확인과 내보내기",
    steps: [
      { flow: "review", focus: "workflow", no: "검수 1", title: "흐름 개요", desc: "검수 흐름 한눈에", tone: "primary" },
      { flow: "review", focus: "jobs", no: "검수 2", title: "작업 상태", desc: "큐/실패 확인" },
      { flow: "review", focus: "posts", no: "검수 3", title: "완성 글 검수", desc: "export/indexing" },
    ],
  },
];

function pickDefaultDomain(domains: DomainConfig[], recentDomain?: string | null) {
  // 마지막 접속 도메인이 아직 목록에 있으면 최우선. 이력이 없을 때만 상태 휴리스틱으로 폴백.
  return (recentDomain ? domains.find((d) => d.domain === recentDomain) : undefined)
    ?? domains.find((d) => (d.planned_count ?? 0) > 0)
    ?? domains.find((d) => (d.slot_count ?? 0) === 0)
    ?? domains.find((d) => (d.published_count ?? 0) > 0)
    ?? domains[0];
}

function DashboardFlowStarter({ domain, domainCount }: { domain: DomainConfig; domainCount: number }) {
  return <section className="flow-start" aria-labelledby="dashboard-flow-start">
    <div>
      <p className="eyebrow">운영 시작</p>
      <h2 id="dashboard-flow-start">대시보드에서 바로 글 생성 흐름을 선택하세요</h2>
      <div className="dashboard-flow-domain">
        <span className="badge info">대상 도메인</span>
        <b>{domain.display_name}</b>
        <span className="muted mono small">{domain.domain}</span>
        {domainCount > 1 && <span className="muted small">· 아래 「도메인별 시작」에서 다른 도메인을 고를 수 있습니다</span>}
      </div>
      <p className="muted">상태(대기 슬롯·후보 유무)를 보고 자동으로 골랐습니다. 흐름 버튼은 모두 이 도메인으로 연결됩니다.</p>
      <RecommendedDomainAction domain={domain} large />
    </div>
    <div className="grid grid-3">
      <DashboardFlowCard
        href={domainHref(domain.domain, "basic")}
        title="기본 글 생성"
        badge="추천"
        body="원천 데이터 → 1단계 후보 만들기 → 2단계 테스트 작성 → 검수 순서로 안내합니다."
        cta="기본 흐름 시작"
        tone="primary"
      />
      <DashboardFlowCard
        href={domainHref(domain.domain, "advanced")}
        title="고급 슬롯 생성"
        badge="운영자용"
        body="기획, 글유형, 디자인, 학원 타입, 슬롯 필터를 만지며 대량 후보를 정교하게 만드는 흐름입니다."
        cta="고급 흐름 시작"
      />
      <DashboardFlowCard
        href={domainHref(domain.domain, "review")}
        title="검수/내보내기"
        badge="마감"
        body="작업 큐와 완성 글만 빠르게 확인해 export, 색인 요청, 중복 점검으로 마무리합니다."
        cta="검수 흐름 시작"
      />
    </div>
    <DashboardStepLauncher domain={domain.domain} />
  </section>;
}

function DashboardFlowCard({ href, title, badge, body, cta, tone }: { href: string; title: string; badge: string; body: string; cta: string; tone?: "primary" }) {
  return <Link href={href} className={`flow-card ${tone === "primary" ? "primary" : ""}`}>
    <div className="spread"><h3>{title}</h3><span className={`badge ${tone === "primary" ? "success" : "info"}`}>{badge}</span></div>
    <p className="muted">{body}</p>
    <span className={`btn ${tone === "primary" ? "primary" : ""}`}>{cta}</span>
  </Link>;
}

function DashboardStepLauncher({ domain }: { domain: string }) {
  return <div className="step-launch-panel">
    <div className="spread">
      <div>
        <p className="eyebrow">세부 단계 바로 시작</p>
        <h3>처음부터가 아니라 필요한 단계에서 바로 시작</h3>
      </div>
      <span className="badge info">12단계</span>
    </div>
    <div className="step-launch-groups">
      {DASHBOARD_STEP_GROUPS.map((group) => <section className="step-launch-group" key={group.title}>
        <div><b>{group.title}</b><p className="muted small">{group.desc}</p></div>
        <div className="step-launch-grid">
          {group.steps.map((step) => <Link key={`${step.flow}-${step.focus}`} className={`step-launch ${step.tone === "primary" ? "primary" : ""}`} href={domainHref(domain, step.flow, step.focus)}>
            <span className="step-no">{step.no}</span>
            <b>{step.title}</b>
            <small>{step.desc}</small>
          </Link>)}
        </div>
      </section>)}
    </div>
  </div>;
}

function RecommendedDomainAction({ domain, large }: { domain: DomainConfig; large?: boolean }) {
  const action = getRecommendedDomainAction(domain);
  return <div className={`next-action ${large ? "large" : ""}`}>
    <div>
      <span className="badge success">추천 다음 작업</span>
      <b>{action.title}</b>
      <p className="muted small">{action.desc}</p>
    </div>
    <Link className="btn primary" href={domainHref(domain.domain, action.flow, action.focus)}>{action.cta}</Link>
  </div>;
}

function getRecommendedDomainAction(domain: DomainConfig): { title: string; desc: string; cta: string; flow: TourMode; focus: TourFocus } {
  if ((domain.slot_count ?? 0) === 0) return { title: "기본 흐름 개요부터", desc: "새 도메인입니다. 기본 생성 흐름을 개요로 훑어본 뒤 원천 데이터 준비로 이어가세요.", cta: "기본 1 시작", flow: "basic", focus: "workflow" };
  if ((domain.planned_count ?? 0) > 0) return { title: "1개 테스트 작성", desc: `${(domain.planned_count ?? 0).toLocaleString()}개 대기 후보 중 하나만 먼저 작성해 품질을 확인하세요.`, cta: "기본 4 시작", flow: "basic", focus: "test-write" };
  if ((domain.published_count ?? 0) > 0) return { title: "완성 글 검수", desc: `${(domain.published_count ?? 0).toLocaleString()}개 발행 글을 미리보기/export/indexing으로 마감하세요.`, cta: "검수 3 시작", flow: "review", focus: "posts" };
  return { title: "글 후보 만들기", desc: "운영을 시작할 후보를 먼저 만들어야 합니다.", cta: "기본 3 시작", flow: "basic", focus: "slot-create" };
}

function domainHref(domain: string, flow?: TourMode, focus?: TourFocus) {
  const base = `/t/${encodeURIComponent(domain)}`;
  if (!flow) return base;
  return domainTourHref(domain, flow, focus);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label><span className="label">{label}</span>{children}</label>; }
function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) { return <div className="card stat"><div className="muted small">{label}</div><div className="num" style={{ color: accent ? "var(--success)" : undefined }}>{value.toLocaleString()}</div></div>; }
function Mini({ label, value }: { label: string; value: number }) { return <div style={{ textAlign: "center", background: "#f8fafc", borderRadius: 12, padding: 10 }}><b>{value.toLocaleString()}</b><div className="muted small">{label}</div></div>; }
function Status({ status }: { status: string }) { const cls = status === "done" ? "success" : status === "failed" ? "danger" : status === "running" ? "info" : ""; return <span className={`badge ${cls}`}>{status}</span>; }
