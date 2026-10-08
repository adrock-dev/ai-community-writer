import { serve } from "@hono/node-server";
import { createContext } from "./app.ts";
import { loadConfig } from "./config.ts";
import { killAllChildren } from "./llm/process.ts";
import { Worker } from "./queue/worker.ts";
import { createApp } from "./server.ts";
import { loadLoginCredentials, unsafeHostError } from "./web/auth.ts";

const config = loadConfig();
const login = loadLoginCredentials(config);
const hostError = unsafeHostError(config, login);
if (hostError) {
  console.error(`[writer] ${hostError}`);
  process.exit(1);
}
const ctx = createContext(config);
const worker = new Worker({
  queue: ctx.queue,
  pacer: ctx.pacer,
  llm: ctx.llm,
  handlers: ctx.handlers,
  pollMs: ctx.config.worker.pollSec * 1000,
});

const server = serve(
  {
    fetch: createApp(ctx, login).fetch,
    hostname: ctx.config.server.host,
    port: ctx.config.server.port,
  },
  (info) =>
    console.log(
      `[writer] http://${info.address}:${info.port} 에서 실행 중 (로그인 ${login ? "켜짐" : "꺼짐"}, 종료: Ctrl+C)`,
    ),
);
worker.start();

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[writer] 종료 중…");
  worker.stop();
  killAllChildren();
  server.close();
  ctx.db.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
// Windows 콘솔 창 닫기
process.on("SIGHUP", shutdown);
