"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AcademyBaseRow, type ResearchProvider, type ResearchRun,
  cancelResearchRun, listAcademyResearch, listResearchRuns, researchRegion, syncRegion,
} from "@/lib/academy-research";
import { formatDateTime, formatShortDate } from "@/lib/date";

export default function AcademyResearchClient() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<AcademyBaseRow[]>([]);
  const [runs, setRuns] = useState<ResearchRun[]>([]);
  const [researchProvider, setResearchProvider] = useState<ResearchProvider>("auto");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 진행 중이던 실행이 끝나는 순간을 잡아 결과를 알려주기 위한 직전 상태.
  const watchedRunRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await listAcademyResearch(undefined, q.trim() || undefined);
      setItems(res.items);
    } catch (e: any) {
      setError(e?.message || "목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [q]);

  const loadRuns = useCallback(async () => {
    try {
      const res = await listResearchRuns();
      setRuns(res.items);
    } catch { /* 무시 */ }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadRuns(); }, [loadRuns]);

  // 진행 중인 실행이 있으면 폴링.
  useEffect(() => {
    const running = runs.some((r) => r.status === "running");
    if (running && !pollRef.current) {
      pollRef.current = setInterval(() => { loadRuns(); load(); }, 5000);
    } else if (!running && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => { if (pollRef.current && !running) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [runs, loadRuns, load]);

  // 지켜보던 실행이 끝나면 결과를 알린다. 요청이 결과를 들고 오지 않으므로(백그라운드)
  // 완료 통보는 run 행에서만 온다 — 새로고침하거나 창을 닫았다 와도 동일하게 보인다.
  useEffect(() => {
    const watched = watchedRunRef.current;
    if (!watched) return;
    const run = runs.find((r) => r.id === watched);
    if (!run || run.status === "running") return;
    watchedRunRef.current = null;
    if (run.status === "error") setError(`${runLabel(run)} 실패 — ${run.error || "원인 미상"}`);
    else if (run.status === "cancelled") setNotice(`${runLabel(run)} 중단됨 — ${runSummary(run)}까지 저장했습니다.`);
    else setNotice(`${runLabel(run)} 완료 — ${runSummary(run)}`);
    load();
  }, [runs, load]);

  async function onSync() {
    if (!confirm("DrivingPlus 전체 학원정보를 동기화합니다. 기존 원본 정보와 리뷰 원문이 갱신됩니다. 진행할까요?")) return;
    setBusy("sync");
    setError("");
    setNotice("");
    try {
      const res = await syncRegion();
      if (!res.ok) throw new Error(res.error || "시작 실패");
      if (res.run_id) watchedRunRef.current = res.run_id;
      setNotice("동기화를 백그라운드에서 시작했습니다. 창을 닫아도 계속 진행됩니다.");
      await loadRuns();
    } catch (e: any) {
      setError(e?.message || "동기화 시작 실패");
    } finally {
      setBusy("");
    }
  }

  async function onResearchAll() {
    if (!confirm(`동기화된 전체 학원을 ${researchProvider}로 심층조사합니다(백그라운드). 진행할까요?`)) return;
    setBusy("research");
    setError("");
    setNotice("");
    try {
      const res = await researchRegion(researchProvider);
      if (!res.ok) throw new Error(res.error || "시작 실패");
      if (res.run_id) watchedRunRef.current = res.run_id;
      setNotice(`전체 조사 시작 — 대상 ${res.count}곳. 창을 닫아도 계속 진행됩니다.`);
      await loadRuns();
    } catch (e: any) {
      setError(e?.message || "조사 시작 실패");
    } finally {
      setBusy("");
    }
  }

  async function onCancel(run: ResearchRun) {
    if (!confirm(`${runLabel(run)}을(를) 중단할까요? 처리 중이던 학원 1곳은 마친 뒤 멈춥니다. 여기까지 저장된 내용은 남습니다.`)) return;
    setError("");
    try {
      await cancelResearchRun(run.id);
      setNotice("중단을 요청했습니다. 곧 멈춥니다.");
      await loadRuns();
    } catch (e: any) {
      setError(e?.message || "중단 요청 실패");
    }
  }

  const activeSyncRun = runs.find((r) => r.status === "running" && r.scope === "sync");
  const activeResearchRun = runs.find((r) => r.status === "running" && r.scope !== "sync");
  // 끝난 동기화 중 가장 최근 것 — 진행 중이 아닐 때도 "언제 받아온 자료인지" 알 수 있어야 한다.
  const lastSyncRun = runs.find((r) => r.scope === "sync" && r.status !== "running");

  return (
    <div className="card-pad">
      <div className="page-head">
        <div>
          <p className="eyebrow">자료 관리</p>
          <h1>학원 조사 DB</h1>
        </div>
      </div>

      <section className="beta-callout">
        <div>
          <span className="badge warn">미완성 베타</span>
          <h2>이 화면은 아직 전체 기능이 완성되지 않았습니다.</h2>
          <p>
            현재는 DrivingPlus에서 동기화한 학원 목록 조회와 학원별 기본 조사 정보 확인까지만 안정적으로 제공합니다.
            조사 항목 편집, 대량 관리, 자동 조사 흐름은 아직 정리 중이므로 운영 판단용 보조 화면으로만 사용해 주세요.
          </p>
        </div>
      </section>

      <p className="muted">
        기본정보·리뷰 원문과 AI 심층조사 데이터는 <b>별도 DB(academy_research.db)</b>에 저장됩니다.
        admin.db와 분리되어 초기화되지 않습니다.
      </p>

      <div className="card card-pad grid" style={{ gap: 14, margin: "16px 0" }}>
        <div style={{ display: "grid", gap: 12 }}>
          <div className="row" style={{ alignItems: "center" }}>
            <span className="muted small" style={{ minWidth: 88, fontWeight: 800 }}>학원정보</span>
            <button className="btn" onClick={onSync} disabled={busy === "sync" || Boolean(activeSyncRun)}>
              {activeSyncRun ? "동기화 진행 중…" : busy === "sync" ? "시작하는 중…" : "학원정보 동기화"}
            </button>
            <span className="muted small">{lastSyncLabel(lastSyncRun, Boolean(activeSyncRun))}</span>
          </div>
          <div className="row" style={{ alignItems: "center" }}>
            <span className="muted small" style={{ minWidth: 88, fontWeight: 800 }}>AI 조사</span>
            <div style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "nowrap" }}>
              <select className="select" value={researchProvider} onChange={(e) => setResearchProvider(e.target.value as ResearchProvider)} disabled={busy === "research" || Boolean(activeResearchRun)} aria-label="전체 AI 조사 CLI 선택" style={{ width: "auto", minWidth: 112 }}>
                <option value="auto">자동</option>
                <option value="codex">Codex</option>
                <option value="claude">Claude</option>
              </select>
              <button className="btn" onClick={onResearchAll} disabled={busy === "research" || Boolean(activeResearchRun)} style={{ whiteSpace: "nowrap" }}>
                {activeResearchRun ? "조사 진행 중…" : "전체 AI 조사"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {notice && <div className="card card-pad" style={{ borderColor: "#1a9c5b", color: "#1a9c5b", margin: "8px 0" }}>{notice}</div>}
      {error && <div className="card card-pad" style={{ borderColor: "#d64545", color: "#d64545", margin: "8px 0" }}>{error}</div>}

      {[activeSyncRun, activeResearchRun].filter(Boolean).map((run) => (
        <div key={run!.id} className="card card-pad" style={{ margin: "8px 0" }}>
          <div className="row" style={{ alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <b>{runLabel(run!)} 진행</b>
            <button className="btn" onClick={() => onCancel(run!)} disabled={Boolean(run!.cancel_requested)} style={{ whiteSpace: "nowrap" }}>
              {run!.cancel_requested ? "중단하는 중…" : "중단"}
            </button>
          </div>
          <div className="muted small" style={{ marginTop: 4 }}>{runDetail(run!)} · {run!.count_done}/{run!.count_total || "?"}</div>
          <div style={{ height: 8, background: "var(--surface-2, #eee)", borderRadius: 999, marginTop: 8, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct(run!)}%`, background: run!.cancel_requested ? "#b0851f" : "#1f6feb", transition: "width .4s" }} />
          </div>
          <p className="muted small" style={{ margin: "8px 0 0" }}>
            {run!.cancel_requested
              ? "중단 요청됨 — 처리 중이던 학원 1곳을 마친 뒤 멈춥니다. 여기까지 저장된 내용은 남습니다."
              : "서버에서 실행 중입니다. 이 창을 닫거나 새로고침해도 계속 진행되며, 다시 들어오면 진행률이 이어서 보입니다."}
          </p>
        </div>
      ))}

      <div className="row" style={{ alignItems: "flex-end", margin: "18px 0 10px" }}>
        <label style={{ display: "grid", gap: 4, flex: 1, minWidth: 180 }}>
          <span className="muted">목록 검색(이름/주소)</span>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="학원명 또는 주소" />
        </label>
        <button className="btn" onClick={load} disabled={loading}>새로고침</button>
        <span className="muted small" style={{ paddingBottom: 10 }}>{loading ? "불러오는 중…" : `${items.length}곳`}</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr><th>이름</th><th>주소</th><th>전화</th><th>유형</th><th>조사</th><th></th></tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.external_id}>
                <td>{a.name || "(이름없음)"}</td>
                <td className="muted">{a.address || "-"}</td>
                <td className="muted">{a.phone || "-"}</td>
                <td className="muted">{a.academy_type || "-"}</td>
                <td>{a.researched_at
                  ? <span className="badge">{a.research_engine || "AI"} · {fmtDate(a.researched_at)}</span>
                  : <span className="muted">미조사</span>}
                </td>
                <td><Link className="btn" href={`/academies/${encodeURIComponent(a.external_id)}`}>상세</Link></td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 24 }}>
                동기화된 학원이 없습니다. 위 <b>학원정보 동기화</b>를 먼저 실행하세요.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function pct(run: ResearchRun): number {
  if (!run.count_total) return 0;
  return Math.min(100, Math.round((run.count_done / run.count_total) * 100));
}
// 마지막 동기화 시각 + 결과. 중단된 실행은 "일부만 갱신됨"이 드러나야 한다.
function lastSyncLabel(run: ResearchRun | undefined, running: boolean): string {
  if (running) return "진행 중";
  if (!run) return "동기화 기록 없음";
  const when = formatDateTime(run.finished_at || run.started_at);
  const partial = `${run.count_done}/${run.count_total || "?"}곳만 갱신`;
  if (run.status === "cancelled") return `마지막 시도 ${when} · 사용자 중단(${partial})`;
  if (run.status !== "done") return `마지막 시도 ${when} · 중단됨(${partial})`;
  const result = parseResult(run.result);
  const reviews = typeof result?.reviews === "number" ? ` · 후기 ${result.reviews.toLocaleString()}건` : "";
  return `마지막 동기화 ${when} · 학원 ${result?.matched ?? run.count_done}곳${reviews}`;
}
function runLabel(run: ResearchRun): string {
  return run.scope === "sync" ? "학원정보 동기화" : "전체 AI 조사";
}
function runDetail(run: ResearchRun): string {
  if (run.scope === "sync") return "DrivingPlus 원본 + 후기";
  return `${run.region || "전체"} · ${run.engine || "auto"}`;
}
function runSummary(run: ResearchRun): string {
  const result = parseResult(run.result);
  if (run.scope === "sync") {
    const reviews = result?.reviews;
    return `학원 ${result?.matched ?? run.count_done}곳${typeof reviews === "number" ? ` · 후기 원문 ${reviews}건` : ""}`;
  }
  return `${run.count_done}/${run.count_total}곳`;
}
function parseResult(value?: string | null): Record<string, any> | null {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}
// 저장값은 UTC 다. 문자열을 그대로 자르면 9시간 어긋난 시각이 보인다.
function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  return formatShortDate(iso);
}
