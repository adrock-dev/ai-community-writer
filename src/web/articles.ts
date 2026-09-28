import type { Context, Hono } from "hono";
import { html, raw } from "hono/html";
import { type AppContext, GENERATE_KIND } from "../app.ts";
import {
  approveArticle,
  articleCounts,
  editArticle,
  markExported,
  markPublished,
  ReviewError,
  rejectArticle,
} from "../articles/review.ts";
import {
  ARTICLE_STATUSES,
  type Article,
  type ArticleStatus,
  getArticle,
  listArticles,
} from "../articles/store.ts";
import { CHANNELS, findChannel, findSection } from "../channels.ts";
import { renderExport, writeExportBundle } from "../export/bundle.ts";
import { markdownToHtml, stripTitle } from "../export/render.ts";
import { regionLabel } from "../keywords/regions.ts";
import { articleTypeLabel } from "../topics/intent.ts";
import { getTopic, setTopicProgress } from "../topics/store.ts";
import { ARTICLE_STATUS_LABEL, badge, type Html, page, shortTime, statusTone } from "./layout.ts";

const NOTICES: Record<string, string> = {
  saved: "저장하고 기계 검사를 다시 했습니다.",
  approved: "승인했습니다. 아래 내보내기에서 채널 형식으로 복사하거나 폴더로 내보내세요.",
  rejected: "반려했습니다.",
  regenerate: "이 글을 반려하고 같은 주제로 다시 생성을 예약했습니다.",
  published: "발행 완료로 기록했습니다.",
};

const channelLabel = (id: string) => findChannel(id)?.label ?? id;

function listPage(
  ctx: AppContext,
  status: ArticleStatus | undefined,
  channelId: string | undefined,
) {
  const counts = articleCounts(ctx.db);
  const articles = listArticles(ctx.db, { status, channelId, limit: 200 });
  const tab = (s: ArticleStatus | "", label: string, n?: number) => {
    const qs = new URLSearchParams({
      ...(s ? { status: s } : {}),
      ...(channelId ? { channel: channelId } : {}),
    });
    return html`<a class="${(status ?? "") === s ? "on" : ""}" href="/articles?${qs.toString()}">${label}${n !== undefined ? ` ${n}` : ""}</a>`;
  };
  return html`
<h1>글 검수</h1>
<p class="lead">사람이 승인한 글만 내보냅니다. 초안은 품질·사실 검사에서 문제가 남은 글이라 먼저 고쳐야 합니다.</p>
<section class="card">
  <div class="tabs">
    ${tab("review", "검수 대기", counts.review)}
    ${tab("draft", "초안", counts.draft)}
    ${tab("approved", "승인", counts.approved)}
    ${tab("exported", "내보냄", counts.exported)}
    ${tab("published", "발행", counts.published)}
    ${tab("rejected", "반려", counts.rejected)}
    ${tab("", "전체")}
  </div>
  <form class="filters" method="get" action="/articles">
    ${status ? html`<input type="hidden" name="status" value="${status}">` : ""}
    <select name="channel" onchange="this.form.submit()">
      <option value="">모든 채널</option>
      ${CHANNELS.map((ch) => html`<option value="${ch.id}" ${ch.id === channelId ? "selected" : ""}>${ch.label}</option>`)}
    </select>
  </form>
  <div class="table-wrap"><table>
    <tr><th>#</th><th>제목</th><th>채널</th><th>유형</th><th>상태</th><th>문제</th><th>생성</th></tr>
    ${articles.map(
      (a) => html`<tr>
        <td>${a.id}</td>
        <td><a href="/articles/${a.id}">${a.title}</a></td>
        <td>${channelLabel(a.channelId)}</td>
        <td>${articleTypeLabel(a.articleType)}</td>
        <td>${badge(ARTICLE_STATUS_LABEL[a.status] ?? a.status, statusTone(a.status))}</td>
        <td class="num">${a.qualityIssues.length || ""}</td>
        <td class="muted">${shortTime(a.createdAt)}</td>
      </tr>`,
    )}
  </table></div>
  ${articles.length ? "" : html`<p class="muted">글이 없습니다.</p>`}
</section>`;
}

function reviewCard(a: Article): Html {
  const canApprove = a.status === "draft" || a.status === "review";
  const canReject = ["draft", "review", "approved", "exported"].includes(a.status);
  return html`<section class="card">
  <header><h2>검수</h2>${badge(ARTICLE_STATUS_LABEL[a.status] ?? a.status, statusTone(a.status))}</header>
  ${
    canApprove
      ? html`<form method="post" action="/articles/${a.id}/approve">
      ${a.qualityIssues.length ? html`<label class="check"><input type="checkbox" name="acceptIssues" value="1"> 남은 문제를 확인했습니다</label>` : ""}
      <div class="field"><input type="text" name="note" placeholder="검수 메모 (선택)"></div>
      <button class="primary">승인</button>
    </form>`
      : ""
  }
  ${
    canReject
      ? html`<form method="post" action="/articles/${a.id}/reject" style="margin-top:12px">
      <div class="field"><input type="text" name="note" required placeholder="반려 사유 (필수)"></div>
      <div class="actions">
        <button class="danger" onclick="return confirm('이 글을 반려할까요?')">반려</button>
        ${a.topicId ? html`<button formaction="/articles/${a.id}/regenerate" onclick="return confirm('반려하고 같은 주제로 다시 생성할까요?')">반려 후 다시 생성</button>` : ""}
      </div>
    </form>`
      : ""
  }
  ${a.reviewNote ? html`<p class="muted">메모: ${a.reviewNote}</p>` : ""}
  ${a.publishedUrl ? html`<p>게시 URL: <a href="${a.publishedUrl}" target="_blank" rel="noopener">${a.publishedUrl}</a></p>` : ""}
</section>`;
}

function exportCard(a: Article, origin: string): Html {
  if (!["approved", "exported", "published"].includes(a.status)) {
    return html`<section class="card"><header><h2>내보내기</h2></header><p class="muted">승인한 뒤 내보낼 수 있습니다.</p></section>`;
  }
  const out = renderExport(a);
  // 서식 복사용 HTML의 삽화 주소는 이 PC 주소로 절대 경로화한다 (붙여 넣은 뒤 직접 업로드 필요)
  const rich = out.richHtml.replace(/src="\/images\//g, `src="${origin}/images/`);
  return html`<section class="card">
  <header><h2>내보내기</h2><span class="muted">${channelLabel(a.channelId)} 형식</span></header>
  ${out.fields.map(
    (f, i) => html`<div class="field"><label>${f.label}</label>
      <div class="copyrow"><input type="text" id="f${i}" value="${f.value}" readonly><button type="button" class="small" data-copy="f${i}">복사</button></div></div>`,
  )}
  <div class="field"><label>${out.primary.label}</label>
    <textarea id="primary" class="code" rows="8" readonly>${out.primary.content}</textarea>
    <div class="actions" style="margin-top:6px">
      <button type="button" data-copy="primary">본문 복사</button>
      <button type="button" data-copy-html="rich">서식 포함 복사 (에디터에 붙여넣기)</button>
    </div>
  </div>
  <div id="rich" hidden>${raw(rich)}</div>
  ${out.uploads.length ? html`<p class="muted">생성 삽화 ${out.uploads.length}장은 대상 사이트에 직접 올려야 합니다: ${out.uploads.join(", ")}</p>` : ""}
  <form method="post" action="/articles/${a.id}/export"><button>내보내기 폴더 만들기 (이미지 포함)</button></form>
  <form method="post" action="/articles/${a.id}/publish" style="margin-top:12px">
    <div class="field"><label>실제 게시 URL (발행 후 입력)</label>
      <div class="copyrow"><input type="url" name="url" required placeholder="https://" value="${a.publishedUrl}"><button>발행 완료</button></div></div>
  </form>
</section>`;
}

function detailPage(a: Article, origin: string): Html {
  const channel = findChannel(a.channelId);
  const section = findSection(a.channelId, a.sectionCode);
  const attempts =
    (a.generation.attempts as { attempt: number; issues: string[]; factChecked?: boolean }[]) ?? [];
  const warnings = (a.generation.warnings as string[]) ?? [];
  const editable = ["draft", "review", "approved"].includes(a.status);
  return html`
<p><a href="/articles?status=${a.status}">← ${ARTICLE_STATUS_LABEL[a.status] ?? "글"} 목록</a></p>
<h1>${a.title}</h1>
<p class="muted">
  ${channel?.label ?? a.channelId} · ${section?.label ?? a.sectionCode} · ${articleTypeLabel(a.articleType)}
  ${a.region ? ` · ${regionLabel(a.region)}` : ""} · ${a.provider} · 시도 ${attempts.length}회 · ${shortTime(a.createdAt)}
</p>
${
  a.qualityIssues.length
    ? html`<ul class="issues">${a.qualityIssues.map((i) => html`<li>${i}</li>`)}</ul>`
    : html`<p>${badge("품질·사실 검사 통과", "ok")}</p>`
}
<div class="split">
  <div>
    <section class="card"><header><h2>미리보기</h2><span class="muted">${a.summary}</span></header>
      <div class="article">${raw(markdownToHtml(stripTitle(a.body)))}</div>
    </section>
    ${
      editable
        ? html`<section class="card"><details ${a.status === "draft" ? "open" : ""}><summary><b>수정</b> <span class="muted">저장하면 기계 검사를 다시 하고, 승인했던 글은 검수 대기로 돌아갑니다</span></summary>
      <form method="post" action="/articles/${a.id}/edit" style="margin-top:12px">
        <div class="field"><label>제목</label><input type="text" name="title" value="${a.title}" required></div>
        <div class="field"><label>검색 결과 설명</label><textarea name="summary" rows="2">${a.summary}</textarea></div>
        <div class="field"><label>키워드 (쉼표로 구분)</label><input type="text" name="keywords" value="${a.keywords.join(", ")}"></div>
        <div class="field"><label>본문 (Markdown)</label><textarea name="body" class="code" rows="28">${a.body}</textarea></div>
        <button class="primary">저장</button>
      </form></details></section>`
        : ""
    }
  </div>
  <div>
    ${reviewCard(a)}
    ${exportCard(a, origin)}
    <section class="card"><header><h2>이미지</h2><span class="muted">${a.images.length}장</span></header>
      <div class="thumbs">${a.images.map((i) => html`<a href="${i.url}" target="_blank" rel="noopener" title="${i.alt}"><img src="${i.url}" alt="${i.alt}"></a>`)}</div>
      ${a.images.map((i) => html`<div class="muted">${i.id} · ${i.kind === "photo" ? "실제 사진" : "생성 삽화"} · ${i.alt}</div>`)}
    </section>
    <section class="card"><details><summary><b>근거 자료</b></summary><pre class="preview">${a.facts || "(없음)"}</pre></details></section>
    <section class="card"><details><summary><b>생성 기록</b></summary>
      ${attempts.map((t) => html`<div class="muted" style="margin-top:8px"><b>${t.attempt}차</b>${t.factChecked ? " · 사실 검증함" : ""} — ${t.issues.length ? t.issues.join(" / ") : "문제 없음"}</div>`)}
      ${warnings.map((w) => html`<div class="muted">⚠ ${w}</div>`)}
    </details></section>
    ${
      a.similarArticles.length
        ? html`<section class="card"><header><h2>비슷한 기존 글</h2></header>
        ${a.similarArticles.map((s) => html`<div class="muted"><a href="/articles/${s.articleId}">#${s.articleId} ${s.title}</a> · 본문 ${s.bodySim} · 제목 ${s.titleSim}${s.exceeded.length ? ` · 기준 초과: ${s.exceeded.join(", ")}` : ""}</div>`)}
      </section>`
        : ""
    }
  </div>
</div>`;
}

export function mountArticles(app: Hono, ctx: AppContext): void {
  app.get("/articles", (c) => {
    const s = c.req.query("status") ?? "review";
    const status = ARTICLE_STATUSES.includes(s as ArticleStatus) ? (s as ArticleStatus) : undefined;
    return c.html(
      page("글 검수", listPage(ctx, status, c.req.query("channel") || undefined), {
        current: "/articles",
      }),
    );
  });

  app.get("/articles/:id", (c) => {
    const article = getArticle(ctx.db, Number(c.req.param("id")));
    if (!article) return c.notFound();
    const origin = new URL(c.req.url).origin;
    return c.html(
      page(article.title, detailPage(article, origin), {
        current: "/articles",
        notice:
          NOTICES[c.req.query("done") ?? ""] ??
          (c.req.query("exported")
            ? `내보내기 폴더를 만들었습니다: ${c.req.query("exported")}`
            : undefined),
        error: c.req.query("error"),
      }),
    );
  });

  /** 검수 동작을 실행하고, 실패하면 오류를 화면에 보여 준다. */
  const act =
    (fn: (id: number, form: Record<string, unknown>, c: Context) => Promise<string> | string) =>
    async (c: Context) => {
      const id = Number(c.req.param("id"));
      const form = await c.req.parseBody();
      try {
        const done = await fn(id, form, c);
        return c.redirect(done.startsWith("/") ? done : `/articles/${id}?done=${done}`, 303);
      } catch (error) {
        if (!(error instanceof ReviewError)) throw error;
        return c.redirect(`/articles/${id}?error=${encodeURIComponent(error.message)}`, 303);
      }
    };

  app.post(
    "/articles/:id/edit",
    act((id, f) => {
      editArticle(ctx.db, id, {
        title: String(f.title ?? ""),
        summary: String(f.summary ?? ""),
        keywords: String(f.keywords ?? "")
          .split(/[,，]/)
          .map((k) => k.trim())
          .filter(Boolean),
        body: String(f.body ?? "").replace(/\r\n/g, "\n"),
      });
      return "saved";
    }),
  );

  app.post(
    "/articles/:id/approve",
    act((id, f) => {
      approveArticle(ctx.db, id, {
        acceptIssues: f.acceptIssues === "1",
        note: String(f.note ?? ""),
      });
      return "approved";
    }),
  );

  app.post(
    "/articles/:id/reject",
    act((id, f) => {
      rejectArticle(ctx.db, id, String(f.note ?? ""));
      return "rejected";
    }),
  );

  app.post(
    "/articles/:id/regenerate",
    act((id, f) => {
      const article = rejectArticle(ctx.db, id, `다시 생성: ${String(f.note ?? "")}`.trim());
      if (article.topicId && getTopic(ctx.db, article.topicId)) {
        setTopicProgress(ctx.db, article.topicId, "queued");
        ctx.queue.enqueue(GENERATE_KIND, { topicId: article.topicId });
      }
      return "regenerate";
    }),
  );

  app.post(
    "/articles/:id/export",
    act(async (id) => {
      const article = getArticle(ctx.db, id);
      if (!article) throw new ReviewError("글이 없습니다");
      markExported(ctx.db, id);
      const dir = await writeExportBundle(article);
      return `/articles/${id}?exported=${encodeURIComponent(dir)}`;
    }),
  );

  app.post(
    "/articles/:id/publish",
    act((id, f) => {
      markPublished(ctx.db, id, String(f.url ?? ""));
      return "published";
    }),
  );
}
