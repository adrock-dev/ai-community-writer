"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  type AcademyFull, type StatusDef, RESEARCH_FIELD_LABELS,
  getAcademyResearch, listStatusDefs, researchOneAcademy, setResearchFieldMeta, syncOneAcademy, updateResearchField,
} from "@/lib/academy-research";

export default function AcademyDetailClient({ externalId }: { externalId: string }) {
  const [data, setData] = useState<AcademyFull | null>(null);
  const [defs, setDefs] = useState<StatusDef[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
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

  async function onSync() {
    setBusy("sync"); setError(""); setNotice("");
    try { const r = await syncOneAcademy(externalId); setNotice(r.found ? `동기화 완료 · 리뷰 ${r.reviews}건` : "DrivingPlus에서 학원을 찾지 못했습니다."); await load(); }
    catch (e: any) { setError(e?.message || "동기화 실패"); }
    finally { setBusy(""); }
  }
  async function onResearch() {
    setBusy("research"); setError(""); setNotice("");
    try {
      const r = await researchOneAcademy(externalId);
      if (r.no_sources) { setError(`⚠️ ${r.error || "공개 소스를 찾지 못했습니다."}`); await load(); return; }
      if (!r.ok) throw new Error(r.error || "실패");
      setNotice(`AI 조사 완료 (${r.provider}) · 소스 ${r.sources ?? 0}건`); await load();
    } catch (e: any) { setError(e?.message || "조사 실패"); }
    finally { setBusy(""); }
  }
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
      <p><Link href="/academies" className="muted">← 학원 조사 목록</Link></p>
      <h1 style={{ marginTop: 0 }}>{b.name || "(이름없음)"}</h1>
      <p className="muted">external_id: {b.external_id} · {b.region || "-"} · {b.academy_type || "-"}</p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0 16px" }}>
        <button className="btn" onClick={onSync} disabled={busy === "sync"}>{busy === "sync" ? "동기화 중…" : "DrivingPlus 재동기화"}</button>
        <button className="btn" onClick={onResearch} disabled={busy === "research"}>{busy === "research" ? "조사 중… (수분 소요)" : "AI 단건 조사"}</button>
      </div>
      {notice && <div className="card card-pad" style={{ borderColor: "#1a9c5b", color: "#1a9c5b", margin: "8px 0" }}>{notice}</div>}
      {error && <div className="card card-pad" style={{ borderColor: "#d64545", color: "#d64545", margin: "8px 0" }}>{error}</div>}

      {/* DrivingPlus 원본(참고, 덮어쓰지 않음) */}
      <h2>DrivingPlus 원본 <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>(참고 · 조사값과 병존)</span></h2>
      <div className="card card-pad">
        <div className="muted">주소</div><div>{b.address || "-"}</div>
        <div className="muted" style={{ marginTop: 8 }}>전화 / 대표번호</div><div>{b.phone || "-"} / {b.vphone || "-"}</div>
        <div className="muted" style={{ marginTop: 8 }}>동기화 시각</div><div>{fmt(b.synced_at)}</div>
      </div>

      {/* AI 조사 필드 (값 편집 + 검증상태 토글) */}
      <h2>심층조사 필드 <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>
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
                  <td><input className="input" style={{ width: "100%" }} value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} /></td>
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

      {/* 후기 원문 (DrivingPlus review/blogReview) */}
      <h2>후기 원문 <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>({data.reviews.length}) · DrivingPlus 출처</span></h2>
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
      )) : <p className="muted">수집된 후기가 없습니다. 재동기화를 시도하세요.</p>}
    </div>
  );
}

function fmt(iso?: string | null): string { return iso ? String(iso).slice(0, 16).replace("T", " ") : "-"; }
function fmtJson(value: unknown): string {
  if (value == null) return "-";
  if (typeof value === "string") { try { const p = JSON.parse(value); return typeof p === "string" ? p : JSON.stringify(p); } catch { return value; } }
  try { return JSON.stringify(value); } catch { return "-"; }
}
