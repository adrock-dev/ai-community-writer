import { existsSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { Hono } from "hono";
import { IMAGES_DIR } from "./images/generator.ts";

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

import { type AppContext, COLLECT_KIND, GENERATE_KIND } from "./app.ts";
import {
  ARTICLE_STATUSES,
  type ArticleStatus,
  getArticle,
  listArticles,
} from "./articles/store.ts";
import { CHANNELS } from "./channels.ts";
import {
  getTopic,
  listTopics,
  setTopicProgress,
  setTopicStatus,
  TOPIC_STATUSES,
  type TopicStatus,
} from "./topics/store.ts";
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

  // 주제 1개로 글 생성을 예약한다. 실제 생성은 워커가 생성 간격·사용량 한도에 맞춰 진행한다.
  app.post("/api/topics/:id/generate", (c) => {
    const topic = getTopic(ctx.db, Number(c.req.param("id")));
    if (!topic) return c.json({ error: "주제가 없습니다" }, 404);
    if (topic.status === "queued") return c.json({ error: "이미 생성 대기 중입니다" }, 409);
    setTopicProgress(ctx.db, topic.id, "queued");
    return c.json({ jobId: ctx.queue.enqueue(GENERATE_KIND, { topicId: topic.id }) }, 202);
  });

  app.get("/api/articles", (c) => {
    const status = c.req.query("status");
    if (status && !ARTICLE_STATUSES.includes(status as ArticleStatus)) {
      return c.json({ error: `status는 ${ARTICLE_STATUSES.join(", ")} 중 하나` }, 400);
    }
    return c.json(
      listArticles(ctx.db, {
        channelId: c.req.query("channel"),
        status: status as ArticleStatus | undefined,
        limit: Number(c.req.query("limit")) || undefined,
      }),
    );
  });

  app.get("/api/articles/:id", (c) => {
    const article = getArticle(ctx.db, Number(c.req.param("id")));
    return article ? c.json(article) : c.json({ error: "글이 없습니다" }, 404);
  });

  // 생성 삽화 제공. 파일 이름만 받아 경로 이동(../)을 막는다.
  app.get("/images/:file", (c) => {
    const file = basename(c.req.param("file"));
    const path = join(IMAGES_DIR, file);
    const type = IMAGE_TYPES[extname(file).toLowerCase()];
    if (!type || !existsSync(path)) return c.notFound();
    return c.body(readFileSync(path), 200, {
      "content-type": type,
      "cache-control": "public, max-age=86400",
    });
  });

  mountGuideSettings(app, ctx.db);
  // 관리 화면은 P4에서 늘린다. 지금은 첫 화면이 유의사항 설정이다.
  app.get("/", (c) => c.redirect("/settings/guides"));

  return app;
}
