import Link from "next/link";
import { GUIDES, readGuide } from "@/lib/guides";
import AdminNoteCount from "@/components/AdminNoteCount";

// 서버 컴포넌트다 — 저장소의 docs/*.md 를 직접 읽는다(lib/guides 참조).
export default function GuidesPage() {
  const items = GUIDES.map((guide) => ({ guide, available: readGuide(guide) !== null }));
  return (
    <div className="grid">
      <div>
        <div className="eyebrow">설정</div>
        <h1>관리자 가이드</h1>
        <p className="muted">
          저장소의 문서를 그대로 읽어 보여줍니다. 화면용으로 따로 옮겨 적지 않으므로 문서를 고치면 여기도 함께 바뀝니다.
        </p>
      </div>

      {/* 메모는 가이드와 성격이 반대라(검증 안 되는 사람의 판단) 문서 카드와 섞지 않고 위에 따로 둔다. */}
      <div className="card card-pad grid">
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>인수인계 메모</h2>
          <span className="badge">사람이 적는 것</span>
          <AdminNoteCount />
        </div>
        <p className="muted small">
          아래 문서에 없는 것 — 아직 확인하지 못한 우려, 다음 사람이 짚어야 할 것 — 을 적어 둡니다.
          문서와 달리 코드와 대조되지 않으므로 적은 시점을 함께 봅니다.
        </p>
        <div className="row"><Link className="btn" href="/guides/notes">메모 열기</Link></div>
      </div>

      <div className="grid grid-2">
        {items.map(({ guide, available }) => (
          <div className="card card-pad grid" key={guide.slug}>
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <h2 style={{ margin: 0 }}>{guide.title}</h2>
              <span className="badge">{guide.audience}</span>
            </div>
            <p className="muted small">{guide.summary}</p>
            <code className="mono small">{guide.file}</code>
            {available ? (
              <div className="row"><Link className="btn primary" href={`/guides/${guide.slug}`}>열기</Link></div>
            ) : (
              <p className="toast-warn small">문서 파일을 찾지 못했습니다. 배포에 <code>docs/</code>가 포함됐는지 확인하세요.</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
