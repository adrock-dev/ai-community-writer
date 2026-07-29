"use client";

import Link from "next/link";

// 연동 설정(구글 색인)은 도메인 관리 > 설정 탭으로 이동됐고, 현재 비활성(추후 지원 예정) 상태다.
// 이 페이지는 옛 /integrations 경로 접근 시 새 위치를 안내하는 스텁으로만 남긴다.
export default function IntegrationSettingsClient() {
  return (
    <div>
      <div className="page-head">
        <div>
          <p className="eyebrow">관리자</p>
          <h1>연동 설정</h1>
          <p className="muted">구글 색인 설정은 도메인 관리 &gt; 설정 탭으로 이동되었습니다. 현재는 비활성(추후 지원 예정) 상태입니다.</p>
        </div>
      </div>
      <section className="card card-pad grid" style={{ maxWidth: 720 }}>
        <p className="muted small" style={{ margin: 0 }}>배포 연동 방식이 정해지면 색인 기능을 활성화할 예정입니다. 그 전까지는 별도 연동 설정이 없습니다.</p>
        <div className="row"><Link className="btn" href="/">대시보드로</Link></div>
      </section>
    </div>
  );
}
