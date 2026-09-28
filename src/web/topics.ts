import type { Hono } from "hono";
import { html } from "hono/html";
import { type AppContext, COLLECT_KIND, GENERATE_KIND } from "../app.ts";
import { CHANNELS, findChannel } from "../channels.ts";
import { regionLabel } from "../keywords/regions.ts";
import { articleTypeLabel } from "../topics/intent.ts";
import {
  getTopic,
  listTopics,
  setTopicProgress,
  setTopicStatus,
  TOPIC_STATUSES,
  type TopicStatus,
} from "../topics/store.ts";
import { badge, page, statusTone, TOPIC_STATUS_LABEL } from "./layout.ts";

const NOTICES: Record<string, string> = {
  queued: "생성을 예약했습니다. 생성 간격·사용량 한도에 맞춰 순서대로 작성합니다.",
  collect: "키워드 수집을 작업 큐에 넣었습니다. 잠시 뒤 새로고침하세요.",
  status: "상태를 바꿨습니다.",
};

export function mountTopics(app: Hono, ctx: AppContext): void {
  app.get("/topics", (c) => {
    const channelId = c.req.query("channel") || CHANNELS[0].id;
    const channel = findChannel(channelId) ?? CHANNELS[0];
    const sectionCode = c.req.query("section") || "";
    const statusQ = c.req.query("status") ?? "candidate";
    const status = TOPIC_STATUSES.includes(statusQ as TopicStatus)
      ? (statusQ as TopicStatus)
      : undefined;
    const topics = listTopics(ctx.db, {
      channelId: channel.id,
      sectionCode: sectionCode || undefined,
      status,
      limit: 200,
    });
    const lastCollect = ctx.db.get<{ finished_at: string | null; status: string }>(
      "SELECT finished_at, status FROM jobs WHERE kind = ? ORDER BY id DESC LIMIT 1",
      [COLLECT_KIND],
    );

    const body = html`
<h1>주제</h1>
<p class="lead">네이버 최근 30일 검색 수로 만든 주제 후보입니다. 점수가 높은 순으로 보이며, 생성을 예약하면 워커가 순서대로 씁니다.</p>
<section class="card">
  <header>
    <form class="filters" method="get" action="/topics">
      <select name="channel" onchange="this.form.submit()">
        ${CHANNELS.map((ch) => html`<option value="${ch.id}" ${ch.id === channel.id ? "selected" : ""}>${ch.label}</option>`)}
      </select>
      <select name="section" onchange="this.form.submit()">
        <option value="">모든 섹션</option>
        ${channel.sections.map((s) => html`<option value="${s.code}" ${s.code === sectionCode ? "selected" : ""}>${s.label}</option>`)}
      </select>
      <select name="status" onchange="this.form.submit()">
        <option value="">모든 상태</option>
        ${TOPIC_STATUSES.map((s) => html`<option value="${s}" ${s === status ? "selected" : ""}>${TOPIC_STATUS_LABEL[s]}</option>`)}
      </select>
    </form>
    <form method="post" action="/topics/collect" class="inline">
      <span class="muted">${lastCollect ? `마지막 수집: ${lastCollect.finished_at ? new Date(lastCollect.finished_at).toLocaleString("ko-KR") : "진행 중"}` : "아직 수집 기록 없음"}</span>
      <button type="submit">키워드 수집 실행</button>
    </form>
  </header>
  <div class="table-wrap"><table>
    <tr><th>점수</th><th>대표 키워드</th><th>유형</th><th>지역</th><th class="num">30일 검색</th><th>상태</th><th></th></tr>
    ${topics.map(
      (t) => html`<tr>
        <td class="num">${t.score.toFixed(2)}</td>
        <td><b>${t.primaryKeyword}</b><div class="muted">${t.secondaryKeywords.slice(0, 4).join(", ")}</div></td>
        <td>${articleTypeLabel(t.articleType)}</td>
        <td>${t.region ? regionLabel(t.region) : html`<span class="muted">전국</span>`}</td>
        <td class="num">${t.volume.toLocaleString()}</td>
        <td>${badge(TOPIC_STATUS_LABEL[t.status] ?? t.status, statusTone(t.status))}</td>
        <td class="actions">
          ${t.status !== "queued" ? html`<form class="inline" method="post" action="/topics/${t.id}/generate"><button class="small primary">생성 예약</button></form>` : ""}
          ${t.status === "candidate" ? html`<form class="inline" method="post" action="/topics/${t.id}/status"><input type="hidden" name="status" value="skipped"><button class="small">건너뛰기</button></form>` : ""}
          ${t.status === "skipped" ? html`<form class="inline" method="post" action="/topics/${t.id}/status"><input type="hidden" name="status" value="candidate"><button class="small">되살리기</button></form>` : ""}
        </td>
      </tr>`,
    )}
  </table></div>
  ${topics.length ? "" : html`<p class="muted">조건에 맞는 주제가 없습니다. 키워드 수집을 실행하세요.</p>`}
</section>`;
    return c.html(
      page("주제", body, { current: "/topics", notice: NOTICES[c.req.query("done") ?? ""] }),
    );
  });

  const back = (c: { req: { header(name: string): string | undefined } }, done: string) => {
    const ref = c.req.header("referer");
    const url = new URL(ref?.includes("/topics") ? ref : "http://local/topics");
    url.searchParams.set("done", done);
    return `${url.pathname}${url.search}`;
  };

  app.post("/topics/collect", (c) => {
    ctx.queue.enqueue(COLLECT_KIND);
    return c.redirect(back(c, "collect"), 303);
  });

  app.post("/topics/:id/generate", (c) => {
    const topic = getTopic(ctx.db, Number(c.req.param("id")));
    if (!topic) return c.text("주제가 없습니다", 404);
    if (topic.status !== "queued") {
      setTopicProgress(ctx.db, topic.id, "queued");
      ctx.queue.enqueue(GENERATE_KIND, { topicId: topic.id });
    }
    return c.redirect(back(c, "queued"), 303);
  });

  app.post("/topics/:id/status", async (c) => {
    const form = await c.req.parseBody();
    const status = form.status === "skipped" ? "skipped" : "candidate";
    setTopicStatus(ctx.db, Number(c.req.param("id")), status);
    return c.redirect(back(c, "status"), 303);
  });
}
