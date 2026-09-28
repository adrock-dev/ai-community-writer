import { Hono } from "hono";
import { type AppContext, COLLECT_KIND } from "./app.ts";
import { CHANNELS } from "./channels.ts";
import { listTopics, setTopicStatus, TOPIC_STATUSES, type TopicStatus } from "./topics/store.ts";
import { mountGuideSettings } from "./web/guides.ts";

export function createApp(ctx: AppContext): Hono {
  const app = new Hono();

  app.get("/health", (c) => {
    const pace = ctx.pacer.blockedUntil();
    return c.json({
      ok: true,
      sourcesProfile: ctx.config.sources.profile,
      llm: ctx.llm.status(),
      pacing: pace ? { until: pace.until.toISOString(), reason: pace.reason } : null,
      jobs: ctx.queue.counts(),
      channels: CHANNELS.map((ch) => ({ id: ch.id, sections: ch.sections.map((s) => s.code) })),
    });
  });

  // 키워드 수집을 작업 큐에 넣는다. 결과는 작업이 끝난 뒤 /api/topics로 본다.
  app.post("/api/keywords/collect", (c) => c.json({ jobId: ctx.queue.enqueue(COLLECT_KIND) }, 202));

  app.get("/api/topics", (c) => {
    const status = c.req.query("status");
    if (status && !TOPIC_STATUSES.includes(status as TopicStatus)) {
      return c.json({ error: `status는 ${TOPIC_STATUSES.join(", ")} 중 하나` }, 400);
    }
    return c.json(
      listTopics(ctx.db, {
        channelId: c.req.query("channel"),
        sectionCode: c.req.query("section"),
        status: status as TopicStatus | undefined,
        limit: Number(c.req.query("limit")) || undefined,
      }),
    );
  });

  app.patch("/api/topics/:id", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { status?: string; note?: string };
    if (body.status !== "candidate" && body.status !== "skipped") {
      return c.json({ error: "status는 candidate 또는 skipped" }, 400);
    }
    const ok = setTopicStatus(ctx.db, Number(c.req.param("id")), body.status, body.note);
    return ok ? c.json({ ok }) : c.json({ error: "바꿀 수 없는 주제입니다" }, 409);
  });

  mountGuideSettings(app, ctx.db);
  // 관리 화면은 P4에서 늘린다. 지금은 첫 화면이 유의사항 설정이다.
  app.get("/", (c) => c.redirect("/settings/guides"));

  return app;
}
