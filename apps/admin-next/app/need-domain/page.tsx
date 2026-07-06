import { Suspense } from "react";
import NeedDomainClient from "@/components/NeedDomainClient";

export default function NeedDomainPage() {
  return (
    <Suspense fallback={<div className="card card-pad gate-card">확인 중...</div>}>
      <NeedDomainClient />
    </Suspense>
  );
}
