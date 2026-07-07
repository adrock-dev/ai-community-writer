"use client";

import Link from "next/link";
import { useState } from "react";
import { cancelJob, pauseJob, prioritizeJob, resumeJob } from "@/lib/api";
import { formatDateTime } from "@/lib/date";
import type { Job } from "@/lib/types";

const CTL_STYLE = { minHeight: 34, padding: "7px 14px", fontSize: 13, fontWeight: 800 } as const;

// 작업 큐 카드 — 전역 작업 큐(/jobs)와 도메인 관리 > 작업 탭이 공유하는 상세 뷰.
// 차이는 컨텍스트뿐이므로 showDomain 으로 도메인 링크 노출만 토글한다.
export function JobCard({ job, showDomain = false, designFallback, onChanged }: { job: Job; showDomain?: boolean; designFallback?: string; onChanged?: () => void }) {
  const [acting, setActing] = useState(false);
  const ctl = (e: React.MouseEvent, fn: (id: string) => Promise<unknown>) => {
    e.preventDefault(); e.stopPropagation();
    if (acting) return; setActing(true);
    fn(job.id).then(() => onChanged?.()).catch((err) => alert(err instanceof Error ? err.message : String(err))).finally(() => setActing(false));
  };
  const total = jobTotal(job);
  const ok = num(job.result_obj?.ok);
  const fail = num(job.result_obj?.fail);
  const done = ok + fail;
  const percent = job.status === "done" || job.status === "failed"
    ? 100
    : job.status === "running"
      ? Math.max(20, Math.min(90, Math.round((done / Math.max(total, 1)) * 100) || 35))
      : 5;
  const slotIds = Array.isArray(job.payload_obj?.slot_ids) ? job.payload_obj.slot_ids : [];
  return <details className="card" open={job.status === "running" || job.status === "failed"}>
    <summary className="spread" style={{ padding: 16, cursor: "pointer" }}>
      <div className="row">
        <JobStatusBadge status={job.status} />
        <b>{job.kind}</b>
        <span className="muted small">{jobLabel(job)}</span>
        {job.paused ? <span className="badge warn">일시중지</span> : null}
        {showDomain && job.domain && <span className="mono small">{job.domain}</span>}
      </div>
      <div className="row" style={{ gap: 6 }}>
        {(job.status === "queued" || job.status === "running") && <>
          {job.status === "queued" && (job.paused
            ? <button className="btn primary" style={CTL_STYLE} disabled={acting} onClick={(e) => ctl(e, resumeJob)}>▶ 재개</button>
            : <button className="btn" style={CTL_STYLE} disabled={acting} onClick={(e) => ctl(e, pauseJob)}>⏸ 일시중지</button>)}
          {job.status === "queued" && <button className="btn" style={CTL_STYLE} disabled={acting} onClick={(e) => ctl(e, prioritizeJob)}>⏫ 먼저 실행</button>}
          <button className="btn danger" style={CTL_STYLE} disabled={acting || Boolean(job.cancel_requested)} onClick={(e) => ctl(e, cancelJob)}>{job.cancel_requested ? "취소 중..." : "✕ 취소"}</button>
        </>}
        <span className="muted small">{formatDateTime(job.scheduled_at)}</span>
      </div>
    </summary>
    <div className="card-pad grid" style={{ borderTop: "1px solid var(--line)" }}>
      <div className="progress"><span style={{ width: `${percent}%` }} /></div>
      <div className="grid grid-4">
        <Stat label="대상" value={total} />
        <Stat label="성공" value={ok} accent />
        <Stat label="실패" value={fail} />
        <Stat label="진행률" value={percent} suffix="%" />
      </div>
      <div className="writer-hint">
        <b>작업 옵션</b>
        <span>엔진 {String(job.payload_obj?.provider ?? "codex")}</span>
        <span>모델 {String(job.payload_obj?.model || "기본")}</span>
        <span>디자인 {String(job.payload_obj?.design_template_id ?? designFallback ?? "local-guide")}</span>
        <span>웹자료 {job.payload_obj?.use_web_research === false ? "미사용" : "사용"}</span>
        <span>이미지 {job.payload_obj?.enable_image_generation ? `생성 / ${String(job.payload_obj?.image_size || "1024x1024")}` : "미사용"}</span>
      </div>
      <p className="muted small">예약 {formatDateTime(job.scheduled_at)} · 시작 {formatDateTime(job.started_at)} · 완료 {formatDateTime(job.finished_at)} · 대기 {String(job.payload_obj?.cooldown_sec ?? "-")}초 · 제한 {String(job.payload_obj?.timeout_sec ?? "-")}초</p>
      {slotIds.length > 0 && <p className="muted small mono">슬롯 {slotIds.slice(0, 8).join(", ")}{slotIds.length > 8 ? ` 외 ${slotIds.length - 8}개` : ""}</p>}
      {job.kind === "generate" && job.domain && (
        <Link href={`/t/${encodeURIComponent(job.domain)}/posts?job=${encodeURIComponent(job.id)}`} className="btn" style={{ justifySelf: "start" }}>이 작업으로 만든 글 보기</Link>
      )}
      {job.error && <p className="toast-error">{job.error}</p>}
      {job.result_obj?.per_slot && <details><summary className="small muted">개별 결과 보기</summary><pre className="codebox small">{JSON.stringify(job.result_obj.per_slot, null, 2)}</pre></details>}
      <details><summary className="small muted">원본 payload/result</summary><pre className="codebox small">{JSON.stringify({ payload: job.payload_obj, result: job.result_obj }, null, 2)}</pre></details>
    </div>
  </details>;
}

export function jobTotal(job: Job): number {
  if (Array.isArray(job.payload_obj?.slot_ids)) return job.payload_obj.slot_ids.length;
  return num(job.result_obj?.total_posts ?? job.result_obj?.total ?? job.payload_obj?.max) || 1;
}

export function jobLabel(job: Job): string {
  if (job.kind === "generate") return `${jobTotal(job)}개 글 작성`;
  if (job.kind === "dedup") return "중복 검사";
  if (job.kind === "prune") return "품질 가지치기";
  if (job.kind === "indexing") return "Google 색인 요청";
  return job.kind;
}

function num(value: unknown): number { const n = Number(value); return Number.isFinite(n) ? n : 0; }

function JobStatusBadge({ status }: { status: string }) {
  const cls = status === "done" ? "success" : status === "failed" ? "danger" : status === "running" ? "info" : "warn";
  return <span className={`badge ${cls}`}>{status}</span>;
}

function Stat({ label, value, accent, suffix }: { label: string; value: number; accent?: boolean; suffix?: string }) {
  return <div className="card stat"><div className="muted small">{label}</div><div className="num" style={{ color: accent ? "var(--success)" : undefined }}>{value}{suffix}</div></div>;
}
