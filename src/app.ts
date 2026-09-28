import type { AppConfig } from "./config.ts";
import { Database } from "./db/database.ts";
import { fetchTrends, loadDatalabCredentials } from "./keywords/datalab.ts";
import { loadRegionIndex } from "./keywords/regions.ts";
import { loadSearchadCredentials, readEnvFile, SearchadClient } from "./keywords/searchad.ts";
import { loadKeywordFilter, loadSeeds } from "./keywords/seeds.ts";
import { LlmClient } from "./llm/client.ts";
import { resolvePath } from "./paths.ts";
import { Pacer } from "./queue/pacer.ts";
import { JobQueue } from "./queue/queue.ts";
import type { HandlerDef } from "./queue/worker.ts";
import { fetchAcademies } from "./sources/drivingplus.ts";
import { fetchStores } from "./sources/drivingzone.ts";
import { type CollectSummary, collectKeywords } from "./topics/planner.ts";

/** 글 생성 작업 종류. 생성 간격·일일 한도의 기준이다. */
export const GENERATE_KIND = "generate";
export const COLLECT_KIND = "collect_keywords";

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
    // 네이버 30일 검색 수 수집 → 주제 후보 갱신
    [COLLECT_KIND]: { usesLlm: false, run: () => runCollect(config, db) },
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

/** 시드·필터 파일과 인증 정보를 읽어 키워드 수집을 한 번 실행한다. */
export async function runCollect(
  config: AppConfig,
  db: Database,
  log?: (message: string) => void,
): Promise<CollectSummary> {
  const datalab = loadDatalabCredentials(config.naver, readEnvFile);
  return collectKeywords({
    db,
    keywords: config.keywords,
    searchad: new SearchadClient(loadSearchadCredentials(config.naver.searchadEnvFile)),
    regions: await loadRegionIndex(db, config.sources),
    seeds: loadSeeds(),
    filter: loadKeywordFilter(),
    trends: datalab ? (groups) => fetchTrends(datalab, groups) : undefined,
    log,
  });
}
