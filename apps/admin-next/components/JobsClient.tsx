"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Job } from "@/lib/types";
import { JobCard } from "./JobCard";

export default function JobsClient() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [status, setStatus] = useState("");
  const [domain, setDomain] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (domain) qs.set("domain", domain);
    qs.set("limit", "300");
    const res = await api<{ count: number; items: Job[] }>(`/jobs?${qs}`);
    setJobs(res.items);
  }
  useEffect(() => { refresh().catch((e) => setError(e.message)); const id = setInterval(() => refresh().catch(() => undefined), 3000); return () => clearInterval(id); }, [status, domain]);

  const domains = useMemo(() => Array.from(new Set(jobs.map((j) => j.domain ?? ""))).sort(), [jobs]);
  return <div>
    <div className="page-head"><div><p className="eyebrow">3초마다 자동 새로고침</p><h1>작업 큐</h1><p className="muted">worker가 처리하는 generate/dedup/prune/indexing 작업 상태입니다.</p></div><button className="btn" onClick={refresh}>새로고침</button></div>
    {error && <p className="toast-error">{error}</p>}
    <div className="row" style={{ marginBottom: 16 }}><select className="select" style={{ width: 160 }} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">전체 상태</option><option>queued</option><option>running</option><option>done</option><option>failed</option></select><select className="select" style={{ width: 240 }} value={domain} onChange={(e) => setDomain(e.target.value)}><option value="">전체 도메인</option>{domains.map((t) => <option key={t}>{t}</option>)}</select></div>
    <div className="grid">{jobs.length === 0 && <div className="card card-pad muted">작업 없음</div>}{jobs.map((j) => <JobCard key={j.id} job={j} showDomain onChanged={refresh} />)}</div>
  </div>;
}
