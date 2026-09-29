import type { Hono } from "hono";
import { html } from "hono/html";
import type { AppContext } from "../app.ts";
import { getArticle } from "../articles/store.ts";
import { findChannel } from "../channels.ts";
import { PUBLISH_KIND } from "../publish/publisher.ts";
import { articleTypeLabel } from "../topics/intent.ts";
import { getTopic } from "../topics/store.ts";
import { badge, JOB_STATUS_LABEL, page, shortTime, statusTone } from "./layout.ts";

const KIND_LABEL: Record<string, string> = {
  generate: "글 생성",
  collect_keywords: "키워드 수집",
  sync_sources: "원천 자료 갱신",
  [PUBLISH_KIND]: "자동 발행",
};

export function mountJobs(app: Hono, ctx: AppContext): void {
  app.get("/jobs", (c) => {
    const jobs = ctx.queue.list(100);
    // 채널·유형은 만들어진 글이 있으면 글에서, 아직 없으면 주제에서 읽는다.
    const describe = (payload: unknown, result: unknown) => {
      const p = payload as { topicId?: number; articleId?: number } | null;
      const r = result as { articleId?: number } | null;
      const articleId = r?.articleId ?? p?.articleId;
      const article = articleId ? getArticle(ctx.db, articleId) : undefined;
      const topic = p?.topicId ? getTopic(ctx.db, p.topicId) : undefined;
      const channelId = article?.channelId ?? topic?.channelId;
      const articleType = article?.articleType ?? topic?.articleType;
      const title = topic
        ? topic.primaryKeyword
        : p?.topicId
          ? `주제 #${p.topicId}`
          : (article?.title ?? "");
      return {
        channel: channelId ? (findChannel(channelId)?.label ?? channelId) : "",
        type: articleType ? articleTypeLabel(articleType) : "",
        content: html`${title}${articleId ? html` → <a href="/articles/${articleId}">글 #${articleId}</a>` : ""}`,
      };
    };
    const results = new Map(
      ctx.db
        .all<{ id: number; result: string | null }>(
          "SELECT id, result FROM jobs ORDER BY id DESC LIMIT 100",
        )
        .map((r) => [r.id, r.result ? JSON.parse(r.result) : null]),
    );
    const body = html`
<h1>작업</h1>
<p class="lead">워커는 한 번에 한 작업씩 처리합니다. 글 생성은 생성 간격·하루 한도·LLM 사용량을 지키며, 한도에 걸리면 실패가 아니라 대기로 남습니다.</p>
<section class="card"><div class="table-wrap"><table>
  <tr><th>#</th><th>종류</th><th>채널</th><th>유형</th><th>내용</th><th>상태</th><th>시도</th><th>예정·완료</th><th>메모</th><th></th></tr>
  ${jobs.map((j) => {
    const d = describe(j.payload, results.get(j.id));
    return html`<tr>
      <td>${j.id}</td>
      <td>${KIND_LABEL[j.kind] ?? j.kind}</td>
      <td>${d.channel}</td>
      <td>${d.type}</td>
      <td>${d.content}</td>
      <td>${badge(JOB_STATUS_LABEL[j.status] ?? j.status, statusTone(j.status))}</td>
      <td class="num">${j.attempts}/${j.maxAttempts}</td>
      <td class="muted">${j.status === "queued" ? `${shortTime(j.runAfter)} 이후` : shortTime(j.finishedAt)}</td>
      <td class="muted">${j.waitReason || (j.error ? j.error.slice(0, 160) : "")}</td>
      <td>${j.status === "queued" ? html`<form class="inline" method="post" action="/jobs/${j.id}/cancel"><button class="small danger">취소</button></form>` : ""}</td>
    </tr>`;
  })}
</table></div>
${jobs.length ? "" : html`<p class="muted">작업이 없습니다.</p>`}
</section>`;
    return c.html(page("작업", body, { current: "/jobs" }));
  });

  app.post("/jobs/:id/cancel", (c) => {
    const job = ctx.queue.get(Number(c.req.param("id")));
    if (job && ctx.queue.cancel(job.id)) {
      const topicId = (job.payload as { topicId?: number })?.topicId;
      // 취소한 생성 작업의 주제는 다시 후보로 돌린다
      if (topicId)
        ctx.db.run("UPDATE topics SET status = 'candidate' WHERE id = ? AND status = 'queued'", [
          topicId,
        ]);
    }
    return c.redirect("/jobs", 303);
  });
}
