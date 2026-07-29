"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, listDomains } from "@/lib/api";
import { DOMAINS_CHANGED_EVENT } from "@/lib/domain-events";
import { pickDefaultDomain } from "@/lib/domains";
import { getRecentDomain } from "@/lib/recent-domain";
import type { DomainConfig, Job } from "@/lib/types";
import { JobCard } from "./JobCard";

export default function JobsClient() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [domains, setDomains] = useState<DomainConfig[]>([]);
  const [status, setStatus] = useState("");
  // null = 운영 대상을 아직 못 정했다(도메인 목록 대기). "" = 「전체 도메인」.
  // 이 둘을 구분하지 않으면 목록이 오기 전에 전체 잡을 한 번 불러, 다른 도메인 작업이 깜빡 보인다.
  const [domain, setDomain] = useState<string | null>(null);
  const [error, setError] = useState("");
  // 사용자가 직접 고른 뒤에는 운영 대상이 바뀌어도 덮어쓰지 않는다.
  const pinned = useRef(false);

  /*
    선택지는 도메인 목록에서 가져온다. 예전에는 이미 필터된 jobs 에서 뽑았는데, 그러면 필터가
    자기 선택지를 먹었다 — 한 도메인을 고르면 목록이 그 도메인만 남고 선택지도 그것만 남아,
    다른 도메인으로 바로 가지 못하고 「전체 도메인」으로 되돌아가야 했다. 삭제된 도메인이
    jobs 에 남아 유령 선택지가 되던 것도 같이 사라진다.
  */
  const loadDomains = useCallback(async () => {
    const res = await listDomains().catch(() => null);
    if (!res) return;
    setDomains(res.items);
    if (pinned.current) return;
    // 사이드바 「운영 대상」과 같은 규칙으로 정한다(최근 접속 도메인 → 작업량 기준 기본 도메인).
    // 이 화면은 도메인 종속 메뉴들 사이에 있어서, 운영 대상이 적용될 것처럼 읽힌다.
    const remembered = getRecentDomain();
    const active = res.items.some((d) => d.domain === remembered) ? remembered : pickDefaultDomain(res.items)?.domain;
    setDomain(active ?? "");
  }, []);

  useEffect(() => {
    void loadDomains();
    const onChange = () => void loadDomains();
    window.addEventListener(DOMAINS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(DOMAINS_CHANGED_EVENT, onChange);
  }, [loadDomains]);

  const refresh = useCallback(async () => {
    if (domain === null) return;
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (domain) qs.set("domain", domain);
    qs.set("limit", "300");
    const res = await api<{ count: number; items: Job[] }>(`/jobs?${qs}`);
    setJobs(res.items);
  }, [status, domain]);

  useEffect(() => {
    if (domain === null) return;
    refresh().catch((e) => setError(e.message));
    const id = setInterval(() => refresh().catch(() => undefined), 3000);
    return () => clearInterval(id);
  }, [refresh, domain]);

  const selected = domains.find((d) => d.domain === domain);
  return <div>
    <div className="page-head"><div><p className="eyebrow">3초마다 자동 새로고침</p><h1>작업 큐</h1><p className="muted">worker가 처리하는 generate/dedup/prune/indexing 작업 상태입니다.</p></div><button className="btn" onClick={() => void refresh()}>새로고침</button></div>
    {error && <p className="toast-error">{error}</p>}
    <div className="row" style={{ marginBottom: 8 }}>
      <select className="select" style={{ width: 160 }} value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">전체 상태</option><option>queued</option><option>running</option><option>done</option><option>failed</option>
      </select>
      <select
        className="select"
        style={{ width: 240 }}
        value={domain ?? ""}
        onChange={(e) => { pinned.current = true; setDomain(e.target.value); }}
      >
        <option value="">전체 도메인</option>
        {domains.map((d) => <option key={d.domain} value={d.domain}>{d.display_name || d.domain}</option>)}
      </select>
    </div>
    {/* 워커는 하나이고 도메인을 가로질러 돈다. 지금 무엇으로 걸러 보고 있는지 밝혀 두지 않으면
        "왜 저 도메인 작업이 안 보이지"가 된다. 값에서 렌더하므로 코드가 바뀌어도 썩지 않는다. */}
    <p className="muted small" style={{ marginBottom: 16 }}>
      {domain
        ? <>운영 대상 「{selected?.display_name || domain}」 작업만 보고 있습니다. 워커는 모든 도메인 작업을 함께 처리하므로, 전체를 보려면 「전체 도메인」으로 바꾸세요.</>
        : <>모든 도메인의 작업을 보고 있습니다.</>}
    </p>
    <div className="grid">{jobs.length === 0 && <div className="card card-pad muted">작업 없음</div>}{jobs.map((j) => <JobCard key={j.id} job={j} showDomain onChanged={refresh} />)}</div>
  </div>;
}
