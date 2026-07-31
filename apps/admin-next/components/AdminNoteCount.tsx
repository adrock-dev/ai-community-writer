"use client";

import { useEffect, useState } from "react";
import { listAdminNotes } from "@/lib/api";

/**
 * 가이드 목록의 메모 카드에 붙는 「확인 필요 N건」.
 *
 * 가이드 목록 페이지는 서버 컴포넌트지만 이 숫자만 클라이언트에서 가져온다 — 서버에서 부르려면
 * 관리자 토큰을 직접 다뤄야 하는데, 그건 /api/admin 프록시가 맡는 일이다. 숫자 하나 때문에
 * 인증 경로를 두 벌로 만들지 않는다.
 *
 * 실패하면 조용히 아무것도 보여주지 않는다. 메모 개수를 못 읽었다고 가이드 목록 전체가
 * 오류처럼 보이면 안 된다.
 */
export default function AdminNoteCount() {
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    listAdminNotes()
      .then((res) => { if (alive) setOpen(res.items.filter((n) => n.status === "open").length); })
      .catch(() => { if (alive) setOpen(null); });
    return () => { alive = false; };
  }, []);

  if (open === null) return null;
  return open > 0
    ? <span className="badge warn">확인 필요 {open.toLocaleString()}건</span>
    : <span className="badge success">확인할 메모 없음</span>;
}
