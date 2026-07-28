"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  type AcademyFull, type ResearchProvider, type ResearchRun, type StatusDef, RESEARCH_FIELD_LABELS,
  getAcademyResearch, getResearchRun, listResearchRuns, listStatusDefs, researchOneAcademy,
  setResearchFieldMeta, syncOneAcademy, updateResearchField,
} from "@/lib/academy-research";
import { formatDateTime } from "@/lib/date";

export default function AcademyDetailClient({ externalId }: { externalId: string }) {
  const [data, setData] = useState<AcademyFull | null>(null);
  const [defs, setDefs] = useState<StatusDef[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [researchProvider, setResearchProvider] = useState<ResearchProvider>("auto");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [full, defRes] = await Promise.all([getAcademyResearch(externalId), listStatusDefs()]);
      setData(full);
      setDefs(defRes.items);
      const v: Record<string, string> = {};
      for (const f of RESEARCH_FIELD_LABELS) v[f.key] = full.research?.[f.key] ?? "";
      setValues(v);
      const s: Record<string, string> = {};
      for (const m of full.field_meta) s[m.field_key] = m.status;
      setStatuses(s);
    } catch (e: any) {
      setError(e?.message || "불러오기 실패");
    }
  }, [externalId]);

  useEffect(() => { load(); }, [load]);

  /**
   * 단건 조사. 서버가 백그라운드로 돌리고 run_id 만 주므로 여기서 진행을 폴링한다.
   *
   * 예전에는 응답을 끝까지 기다렸는데, 조사 1곳이 평균 85초·길면 388초라 관리자 프록시의
   * fetch(기본 300초)에 끊겼다 — 서버는 저장했는데 화면은 실패로 보이는 상태였다.
   * 이제 창을 닫았다 와도 진행 중이면 다시 붙는다.
   */
  /** 이 학원의 기본정보·후기만 원천에서 다시 받는다. 전체 동기화(380곳)를 돌릴 이유가 없다. */
  async function onSyncOne() {
    setBusy("sync"); setError(""); setNotice("");
    try {
      const r = await syncOneAcademy(externalId);
      setNotice(r.found ? `원천에서 다시 받았습니다 · 후기 ${r.reviews}건` : "원천 목록에서 이 학원을 찾지 못했습니다.");
      await load();
    } catch (e: any) { setError(e?.message || "동기화 실패"); }
    finally { setBusy(""); }
  }

  async function onResearch() {
    const targetName = data?.base?.name || externalId;
    if (!confirm(`${targetName} 학원을 ${researchProvider}로 AI 단건 조사합니다.\n1~2분 걸리며 창을 닫아도 서버에서 계속 진행됩니다. 진행할까요?`)) return;
    setBusy("research"); setError(""); setNotice("");
    try {
      const started = await researchOneAcademy(externalId, researchProvider);
      if (!started.ok || !started.run_id) throw new Error(started.error || "시작 실패");
      await watchRun(started.run_id);
    } catch (e: any) { setError(e?.message || "조사 실패"); setBusy(""); }
  }

  // 끝날 때까지 run 행을 지켜본다. 결과는 요청이 아니라 run 에만 남으므로, 새로고침하거나
  // 창을 닫았다 와도 같은 방식으로 이어 볼 수 있다(목록 화면의 배치와 동일한 구조).
  const watchRun = useCallback(async (runId: string) => {
    setBusy("research");
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      let run: ResearchRun;
      try { run = await getResearchRun(runId); }
      catch { continue; } // 일시적 조회 실패로 진행을 포기하지 않는다
      if (run.status === "running") { setNotice(`AI 조사 진행 중… (${run.engine || "auto"})`); continue; }
      const tally = (() => { try { return JSON.parse(String(run.result ?? "{}")); } catch { return {}; } })();
      setBusy("");
      await load();
      if (run.status === "done") { setNotice(`AI 조사 완료 (${tally.provider ?? run.engine ?? "auto"}) · 소스 ${tally.sources ?? 0}건`); return; }
      setNotice("");
      setError(tally.no_sources ? `⚠️ ${run.error || "공개 소스를 찾지 못했습니다."}` : `조사 실패: ${run.error || "원인 미상"}`);
      return;
    }
  }, [load]);

  // 진행 중이던 조사가 있으면 화면을 다시 열었을 때 붙는다.
  useEffect(() => {
    let cancelled = false;
    void listResearchRuns()
      .then((res) => {
        const mine = res.items.find((r) => r.scope === "single" && r.external_id === externalId && r.status === "running");
        if (mine && !cancelled) void watchRun(mine.id);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [externalId, watchRun]);
  async function saveValue(field: string) {
    setError(""); setNotice("");
    try { await updateResearchField(externalId, field, values[field] ?? ""); setNotice(`저장됨: ${field}`); }
    catch (e: any) { setError(e?.message || "저장 실패"); }
  }
  async function changeStatus(field: string, status: string) {
    setStatuses((s) => ({ ...s, [field]: status }));
    try { await setResearchFieldMeta(externalId, { field_key: field, status }); }
    catch (e: any) { setError(e?.message || "상태 변경 실패"); }
  }

  if (!data) return <div className="card-pad">{error ? <span style={{ color: "#d64545" }}>{error}</span> : "불러오는 중…"}</div>;
  const b = data.base;
  const metaByKey = Object.fromEntries(data.field_meta.map((m) => [m.field_key, m]));

  return (
    <div className="card-pad">
      <p><Link href="/academies" className="muted">← 운전학원 자료 목록</Link></p>
      <h1 style={{ marginTop: 0 }}>{b.name || "(이름없음)"}</h1>
      <p className="muted">external_id: {b.external_id} · {b.region || "-"} · {b.academy_type || "-"}</p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "8px 0 16px" }}>
        <div style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "nowrap" }}>
          <select className="select" value={researchProvider} onChange={(e) => setResearchProvider(e.target.value as ResearchProvider)} disabled={busy === "research"} aria-label="AI 조사 CLI 선택" style={{ width: "auto", minWidth: 112 }}>
            <option value="auto">자동</option>
            <option value="codex">Codex</option>
            <option value="claude">Claude</option>
          </select>
          <button className="btn" onClick={onResearch} disabled={busy === "research"} style={{ whiteSpace: "nowrap" }}>{busy === "research" ? "조사 중… (수분 소요)" : "AI 단건 조사"}</button>
        </div>
        <button className="btn" onClick={onSyncOne} disabled={Boolean(busy)} style={{ whiteSpace: "nowrap" }}>{busy === "sync" ? "받는 중…" : "원천에서 다시 받기"}</button>
      </div>
      {notice && <div className="card card-pad" style={{ borderColor: "#1a9c5b", color: "#1a9c5b", margin: "8px 0" }}>{notice}</div>}
      {error && <div className="card card-pad" style={{ borderColor: "#d64545", color: "#d64545", margin: "8px 0" }}>{error}</div>}

      {/* DrivingPlus 원본 기본정보(참고, 덮어쓰지 않음) */}
      <h2>DrivingPlus 원본 기본정보 <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>(참고 · 조사값과 병존)</span></h2>
      <div className="card card-pad">
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <tbody>
              <tr><th style={{ width: 150 }}>외부 ID</th><td>{b.external_id}</td></tr>
              <tr><th>학원명</th><td>{b.name || "-"}</td></tr>
              <tr><th>지역 / 유형</th><td>{b.region || "-"} / {b.academy_type || "-"}</td></tr>
              <tr><th>주소</th><td>{b.address || "-"}</td></tr>
              <tr><th>전화 / 대표번호</th><td>{b.phone || "-"} / {b.vphone || "-"}</td></tr>
              <tr><th>좌표</th><td>{b.latitude != null && b.longitude != null ? `${b.latitude}, ${b.longitude}` : "-"}</td></tr>
              <tr><th>썸네일</th><td>{b.thumb_url ? <a href={b.thumb_url} target="_blank" rel="noreferrer">{b.thumb_url}</a> : "-"}</td></tr>
              <tr><th>사진</th><td className="muted">{fmtJson(b.photos)}</td></tr>
              <tr><th>SEO 제목</th><td>{b.seo_title || "-"}</td></tr>
              <tr><th>SEO 키워드</th><td>{b.seo_keywords || "-"}</td></tr>
              <tr><th>SEO 설명</th><td>{b.seo_description || "-"}</td></tr>
              <tr><th>원본 동기화 시각</th><td>{fmt(b.synced_at)}</td></tr>
            </tbody>
          </table>
        </div>
        <details style={{ marginTop: 12 }}>
          <summary className="muted" style={{ cursor: "pointer", fontWeight: 700 }}>DrivingPlus 원본 JSON</summary>
          <pre className="small" style={{ marginTop: 10, padding: 12, overflowX: "auto", background: "#f8fafc", border: "1px solid var(--line)", borderRadius: 8 }}>{fmtJsonPretty(b.raw_json)}</pre>
        </details>
      </div>

      {/* 원천이 답을 가진 항목. 이 값들은 조사에서 빠지므로 조사 필드가 비어 있는데,
          함께 보여주지 않으면 "조사가 실패했다" 로 읽힌다. */}
      {data.source_facts?.length ? (
        <div className="card card-pad" style={{ marginTop: 24, background: "#f8fafc" }}>
          <b className="small">원천 자료로 확정된 항목</b>
          <p className="muted small" style={{ margin: "4px 0 8px" }}>
            아래 항목은 원천 동기화로 이미 확인돼 조사 대상에서 빠집니다. 글 생성도 이 값을 씁니다.
          </p>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {data.source_facts.map((line, i) => <li key={i}>{line.replace(/^- /, "")}</li>)}
          </ul>
        </div>
      ) : null}

      {/* AI 심층조사 필드 (값 편집 + 검증상태 토글) */}
      <h2 style={{ marginTop: 28 }}>심층조사 필드 <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>
        {data.research?.researched_at ? `· ${data.research.research_engine || "AI"} · ${fmt(data.research.researched_at)}` : "· 미조사"}
      </span></h2>
      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead><tr><th style={{ width: 130 }}>항목</th><th>값</th><th style={{ width: 130 }}>검증상태</th><th style={{ width: 70 }}>출처</th><th style={{ width: 70 }}></th></tr></thead>
          <tbody>
            {RESEARCH_FIELD_LABELS.map((f) => {
              const meta = metaByKey[f.key];
              return (
                <tr key={f.key}>
                  <td>{f.label}</td>
                  <td>
                    <input className="input" style={{ width: "100%" }} value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
                    {/* 사유가 없으면 왜 「검토 필요」인지, 왜 값이 비었는지 화면에서 알 수 없다. */}
                    {meta?.note ? (
                      <p className="small" style={{ margin: "4px 0 0", color: statuses[f.key] === "needs_review" ? "#b45309" : "var(--muted, #64748b)" }}>
                        {statuses[f.key] === "needs_review" ? "⚠️ " : ""}{meta.note}
                      </p>
                    ) : null}
                  </td>
                  <td>
                    <select className="select" value={statuses[f.key] ?? "unverified"} onChange={(e) => changeStatus(f.key, e.target.value)}>
                      {defs.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
                    </select>
                  </td>
                  <td>{meta?.source_url ? <a href={meta.source_url} target="_blank" rel="noreferrer" className="badge">링크</a> : <span className="muted">-</span>}</td>
                  <td><button className="btn" onClick={() => saveValue(f.key)}>저장</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 과정별 가격 */}
      <h2>과정별 가격 <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>({data.courses.length})</span></h2>
      {data.courses.length ? (
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead><tr><th>과정</th><th>가격</th><th>검정료</th><th>부대비용</th><th>비고</th></tr></thead>
            <tbody>
              {data.courses.map((c) => (
                <tr key={c.id}><td>{c.course_name || "-"}</td><td>{c.price || "-"}</td><td>{c.exam_fee_included || "-"}</td><td>{c.extra_costs || "-"}</td><td className="muted">{c.note || "-"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="muted">조사된 과정이 없습니다.</p>}

      {/* 셔틀 노선 */}
      <h2>셔틀 노선 <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>({data.shuttle_routes.length})</span></h2>
      {data.shuttle_routes.length ? (
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead><tr><th>노선</th><th>경유</th><th>커버</th><th>배차</th></tr></thead>
            <tbody>
              {data.shuttle_routes.map((r) => (
                <tr key={r.id}><td>{r.route_name || "-"}</td><td className="muted">{fmtJson(r.waypoints)}</td><td className="muted">{fmtJson(r.coverage)}</td><td>{r.interval_text || "-"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="muted">조사된 셔틀 노선이 없습니다.</p>}

      {/* DrivingPlus 원본 후기 (review/blogReview) */}
      <h2>DrivingPlus 원본 후기 <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>({data.reviews.length})</span></h2>
      {data.reviews.length ? data.reviews.map((rv) => (
        <div key={rv.id} className="card card-pad" style={{ margin: "8px 0" }}>
          <div className="muted" style={{ fontSize: 12 }}>
            <span className="badge">{rv.platform === "drivingplus_blog" ? "블로그" : "리뷰"}</span>
            {rv.rating != null && <> · ★ {rv.rating}</>} {rv.author_masked && <> · {rv.author_masked}</>} {rv.posted_at && <> · {rv.posted_at}</>}
          </div>
          {rv.title && <b>{rv.title}</b>}
          <p style={{ margin: "6px 0" }}>{rv.quote_text}</p>
          {rv.source_url && <a href={rv.source_url} target="_blank" rel="noreferrer" className="muted" style={{ fontSize: 12 }}>원문 링크 ↗</a>}
        </div>
      )) : (
        <div className="action-hint">
          <span>수집된 후기가 없습니다. 원천에서 이 학원만 다시 받아 볼 수 있습니다.</span>
          <button className="btn primary" onClick={onSyncOne} disabled={Boolean(busy)}>{busy === "sync" ? "받는 중…" : "원천에서 다시 받기"}</button>
        </div>
      )}
    </div>
  );
}

function fmt(iso?: string | null): string { return formatDateTime(iso); }
function fmtJsonPretty(value: unknown): string {
  if (value == null || value === "") return "-";
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return String(value);
  }
}
function fmtJson(value: unknown): string {
  if (value == null) return "-";
  if (typeof value === "string") { try { const p = JSON.parse(value); return typeof p === "string" ? p : JSON.stringify(p); } catch { return value; } }
  try { return JSON.stringify(value); } catch { return "-"; }
}
