"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cancelJob, pauseJob, prioritizeJob, resumeJob } from "@/lib/api";
import { isJobCollapsed, setJobCollapsed } from "@/lib/collapsed-jobs";
import { formatDateTime, parseUtcTimestamp } from "@/lib/date";
import { designSettingLabel } from "@/lib/design-theme";
import type { Job } from "@/lib/types";

const CTL_STYLE = { minHeight: 34, padding: "7px 14px", fontSize: 13, fontWeight: 800 } as const;

// 작업 큐 카드 — 도메인 작업 큐 화면과 도메인 관리 > 작업 탭이 공유하는 상세 뷰.
// 차이는 컨텍스트뿐이므로 showDomain 으로 도메인 링크 노출만 토글한다.
export function JobCard({ job, showDomain = false, designFallback, onChanged }: { job: Job; showDomain?: boolean; designFallback?: string; onChanged?: () => void }) {
  const [acting, setActing] = useState(false);
  // 진행 중·실패는 펼쳐서 보여준다. 단 사용자가 접었으면 그 선택을 따른다(collapsed-jobs).
  // 초기값은 prop 에서만 계산한다 — localStorage 는 서버 렌더에서 못 읽으므로 마운트 후 보정한다
  // (lib/tour.ts 의 useTourEnabled 와 같은 방식).
  const autoOpen = job.status === "running" || job.status === "failed";
  const [open, setOpen] = useState(autoOpen);
  useEffect(() => { setOpen(autoOpen && !isJobCollapsed(job.id)); }, [autoOpen, job.id]);
  const ctl = (e: React.MouseEvent, fn: (id: string) => Promise<unknown>, confirmMessage: string) => {
    e.preventDefault(); e.stopPropagation();
    if (acting || !window.confirm(confirmMessage)) return; setActing(true);
    fn(job.id).then(() => onChanged?.()).catch((err) => alert(err instanceof Error ? err.message : String(err))).finally(() => setActing(false));
  };
  const total = jobTotal(job);
  const ok = num(job.result_obj?.ok);
  const fail = num(job.result_obj?.fail);
  const skipped = num(job.result_obj?.skipped);
  const done = ok + fail;
  const processed = Math.max(done, num(job.processed_count) + num(job.failed_count));
  const percent = job.status === "done" || job.status === "failed"
    ? 100
    : job.status === "running"
      ? Math.max(20, Math.min(90, Math.round((processed / Math.max(total, 1)) * 100) || 20))
      : 5;
  const slotIds = Array.isArray(job.payload_obj?.slot_ids) ? job.payload_obj.slot_ids : [];
  const activity = jobActivity(job);
  return <details
    className="card"
    open={open}
    onToggle={(e) => {
      const next = (e.currentTarget as HTMLDetailsElement).open;
      /*
        toggle 은 사용자 조작뿐 아니라 **React 가 open 을 적용할 때도** 발생한다. 그걸 구분하지
        않으면 마운트 순간의 자동 펼침이 "사용자가 펼쳤다"로 기록돼 접어 둔 기억을 지운다
        (실제로 그래서 다른 메뉴에 다녀오면 다시 펼쳐졌다). 프로그램에 의한 변경이면 React 의
        open 상태가 이미 그 값이므로, 다를 때만 사용자 조작이다.
      */
      if (next === open) return;
      setOpen(next);
      // 접은 것만 기억한다. 펼치면 기억에서 지워져 기본(펼침)으로 돌아간다.
      setJobCollapsed(job.id, !next);
    }}
  >
    <summary className="spread" style={{ padding: 16, cursor: "pointer" }}>
      <div className="row">
        <JobStatusBadge status={job.status} />
        <b>{job.kind}</b>
        <span className="muted small">{jobLabel(job)}</span>
        {job.paused ? <span className="badge warn">일시중지</span> : null}
        {job.cancel_requested ? <span className="badge danger">취소 요청됨</span> : null}
        {activity.stale ? <span className="badge warn">진행 확인 필요</span> : null}
        {showDomain && job.domain && <span className="mono small">{job.domain}</span>}
      </div>
      <div className="row" style={{ gap: 6 }}>
        {(job.status === "queued" || job.status === "running") && <>
          {job.status === "queued" && (job.paused
            ? <button className="btn primary" style={CTL_STYLE} disabled={acting} onClick={(e) => ctl(e, resumeJob, `${jobLabel(job)} 작업을 재개할까요?`)}>▶ 재개</button>
            : <button className="btn" style={CTL_STYLE} disabled={acting} onClick={(e) => ctl(e, pauseJob, `${jobLabel(job)} 작업을 일시중지할까요?`)}>⏸ 일시중지</button>)}
          {job.status === "queued" && <button className="btn" style={CTL_STYLE} disabled={acting} onClick={(e) => ctl(e, prioritizeJob, `${jobLabel(job)} 작업을 먼저 실행하도록 순서를 변경할까요?`)}>⏫ 먼저 실행</button>}
          <button className="btn danger" style={CTL_STYLE} disabled={acting || Boolean(job.cancel_requested)} onClick={(e) => ctl(e, cancelJob, `${jobLabel(job)} 작업을 취소할까요?\n\n진행 중인 작업은 현재 처리 중인 글이 끝난 뒤 취소될 수 있습니다.`)}>{job.cancel_requested ? "취소 중..." : "✕ 취소"}</button>
        </>}
        <span className="muted small">{formatDateTime(job.scheduled_at)}</span>
      </div>
    </summary>
    <div className="card-pad grid" style={{ borderTop: "1px solid var(--line)" }}>
      <div className="progress"><span style={{ width: `${percent}%` }} /></div>
      <div className="grid grid-5">
        <Stat label="대상" value={total} />
        <Stat label="성공" value={ok} accent />
        <Stat label="실패" value={fail} />
        <Stat label="스킵" value={skipped} />
        <Stat label="진행률" value={percent} suffix="%" />
      </div>
      <div className="writer-hint">
        <b>실행 상태</b>
        <span>{activity.label}</span>
        {job.current_step && <span>단계 {job.current_step}</span>}
        {job.current_slot_id && <span>현재 후보 <b className="mono">{job.current_slot_id}</b></span>}
        <span>마지막 활동 {activity.lastSeen}</span>
        <span>처리 {processed}/{total}</span>
      </div>
      <div className="writer-hint">
        <b>작업 옵션</b>
        <span>엔진 {String(job.payload_obj?.provider ?? "codex")}</span>
        <span>모델 {String(job.payload_obj?.model || "기본")}</span>
        <span>디자인 {designSettingLabel(String(job.payload_obj?.design_template_id ?? designFallback ?? "") || null)}</span>
        <span>웹자료 {job.payload_obj?.use_web_research === false ? "미사용" : "사용"}</span>
        <span>이미지 {job.payload_obj?.enable_image_generation ? `생성 / ${String(job.payload_obj?.image_size || "1024x1024")}` : "미사용"}</span>
      </div>
      <p className="muted small">예약 {formatDateTime(job.scheduled_at)} · 시작 {formatDateTime(job.started_at)} · 완료 {formatDateTime(job.finished_at)} · 대기 {String(job.payload_obj?.cooldown_sec ?? "-")}초 · 제한 {String(job.payload_obj?.timeout_sec ?? "-")}초</p>
      {slotIds.length > 0 && <p className="muted small mono">후보 {slotIds.slice(0, 8).join(", ")}{slotIds.length > 8 ? ` 외 ${slotIds.length - 8}개` : ""}</p>}
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

function jobActivity(job: Job): { label: string; lastSeen: string; stale: boolean } {
  if (job.status === "queued") return { label: job.paused ? "대기 중지" : "대기열에 있음", lastSeen: "-", stale: false };
  if (job.status === "done") return { label: "완료", lastSeen: formatDateTime(job.finished_at ?? job.heartbeat_at), stale: false };
  if (job.status === "failed") return { label: job.cancel_requested ? "취소/실패 처리됨" : "실패", lastSeen: formatDateTime(job.finished_at ?? job.heartbeat_at), stale: false };
  const heartbeat = parseUtcTimestamp(job.heartbeat_at ?? job.started_at);
  if (!heartbeat) return { label: "작업자 처리 중", lastSeen: "-", stale: false };
  const ageSec = Math.max(0, Math.round((Date.now() - heartbeat.getTime()) / 1000));
  const staleAfterSec = Math.max(180, num(job.payload_obj?.timeout_sec) + 60);
  const stale = ageSec >= staleAfterSec;
  return {
    label: job.cancel_requested ? "취소 요청 처리 대기" : stale ? "최근 활동 지연" : "작업자 처리 중",
    lastSeen: ageLabel(ageSec),
    stale,
  };
}

function ageLabel(ageSec: number): string {
  if (ageSec < 10) return "방금";
  if (ageSec < 60) return `${ageSec}초 전`;
  const min = Math.floor(ageSec / 60);
  if (min < 60) return `${min}분 전`;
  return `${Math.floor(min / 60)}시간 전`;
}

function JobStatusBadge({ status }: { status: string }) {
  const cls = status === "done" ? "success" : status === "failed" ? "danger" : status === "running" ? "info" : "warn";
  return <span className={`badge ${cls}`}>{status}</span>;
}

function Stat({ label, value, accent, suffix }: { label: string; value: number; accent?: boolean; suffix?: string }) {
  return <div className="card stat"><div className="muted small">{label}</div><div className="num" style={{ color: accent ? "var(--success)" : undefined }}>{value}{suffix}</div></div>;
}
