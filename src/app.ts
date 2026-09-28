import type { AppConfig } from "./config.ts";
import { Database } from "./db/database.ts";
import { importGuideFilesIfEmpty } from "./guides.ts";
import { codexImageGenerator } from "./images/generator.ts";
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
import { PUBLISH_KIND, publishArticle, recordPublishError } from "./publish/publisher.ts";
import { fetchStores } from "./sources/drivingzone.ts";
import { type CollectSummary, collectKeywords } from "./topics/planner.ts";
import { generateArticle } from "./writer/generate.ts";

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
  // 설정 화면이 생기기 전 guides/*.md에 적어 둔 유의사항을 처음 한 번만 가져온다.
  importGuideFilesIfEmpty(db);
  const queue = new JobQueue(db);
  const pacer = new Pacer(db, queue, config.pacing, GENERATE_KIND);
  const llm = new LlmClient(db, config.llm);
  const handlers: Record<string, HandlerDef> = {
    // 주제 1개로 글 1편 생성 → 검수 대기. LLM을 쓰므로 생성 간격·일일 한도·사용량 대기를 따른다.
    [GENERATE_KIND]: {
      usesLlm: true,
      run: (job) =>
        generateArticle(
          {
            db,
            config,
            llm,
            images: codexImageGenerator(config.llm),
            log: (m) => console.log(`[generate] ${m}`),
          },
          Number((job.payload as { topicId?: number }).topicId),
        ),
    },
    // 승인한 글 자동 발행(대상 API). LLM을 쓰지 않는다. 같은 글을 다시 보내도 대상에서는 수정이 된다.
    [PUBLISH_KIND]: {
      usesLlm: false,
      run: async (job) => {
        const articleId = Number((job.payload as { articleId?: number }).articleId);
        try {
          return await publishArticle(
            { db, config, log: (m) => console.log(`[publish] ${m}`) },
            articleId,
          );
        } catch (error) {
          recordPublishError(db, articleId, (error as Error).message);
          throw error;
        }
      },
    },
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
