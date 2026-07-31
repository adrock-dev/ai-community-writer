"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { listAdminNotes, createAdminNote, updateAdminNote, deleteAdminNote, importAdminNotes, type AdminNote } from "@/lib/api";

/**
 * 인수인계 메모 — 가이드 문서가 담지 못하는 것을 사람이 적는 자리.
 *
 * **가이드와 섞이지 않게 만든다.** 가이드는 저장소 파일이 정본이고 verify:doc-sync 가 코드와
 * 대조하는 '확정된 사실'이지만, 이건 검증할 수 없는 판단이다. 화면에서도 그 차이가 보이도록
 * 작성 시점을 항상 붙이고, 확인이 끝난 것은 「해결됨」으로 내려 남은 것만 눈에 띄게 한다.
 */
// 삭제는 되돌릴 수 없다. 「해결됨」이 보관 자리이므로, 지우기 전에 그 차이를 알린다 —
// 정리하려던 사람이 기록까지 없애는 일이 없도록.
const DELETE_CONFIRM =
  "이 메모를 삭제할까요?\n\n삭제하면 복구할 수 없고 어디에도 남지 않습니다.\n기록을 남기려면 「해결됨으로」를 쓰세요 — 아래 「해결됨」에 보관됩니다.";

function download(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** 사람이 읽는 인수인계용. 확인 필요한 것을 먼저, 「꼭 볼 것」에 표시를 남긴다. */
function toMarkdown(notes: AdminNote[]): string {
  const section = (title: string, rows: AdminNote[]) =>
    rows.length
      ? `## ${title}\n\n${rows
          .map((n) => [
            `### ${n.pinned ? "★ " : ""}${n.title}`,
            n.body ? `\n${n.body}\n` : "",
            `\n_적은 날 ${n.created_at}${n.resolved_at ? ` · 해결 ${n.resolved_at}` : ""}_\n`,
          ].join(""))
          .join("\n")}`
      : "";
  return [
    "# 인수인계 메모",
    "",
    "> 관리자 화면(설정 › 관리자 가이드 › 인수인계 메모)에서 내보냈다.",
    "> 가이드 문서와 달리 **코드와 대조되지 않은 사람의 판단**이므로 적은 날짜와 함께 읽는다.",
    "",
    section("확인 필요", notes.filter((n) => n.status === "open")),
    section("해결됨", notes.filter((n) => n.status === "resolved")),
  ].filter(Boolean).join("\n");
}

export default function AdminNotesClient() {
  const [notes, setNotes] = useState<AdminNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", body: "" });
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      setNotes((await listAdminNotes()).items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try { await action(); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  const open = notes.filter((n) => n.status === "open");
  const resolved = notes.filter((n) => n.status === "resolved");

  return (
    <div className="grid">
      <div>
        <Link className="eyebrow" href="/guides">← 관리자 가이드</Link>
        <h1>인수인계 메모</h1>
        <p className="muted">
          가이드 문서에 없는 것 — 아직 확인하지 못한 우려, 다음 사람이 짚어야 할 것 — 을 적습니다.
          가이드는 저장소 문서라 코드와 대조되지만 <b>메모는 검증되지 않은 판단</b>이라 작성 시점을 함께 봅니다.
        </p>
      </div>

      <div className="card card-pad grid">
        <h2>새 메모</h2>
        <label>
          <span className="label">제목</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 색인 제출이 아직 구현되지 않았음" />
        </label>
        <label>
          <span className="label">내용 (선택)</span>
          <textarea className="textarea" rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="무엇을 확인해야 하는지, 왜 걱정되는지, 지금 어떤 상태인지" />
        </label>
        {/* 적는 순간이 가장 판단이 선명하다 — 나중에 목록에서 다시 찾아 누르게 하지 않는다. */}
        <label className="row" style={{ gap: 6, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          <span className="small">꼭 볼 것으로 표시 — 목록 맨 위에 둡니다</span>
        </label>
        <div className="row">
          <button
            className="btn primary"
            disabled={!title.trim() || busy}
            onClick={() => run(async () => {
              await createAdminNote(title.trim(), body.trim(), pinned);
              setTitle(""); setBody(""); setPinned(false);
            })}
          >
            {busy ? "저장 중..." : "메모 추가"}
          </button>
        </div>
      </div>

      {/* 메모는 DB 에만 있고 저장소가 아니라 git 이 따라가지 않는다. 원천이 없어 DB 가 날아가면
          끝이므로 파일이 유일한 보험이다(docs/data-portability.md). */}
      <div className="card card-pad grid">
        <h2>내보내기 · 가져오기</h2>
        <p className="muted small" style={{ margin: 0 }}>
          메모는 저장소가 아니라 <b>DB에만</b> 있습니다. DB를 초기화하거나 다른 경로로 옮기면 사라지고,
          가이드 문서와 달리 <b>다시 받아올 원천이 없습니다</b>. 인수인계 전이나 이전 전에 내보내 두세요.
        </p>
        <div className="row">
          <button className="btn" disabled={busy || !notes.length} onClick={() => download("인수인계-메모.md", toMarkdown(notes), "text/markdown;charset=utf-8")}>
            Markdown 내보내기
          </button>
          <button className="btn" disabled={busy || !notes.length} onClick={() => download("admin-notes.json", JSON.stringify(notes, null, 2), "application/json")}>
            JSON 내보내기
          </button>
          <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>JSON 가져오기</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              void run(async () => {
                const text = await file.text();
                let parsed: unknown;
                try { parsed = JSON.parse(text); } catch { throw new Error("JSON 파일이 아닙니다. 「JSON 내보내기」로 받은 파일을 올리세요."); }
                const items = Array.isArray(parsed) ? parsed : (parsed as { items?: unknown[] })?.items;
                if (!Array.isArray(items)) throw new Error("메모 배열을 찾지 못했습니다. 「JSON 내보내기」로 받은 파일을 올리세요.");
                const res = await importAdminNotes(items);
                alert(`가져오기 완료 — 추가 ${res.added}건 · 건너뜀 ${res.skipped}건(제목이 같은 메모).`);
              });
            }}
          />
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Markdown은 사람이 읽는 인수인계용, JSON은 다시 가져오기용입니다. 가져올 때 제목이 같은 메모는 건너뜁니다.
        </p>
      </div>

      {error && <p className="toast-warn">{error}</p>}
      {loading && <p className="muted">불러오는 중...</p>}

      <div className="card card-pad grid">
        <h2>확인 필요 {open.length > 0 && <span className="badge warn">{open.length}</span>}</h2>
        <p className="muted small" style={{ margin: 0 }}>
          「해결됨으로」를 누르면 아래 「해결됨」에 보관됩니다. 「삭제」는 복구할 수 없습니다.
        </p>
        {!loading && !open.length && <p className="muted small">확인이 필요한 메모가 없습니다.</p>}
        {open.map((note) => (
          <NoteRow
            key={note.id}
            note={note}
            busy={busy}
            editing={editing === note.id}
            draft={draft}
            onDraft={setDraft}
            onEdit={() => { setEditing(note.id); setDraft({ title: note.title, body: note.body }); }}
            onCancel={() => setEditing(null)}
            onSave={() => run(async () => { await updateAdminNote(note.id, draft); setEditing(null); })}
            onResolve={() => run(() => updateAdminNote(note.id, { status: "resolved" }))}
            onDelete={() => { if (confirm(DELETE_CONFIRM)) void run(() => deleteAdminNote(note.id)); }}
            onPin={() => run(() => updateAdminNote(note.id, { pinned: !note.pinned }))}
          />
        ))}
      </div>

      {resolved.length > 0 && (
        <div className="card card-pad grid" style={{ opacity: 0.75 }}>
          <h2>해결됨 <span className="badge success">{resolved.length}</span></h2>
          {resolved.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              busy={busy}
              editing={editing === note.id}
              draft={draft}
              onDraft={setDraft}
              onEdit={() => { setEditing(note.id); setDraft({ title: note.title, body: note.body }); }}
              onCancel={() => setEditing(null)}
              onSave={() => run(async () => { await updateAdminNote(note.id, draft); setEditing(null); })}
              onResolve={() => run(() => updateAdminNote(note.id, { status: "open" }))}
              onDelete={() => { if (confirm(DELETE_CONFIRM)) void run(() => deleteAdminNote(note.id)); }}
            onPin={() => run(() => updateAdminNote(note.id, { pinned: !note.pinned }))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NoteRow({ note, busy, editing, draft, onDraft, onEdit, onCancel, onSave, onResolve, onDelete, onPin }: {
  note: AdminNote;
  busy: boolean;
  editing: boolean;
  draft: { title: string; body: string };
  onDraft: (v: { title: string; body: string }) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onResolve: () => void;
  onDelete: () => void;
  onPin: () => void;
}) {
  const isOpen = note.status === "open";
  const pinned = Boolean(note.pinned);
  return (
    <div className="card card-pad grid" style={{ gap: 8 }}>
      {editing ? (
        <>
          <input className="input" value={draft.title} onChange={(e) => onDraft({ ...draft, title: e.target.value })} />
          <textarea className="textarea" rows={4} value={draft.body} onChange={(e) => onDraft({ ...draft, body: e.target.value })} />
          <div className="row">
            <button className="btn primary" disabled={!draft.title.trim() || busy} onClick={onSave}>저장</button>
            <button className="btn" disabled={busy} onClick={onCancel}>취소</button>
          </div>
        </>
      ) : (
        <>
          <div className="row" style={{ gap: 6, alignItems: "center" }}>
            {pinned && <span className="badge warn">꼭 볼 것</span>}
            <b>{note.title}</b>
          </div>
          {note.body && <p className="muted small" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{note.body}</p>}
          {/* 값이 아니라 **렌더된 문자열**로 견준다. 표시가 분 단위라 같은 분에 고치면 값은 달라도
              화면에는 같은 시각이 두 번 찍혀 노이즈만 된다. */}
          <p className="muted small" style={{ margin: 0 }}>
            {(() => {
              const createdAt = formatDate(note.created_at);
              const updatedAt = formatDate(note.updated_at);
              const resolvedAt = note.resolved_at ? formatDate(note.resolved_at) : "";
              return [
                `적은 날 ${createdAt}`,
                updatedAt !== createdAt ? `고친 날 ${updatedAt}` : "",
                resolvedAt && resolvedAt !== updatedAt ? `해결 ${resolvedAt}` : "",
              ].filter(Boolean).join(" · ");
            })()}
          </p>
          <div className="row">
            <button className="btn" disabled={busy} onClick={onPin} title="인수인계 때 먼저 봐야 할 메모를 맨 위로 올립니다.">
              {pinned ? "★ 꼭 볼 것 해제" : "☆ 꼭 볼 것"}
            </button>
            <button className="btn" disabled={busy} onClick={onResolve}>{isOpen ? "해결됨으로" : "다시 확인 필요로"}</button>
            <button className="btn" disabled={busy} onClick={onEdit}>수정</button>
            <button className="btn danger" disabled={busy} onClick={onDelete} title="복구할 수 없습니다. 기록을 남기려면 「해결됨으로」를 쓰세요.">삭제</button>
          </div>
        </>
      )}
    </div>
  );
}

// 서버가 UTC 로 저장하므로 'Z' 를 붙여 로컬 시각으로 읽는다.
function formatDate(value: string): string {
  const ms = Date.parse(`${value.replace(" ", "T")}Z`);
  return Number.isFinite(ms) ? new Date(ms).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" }) : value;
}
