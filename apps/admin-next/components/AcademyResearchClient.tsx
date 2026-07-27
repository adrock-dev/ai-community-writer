"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AcademyBaseRow, type ResearchProvider, type ResearchRun,
  cancelResearchRun, listAcademyResearch, listResearchRuns, researchRegion, syncBlogReviews, syncRegion,
} from "@/lib/academy-research";
import { formatDateTime, formatShortDate, parseUtcTimestamp } from "@/lib/date";

export default function AcademyResearchClient() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<AcademyBaseRow[]>([]);
  const [hiddenCount, setHiddenCount] = useState(0);
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
      setHiddenCount(res.hidden ?? 0);
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
    // 결과 문구는 목록 새로고침이 끝난 뒤에 세운다. load() 가 시작할 때 setError("") 로
    // 에러를 비우기 때문에, 먼저 세우면 실패 메시지가 곧바로 지워진다.
    // 반대쪽 메시지도 반드시 비운다 — 안 그러면 "백그라운드에서 계속 진행됩니다" 안내가
    // 이미 끝난(중단된) 실행 옆에 그대로 남아 서로 모순된 화면이 된다.
    void load().finally(() => {
      if (run.status === "error") {
        setNotice("");
        setError(`${runLabel(run)} 중단됨 — ${run.error || "원인 미상"} (${run.count_done}/${run.count_total || "?"}곳까지 저장)`);
        return;
      }
      setError("");
      if (run.status === "cancelled") setNotice(`${runLabel(run)} 중단됨 — ${runSummary(run)}까지 저장했습니다.`);
      else setNotice(`${runLabel(run)} 완료 — ${runSummary(run)}`);
    });
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

  async function onSyncBlog() {
    if (!confirm("블로그리뷰를 동기화합니다. 원천 조회가 학원당 10초라 전체에 8~15분 걸립니다(백그라운드). 진행할까요?")) return;
    setBusy("blog");
    setError("");
    setNotice("");
    try {
      const res = await syncBlogReviews();
      if (!res.ok) throw new Error(res.error || "시작 실패");
      if (res.run_id) watchedRunRef.current = res.run_id;
      setNotice("블로그리뷰 동기화를 백그라운드에서 시작했습니다. 창을 닫아도 계속 진행됩니다.");
      await loadRuns();
    } catch (e: any) {
      setError(e?.message || "블로그리뷰 동기화 시작 실패");
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
  const activeBlogRun = runs.find((r) => r.status === "running" && r.scope === "sync_blog");
  const activeResearchRun = runs.find((r) => r.status === "running" && r.scope !== "sync" && r.scope !== "sync_blog");
  // 끝난 동기화 중 가장 최근 것 — 진행 중이 아닐 때도 "언제 받아온 자료인지" 알 수 있어야 한다.
  const lastSyncRun = runs.find((r) => r.scope === "sync" && r.status !== "running");
  const lastBlogRun = runs.find((r) => r.scope === "sync_blog" && r.status !== "running");
  // 두 동기화는 같은 원천을 두드려 서버가 동시 실행을 막는다. 버튼도 같이 잠근다.
  const syncBusy = Boolean(activeSyncRun || activeBlogRun);
  // 학원정보만 갱신되고 블로그리뷰가 뒤처진 상태를 알린다. 중단된 실행은 일부만 돌았으므로
  // 완주(done)한 것끼리만 비교한다 — runs 는 최신순이라 첫 항목이 가장 최근이다.
  const lastSyncDone = runs.find((r) => r.scope === "sync" && r.status === "done");
  const lastBlogDone = runs.find((r) => r.scope === "sync_blog" && r.status === "done");
  const blogOutdated = Boolean(lastSyncDone) && !activeBlogRun
    && (!lastBlogDone || runTime(lastBlogDone) < runTime(lastSyncDone!));

  return (
    <div className="card-pad">
      <div className="page-head">
        <div>
          <p className="eyebrow">자료 관리</p>
          <h1>학원·시험장 조사 DB</h1>
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
          <div style={{ display: "grid", gap: 4 }}>
            <div className="row" style={{ alignItems: "center" }}>
              <span className="muted small" style={{ minWidth: 88, fontWeight: 800 }}>학원정보</span>
              <button className="btn" onClick={onSync} disabled={busy === "sync" || syncBusy}>
                {activeSyncRun ? "동기화 진행 중…" : busy === "sync" ? "시작하는 중…" : "학원정보 동기화"}
              </button>
              <span className="muted small">{lastSyncLabel(lastSyncRun, Boolean(activeSyncRun))}</span>
            </div>
            <DiagnosisLine run={activeSyncRun ? undefined : lastSyncRun} />
          </div>
          <div style={{ display: "grid", gap: 4 }}>
            <div className="row" style={{ alignItems: "center" }}>
              <span className="muted small" style={{ minWidth: 88, fontWeight: 800 }}>블로그리뷰</span>
              <button className="btn" onClick={onSyncBlog} disabled={busy === "blog" || syncBusy}>
                {activeBlogRun ? "동기화 진행 중…" : busy === "blog" ? "시작하는 중…" : "블로그리뷰 동기화"}
              </button>
              <span className="muted small">
                {lastSyncLabel(lastBlogRun, Boolean(activeBlogRun))}
                {blogOutdated && (
                  <span className="badge warn" style={{ marginLeft: 8 }}>
                    {lastBlogDone ? "학원정보보다 오래됨" : "완료된 적 없음"}
                  </span>
                )}
              </span>
            </div>
            <DiagnosisLine run={activeBlogRun ? undefined : lastBlogRun} />
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

      {[activeSyncRun, activeBlogRun, activeResearchRun].filter(Boolean).map((run) => (
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
          {collectBreakdown(run!) && <div className="muted small" style={{ marginTop: 8 }}>{collectBreakdown(run!)}</div>}
          {collectDiagnosis(run!) && (
            <p style={{ margin: "6px 0 0", color: "#b0851f", fontSize: 13 }}>⚠ {collectDiagnosis(run!)}</p>
          )}
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
        <span className="muted small" style={{ paddingBottom: 10 }}>
          {loading ? "불러오는 중…" : `${items.length}곳`}
          {!loading && hiddenCount > 0 && (
            <span title="원천 목록에서 내려간 항목입니다. 자료는 보관하되 목록·동기화 대상에서 제외합니다.">
              {" "}(원천 목록에 없는 {hiddenCount}곳 제외)
            </span>
          )}
        </span>
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
  const breakdown = collectBreakdown(run);
  return `마지막 동기화 ${when} · 학원 ${result?.matched ?? run.count_done}곳${reviews}${breakdown ? ` (${breakdown})` : ""}`;
}
function runLabel(run: ResearchRun): string {
  if (run.scope === "sync") return "학원정보 동기화";
  if (run.scope === "sync_blog") return "블로그리뷰 동기화";
  return "전체 AI 조사";
}
function runDetail(run: ResearchRun): string {
  if (run.scope === "sync") return "DrivingPlus 기본정보 + 후기";
  if (run.scope === "sync_blog") return "DrivingPlus 블로그리뷰";
  return `${run.region || "전체"} · ${run.engine || "auto"}`;
}
function runSummary(run: ResearchRun): string {
  const result = parseResult(run.result);
  if (run.scope === "sync" || run.scope === "sync_blog") {
    const reviews = result?.reviews;
    const unit = run.scope === "sync_blog" ? "블로그리뷰" : "후기 원문";
    return `학원 ${result?.matched ?? run.count_done}곳${typeof reviews === "number" ? ` · ${unit} ${reviews.toLocaleString()}건` : ""}`;
  }
  return `${run.count_done}/${run.count_total}곳`;
}
// 끝난 실행의 원인 진단을 버튼 바로 아래에 문장으로 남긴다.
// 배지만으로는 "왜 저조한지"가 전달되지 않는다(툴팁은 사실상 안 읽힌다).
function DiagnosisLine({ run }: { run?: ResearchRun }) {
  const diagnosis = run ? collectDiagnosis(run) : "";
  if (!run || !diagnosis) return null;
  return (
    <p style={{ margin: 0, marginLeft: 96, color: "#b0851f", fontSize: 13, lineHeight: 1.5 }}>
      ⚠ {diagnosis}
    </p>
  );
}

// 수집 내역. "빈 응답"(원천이 200 으로 0건을 줌)과 "조회 실패"(예외)는 대응이 달라 나눠 보여준다.
function collectBreakdown(run: ResearchRun): string {
  const r = parseResult(run.result);
  if (!r || typeof r.with_data !== "number") return "";
  // 이 셋은 후기 조회 결과만 센다. 학원 기본정보는 목록 API 한 번으로 전부 받아오므로
  // 학원별로 성패가 갈리지 않는다 — 그래서 "수집"이라고만 쓰면 기본정보로 오해된다.
  const unit = reviewUnit(run);
  return `${unit} 있음 ${r.with_data}곳 · ${unit} 0건 ${r.empty ?? 0}곳 · 조회 실패 ${r.failed ?? 0}곳`;
}
function reviewUnit(run: ResearchRun): string {
  return run.scope === "sync_blog" ? "블로그리뷰" : "후기";
}

// 저조의 원인을 문장으로. 표본이 너무 적으면 단정하지 않는다.
function collectDiagnosis(run: ResearchRun): string {
  const r = parseResult(run.result);
  if (!r || typeof r.with_data !== "number") return "";
  const done = Number(r.done ?? run.count_done ?? 0);
  if (done < 10) return "";
  const empty = Number(r.empty ?? 0);
  const failed = Number(r.failed ?? 0);
  const unit = reviewUnit(run);
  if (failed >= done * 0.3) {
    return `${unit} 조회 실패가 많습니다. 원천 장애로 보이며, 실패한 학원의 기존 ${unit}는 지우지 않고 그대로 두었습니다.`;
  }
  if (empty >= done * 0.5) {
    return `대부분의 학원에서 ${unit}가 0건으로 내려왔습니다. 원천이 목록을 주지 않는 상태로 보이며, 교체 정책상 해당 학원의 기존 ${unit}는 지워집니다. (학원 기본정보는 정상 갱신됐습니다)`;
  }
  return "";
}

// 완주 시각(없으면 시작 시각) 기준 비교값. 저장값은 UTC 라 문자열 비교는 위험하다.
function runTime(run: ResearchRun): number {
  return parseUtcTimestamp(run.finished_at || run.started_at)?.getTime() ?? 0;
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
