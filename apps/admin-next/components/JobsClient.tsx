"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Job } from "@/lib/types";
import { JobCard } from "./JobCard";

/*
  이 화면은 전역이다 — 워커는 하나뿐이고 도메인을 가로질러 처리하므로, "지금 무엇이 돌고 있나"는
  도메인을 넘어서 봐야 정확하다(다른 도메인 잡이 큐를 점유해 내 작업이 안 시작되는 경우).
  그래서 사이드바에서도 「콘텐츠 운영」이 아니라 「작업 관리」 그룹에 있다.

  **도메인 필터는 두지 않는다.** 그 기능은 「도메인 관리」의 작업 큐 탭이 이미 한다. 전역 화면에
  같은 것을 겹쳐 두면 화면의 뜻이 흐려지고, 실제로 그 필터가 사고를 냈다 — 선택지를 (도메인
  목록이 아니라) 필터된 결과에서 뽑는 바람에, 한 도메인을 고르면 선택지도 그것만 남아 다른
  도메인으로 갈 수 없었다. 여기가 답하는 질문("누가 큐를 점유 중인가")은 필터를 걸지 않은
  상태라야 답할 수 있다.
*/
export default function JobsClient() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    qs.set("limit", "300");
    const res = await api<{ count: number; items: Job[] }>(`/jobs?${qs}`);
    setJobs(res.items);
  }, [status]);

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    const id = setInterval(() => refresh().catch(() => undefined), 3000);
    return () => clearInterval(id);
  }, [refresh]);

  return <div>
    <div className="page-head"><div><p className="eyebrow">3초마다 자동 새로고침</p><h1>작업 큐</h1><p className="muted">worker가 처리하는 generate/dedup/prune/indexing 작업 상태입니다.</p></div><button className="btn" onClick={() => void refresh()}>새로고침</button></div>
    {error && <p className="toast-error">{error}</p>}
    <div className="row" style={{ marginBottom: 8 }}>
      <select className="select" style={{ width: 160 }} value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">전체 상태</option><option>queued</option><option>running</option><option>done</option><option>failed</option>
      </select>
    </div>
    <p className="muted small" style={{ marginBottom: 16 }}>
      모든 도메인의 작업을 함께 보여줍니다. 워커가 하나라 순서대로 처리되므로, 내 작업이 시작되지 않을 때 앞선 작업을 여기서 확인합니다. 도메인별로만 보려면 「도메인 관리」의 작업 큐 탭을 씁니다.
    </p>
    <div className="grid">{jobs.length === 0 && <div className="card card-pad muted">작업 없음</div>}{jobs.map((j) => <JobCard key={j.id} job={j} showDomain onChanged={refresh} />)}</div>
  </div>;
}
