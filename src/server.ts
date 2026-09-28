import { Hono } from "hono";
import type { AppContext } from "./app.ts";
import { CHANNELS } from "./channels.ts";

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

  return app;
}
