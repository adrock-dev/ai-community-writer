"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AcademyBaseRow, type ResearchRun,
  listAcademyResearch, listResearchRuns, researchRegion, syncRegion,
} from "@/lib/academy-research";

export default function AcademyResearchClient() {
  const [region, setRegion] = useState("부산");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<AcademyBaseRow[]>([]);
  const [runs, setRuns] = useState<ResearchRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await listAcademyResearch(region.trim() || undefined, q.trim() || undefined);
      setItems(res.items);
    } catch (e: any) {
      setError(e?.message || "목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [region, q]);

  const loadRuns = useCallback(async () => {
    try {
      const res = await listResearchRuns();
      setRuns(res.items);
    } catch { /* 무시 */ }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadRuns(); }, [loadRuns]);

  // 진행 중인 조사가 있으면 폴링.
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

  async function onSync() {
    setBusy("sync");
    setError("");
    setNotice("");
    try {
      const res = await syncRegion(region.trim());
      setNotice(`동기화 완료 — ${res.region}: ${res.matched}곳(전체 ${res.total}) · 리뷰 원문 ${res.reviews}건`);
      await load();
    } catch (e: any) {
      setError(e?.message || "동기화 실패");
    } finally {
      setBusy("");
    }
  }

  async function onResearchAll() {
    if (!confirm(`${region} 지역 전체 학원을 AI로 심층조사합니다(백그라운드). 진행할까요?`)) return;
    setBusy("research");
    setError("");
    setNotice("");
    try {
      const res = await researchRegion(region.trim());
      if (!res.ok) throw new Error(res.error || "시작 실패");
      setNotice(`전체 조사 시작 — 대상 ${res.count}곳 (run: ${res.run_id?.slice(0, 8)})`);
      await loadRuns();
    } catch (e: any) {
      setError(e?.message || "조사 시작 실패");
    } finally {
      setBusy("");
    }
  }

  const activeRun = runs.find((r) => r.status === "running");

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

      <div className="card card-pad" style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", margin: "16px 0" }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="muted">지역</span>
          <input className="input" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="부산" style={{ width: 120 }} />
        </label>
        <label style={{ display: "grid", gap: 4, flex: 1, minWidth: 160 }}>
          <span className="muted">검색(이름/주소)</span>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="학원명 또는 주소" />
        </label>
        <button className="btn" onClick={load} disabled={loading}>새로고침</button>
        <button className="btn" onClick={onSync} disabled={busy === "sync"}>{busy === "sync" ? "동기화 중…" : "DrivingPlus 동기화"}</button>
        <button className="btn" onClick={onResearchAll} disabled={busy === "research" || Boolean(activeRun)}>
          {activeRun ? "조사 진행 중…" : "전체 AI 조사"}
        </button>
      </div>

      {notice && <div className="card card-pad" style={{ borderColor: "#1a9c5b", color: "#1a9c5b", margin: "8px 0" }}>{notice}</div>}
      {error && <div className="card card-pad" style={{ borderColor: "#d64545", color: "#d64545", margin: "8px 0" }}>{error}</div>}

      {activeRun && (
        <div className="card card-pad" style={{ margin: "8px 0" }}>
          <b>전체 조사 진행</b> — {activeRun.region} · {activeRun.engine} · {activeRun.count_done}/{activeRun.count_total}
          <div style={{ height: 8, background: "var(--surface-2, #eee)", borderRadius: 999, marginTop: 8, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct(activeRun)}%`, background: "#1f6feb" }} />
          </div>
        </div>
      )}

      <p className="muted">{loading ? "불러오는 중…" : `${items.length}곳`}</p>
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
                동기화된 학원이 없습니다. 위 <b>DrivingPlus 동기화</b>를 먼저 실행하세요.
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
function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  return String(iso).slice(0, 16).replace("T", " ");
}
