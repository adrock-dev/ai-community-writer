import { serve } from "@hono/node-server";
import { loadConfig } from "./config.ts";
import { createApp } from "./server.ts";

const config = loadConfig();
const app = createApp(config);

serve({ fetch: app.fetch, hostname: config.server.host, port: config.server.port }, (info) => {
  console.log(`[writer] http://${info.address}:${info.port} 에서 실행 중 (종료: Ctrl+C)`);
});
