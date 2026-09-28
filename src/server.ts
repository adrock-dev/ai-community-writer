import { Hono } from "hono";
import { CHANNELS } from "./channels.ts";
import type { AppConfig } from "./config.ts";

export function createApp(config: AppConfig): Hono {
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({
      ok: true,
      llmOrder: config.llm.order,
      channels: CHANNELS.map((ch) => ({ id: ch.id, sections: ch.sections.map((s) => s.code) })),
    }),
  );

  return app;
}
