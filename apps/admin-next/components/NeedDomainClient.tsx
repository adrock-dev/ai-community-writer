"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { listDomains } from "@/lib/api";
import { DOMAIN_GATE_COPY, isDomainMenuFrom, type DomainMenuFrom } from "@/lib/domain-gate";
import { pickDefaultDomain } from "@/lib/domains";

export default function NeedDomainClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromParam = searchParams.get("from");
  const from: DomainMenuFrom = isDomainMenuFrom(fromParam) ? fromParam : "manage";
  const copy = DOMAIN_GATE_COPY[from];
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState("");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setApiError("");
    listDomains()
      .then((res) => {
        if (!mounted) return;
        const domain = pickDefaultDomain(res.items);
        if (!domain) {
          setLoading(false);
          return;
        }
        if (from === "manage") router.replace(`/t/${encodeURIComponent(domain.domain)}`);
        else if (from === "generate") router.replace(`/t/${encodeURIComponent(domain.domain)}/generate`);
        else router.replace(`/t/${encodeURIComponent(domain.domain)}/posts`);
      })
      .catch((err) => {
        if (!mounted) return;
        setApiError((err as Error).message || "도메인 목록을 불러오지 못했습니다.");
        setLoading(false);
      });
    return () => { mounted = false; };
  }, [from, router]);

  if (loading) {
    return <div className="card card-pad gate-card">확인 중...</div>;
  }

  return (
    <div className="gate-card card card-pad">
      <p className="eyebrow">{copy.menu}</p>
      <h1>{copy.title}</h1>
      <p className="muted">{copy.body}</p>

      {apiError && (
        <p className="toast-error" style={{ marginTop: 16 }}>
          API 연결 오류: {apiError}
          <br />
          <span className="small">백엔드가 실행 중인지, `SEO_API_BASE_URL` 설정을 확인하세요.</span>
        </p>
      )}

      <div className="gate-actions">
        <Link className="btn primary" href="/?create=domain">대시보드에서 도메인 만들기</Link>
        <Link className="btn" href="/">대시보드로 이동</Link>
      </div>
    </div>
  );
}
