"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { deleteDraft, dismissDraft, getDraft, listDrafts, promoteDraft, revalidateDraft } from "@/lib/api";
import { formatDateTime } from "@/lib/date";
import type { DraftDetail, DraftIssue, DraftReviewStatus, DraftSummary } from "@/lib/types";

// 이슈 코드 → 사람이 읽는 설명. 없는 코드는 원문 코드를 그대로 보여준다(어간 접미사 포함).
const ISSUE_LABELS: Record<string, string> = {
  missing_h1_title: "H1 제목 없음",
  too_short: "본문이 너무 짧음",
  too_long: "본문이 너무 김",
  not_enough_h2: "H2 섹션 부족",
  too_many_h2: "H2 섹션 과다",
  missing_comparison_table: "비교 표 없음",
  missing_summary_table: "요약 표 없음",
  missing_checklist_or_list: "체크리스트/목록 없음",
  thin_sections: "내용이 빈약한 섹션",
  review_facts_unused: "제공된 후기 미사용",
  missing_available_image_slot: "이미지 슬롯 미사용",
  unknown_image_slots: "정의되지 않은 이미지 슬롯",
  missing_candidate_h3_headings: "후보 H3 제목 부족",
  keyword_spacing_issue: "키워드 띄어쓰기 문제",
  overlong_paragraph: "문단이 너무 김",
  overlong_sentence: "문장이 너무 김",
  hard_sentences: "읽기 어려운 문장",
  missing_internal_link: "내부 링크 없음",
  exposes_internal_fact_language: "내부 데이터/원천 표현 노출",
  contains_visible_citations: "인용 마커 노출",
  contains_pseudo_slot: "가짜 슬롯 표기 노출",
  risky_duration_or_pass_guarantee_claim: "초단기·합격 보장 과장",
  unverified_specific_price_claim: "미검증 가격 단정",
  unverified_review_claim: "미검증 후기 단정",
  inflated_candidate_count: "실제보다 부풀린 후보 수",
  missing_real_candidate_name: "실제 후보 학원명 없음",
  table_missing_real_candidate_name: "표에 실제 후보명 없음",
  t01_unverified_shuttle_claim: "미검증 셔틀 운행 단정",
  t01_unverified_pass_rate_claim: "미검증 합격률 단정",
  t01_unverified_shuttle_implication: "셔틀 가능성 암시(미검증)",
  t01_unverified_pass_rate_implication: "합격 가능성 암시(미검증)",
};

function issueLabel(code: string): string {
  for (const stem of Object.keys(ISSUE_LABELS)) {
    if (code === stem || code.startsWith(`${stem}_`)) return ISSUE_LABELS[stem]!;
  }
  return code;
}

function IssueBadge({ issue }: { issue: DraftIssue }) {
  const isB = issue.class === "B";
  const style = isB
    ? { background: "#fdecec", color: "#b42318", border: "1px solid #f3c0bd" }
    : { background: "#fff7e6", color: "#8a5a00", border: "1px solid #f2d999" };
  return <span className="badge" style={style} title={issue.code}>{isB ? "B" : "A"} · {issueLabel(issue.code)}</span>;
}

export default function DraftsClient({ domain }: { domain: string }) {
  const [items, setItems] = useState<DraftSummary[]>([]);
  const [pending, setPending] = useState(0);
  const [statusFilter, setStatusFilter] = useState<DraftReviewStatus>("pending");
  const [selected, setSelected] = useState<DraftDetail | null>(null);
  const [bodyHtml, setBodyHtml] = useState("");
  const [editBody, setEditBody] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await listDrafts(domain, { status: statusFilter });
      setItems(payload.items); setPending(payload.pending); setError("");
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [domain, statusFilter]);

  useEffect(() => { void refresh(); }, [refresh]);

  const open = useCallback(async (id: string) => {
    setError(""); setNotice("");
    try {
      const detail = await getDraft(domain, id);
      setSelected(detail.draft); setBodyHtml(detail.body_html ?? ""); setEditBody(detail.draft.body_markdown ?? "");
    } catch (e) { setError((e as Error).message); }
  }, [domain]);

  const closeDetail = () => { setSelected(null); setBodyHtml(""); setNotice(""); };

  const doPromote = async () => {
    if (!selected) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const res = await promoteDraft(domain, selected.id);
      setNotice(`발행 완료 (post ${res.post_id.slice(0, 8)}…)`);
      closeDetail(); await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const doRevalidate = async () => {
    if (!selected) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const res = await revalidateDraft(domain, selected.id, editBody);
      setSelected({ ...selected, quality_issues: res.quality_issues, blocking_class: res.blocking_class, body_markdown: editBody });
      setNotice(res.promotable
        ? "재검증 완료 — 남은 이슈는 구조/문체(A)뿐입니다. 발행할 수 있습니다."
        : "재검증 완료 — 안전·사실(B) 이슈가 남아 있어 아직 발행할 수 없습니다.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const doDismiss = async () => {
    if (!selected) return;
    setBusy(true); setError("");
    try { await dismissDraft(domain, selected.id); closeDetail(); await refresh(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const doDelete = async () => {
    if (!selected) return;
    if (!window.confirm("이 초안을 영구 삭제할까요?")) return;
    setBusy(true); setError("");
    try { await deleteDraft(domain, selected.id); closeDetail(); await refresh(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const promotable = selected?.blocking_class !== "B";

  return <div className="grid" style={{ gap: 16 }}>
    <div className="page-head">
      <div>
        <Link href={`/t/${encodeURIComponent(domain)}/posts`} className="eyebrow">← {domain} 검수·내보내기</Link>
        <h1>검수 대기 <span className="badge">{pending}</span></h1>
        <p className="muted">품질 게이트에 걸려 발행되지 못한 글입니다. <b style={{ color: "#b42318" }}>B(안전·사실)</b> 이슈가 있으면 발행할 수 없고, 본문을 수정해 재검증해야 합니다. <b style={{ color: "#8a5a00" }}>A(구조/문체)</b>만 남으면 사유를 확인한 뒤 발행할 수 있습니다.</p>
      </div>
      <div className="row">
        {(["pending", "dismissed", "promoted"] as DraftReviewStatus[]).map((s) =>
          <button key={s} className={`tab ${statusFilter === s ? "active" : ""}`} onClick={() => setStatusFilter(s)}>
            {s === "pending" ? "검수 대기" : s === "dismissed" ? "반려됨" : "발행됨"}
          </button>)}
        <button className="btn" onClick={() => void refresh()}>새로고침</button>
      </div>
    </div>

    {error && <p className="toast-error">{error}</p>}
    {notice && <p className="muted" style={{ color: "#087443" }}>{notice}</p>}

    <div className="grid" style={{ gridTemplateColumns: selected ? "minmax(0, 380px) minmax(0, 1fr)" : "1fr", gap: 16, alignItems: "start" }}>
      <div className="card card-pad">
        {loading ? <p className="muted">로딩 중…</p> : items.length === 0 ? <p className="muted">해당 상태의 초안이 없습니다.</p> :
          <div className="grid" style={{ gap: 8 }}>
            {items.map((d) => {
              const isB = d.blocking_class === "B";
              return <button key={d.id} className={`card card-pad ${selected?.id === d.id ? "active" : ""}`} style={{ textAlign: "left", cursor: "pointer", borderColor: selected?.id === d.id ? "#0066ff" : undefined }} onClick={() => void open(d.id)}>
                <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                  <b style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{d.title || "(제목 없음)"}</b>
                  <span className="badge" style={isB ? { background: "#fdecec", color: "#b42318" } : { background: "#fff7e6", color: "#8a5a00" }}>{isB ? "발행 불가·B" : "검토 가능·A"}</span>
                </div>
                <p className="muted small" style={{ margin: "4px 0" }}>{[d.region, d.primary_keyword].filter(Boolean).join(" · ") || "-"} · {d.body_chars.toLocaleString()}자 · {formatDateTime(d.created_at)}</p>
                <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>{d.quality_issues.slice(0, 4).map((iss, i) => <IssueBadge issue={iss} key={i} />)}{d.quality_issues.length > 4 && <span className="badge">+{d.quality_issues.length - 4}</span>}</div>
              </button>;
            })}
          </div>}
      </div>

      {selected && <div className="grid" style={{ gap: 12 }}>
        <div className="card card-pad">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>{selected.title || "(제목 없음)"}</h2>
            <button className="btn" onClick={closeDetail}>닫기</button>
          </div>
          <p className="muted small">{[selected.region, selected.primary_keyword].filter(Boolean).join(" · ")} · {selected.gate_stage ?? ""} · {selected.provider ?? ""} {selected.model ?? ""}</p>
          <h3 style={{ marginBottom: 4 }}>걸린 품질 이슈</h3>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>{selected.quality_issues.length ? selected.quality_issues.map((iss, i) => <IssueBadge issue={iss} key={i} />) : <span className="muted">없음</span>}</div>
          <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button className="btn primary" disabled={busy || !promotable} onClick={() => void doPromote()} title={promotable ? "" : "B(안전·사실) 이슈가 남아 발행할 수 없습니다"}>사유 확인함 · 발행</button>
            <button className="btn" disabled={busy} onClick={() => void doRevalidate()}>본문 수정 후 재검증</button>
            <button className="btn" disabled={busy} onClick={() => void doDismiss()}>반려</button>
            <button className="btn" disabled={busy} onClick={() => void doDelete()} style={{ color: "#b42318" }}>삭제</button>
          </div>
          {!promotable && <p className="muted small" style={{ color: "#b42318", marginTop: 8 }}>안전·사실(B) 이슈가 있어 바로 발행할 수 없습니다. 아래에서 본문을 수정하고 재검증해 B 이슈를 해소하세요.</p>}
        </div>

        <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12, alignItems: "start" }}>
          <div className="card card-pad">
            <h3>본문 수정 (Markdown)</h3>
            <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} spellCheck={false} style={{ width: "100%", minHeight: 420, fontFamily: "monospace", fontSize: 13, lineHeight: 1.5 }} />
          </div>
          <div className="card card-pad">
            <h3>렌더 미리보기</h3>
            <div className="generated-blocks" style={{ maxHeight: 460, overflow: "auto" }} dangerouslySetInnerHTML={{ __html: bodyHtml || "<p class='muted'>미리보기 없음</p>" }} />
          </div>
        </div>
      </div>}
    </div>
  </div>;
}
