import type { AppConfig } from "./config.ts";
import { Database } from "./db/database.ts";
import { LlmClient } from "./llm/client.ts";
import { resolvePath } from "./paths.ts";
import { Pacer } from "./queue/pacer.ts";
import { JobQueue } from "./queue/queue.ts";
import type { HandlerDef } from "./queue/worker.ts";
import { fetchAcademies } from "./sources/drivingplus.ts";
import { fetchStores } from "./sources/drivingzone.ts";

/** 글 생성 작업 종류. 생성 간격·일일 한도의 기준이다. */
export const GENERATE_KIND = "generate";

export interface AppContext {
  config: AppConfig;
  db: Database;
  queue: JobQueue;
  pacer: Pacer;
  llm: LlmClient;
  handlers: Record<string, HandlerDef>;
}

export function createContext(config: AppConfig): AppContext {
  const db = new Database(resolvePath(config.dbPath));
  const queue = new JobQueue(db);
  const pacer = new Pacer(db, queue, config.pacing, GENERATE_KIND);
  const llm = new LlmClient(db, config.llm);
  const handlers: Record<string, HandlerDef> = {
    // 원천 데이터 캐시 갱신. 생성 작업이 오래된 자료를 쓰지 않도록 주기적으로 넣는다.
    sync_sources: {
      usesLlm: false,
      run: async () => {
        const fresh = { ...config.sources, cacheTtlHours: 0 };
        const [academies, stores] = await Promise.all([
          fetchAcademies(db, fresh),
          fetchStores(db, fresh),
        ]);
        return {
          academies: academies.value.length,
          stores: stores.value.length,
          stale: [academies.staleReason, stores.staleReason].filter(Boolean),
        };
      },
    },
  };
  return { config, db, queue, pacer, llm, handlers };
}
