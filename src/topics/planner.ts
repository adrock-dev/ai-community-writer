import type { AppConfig } from "../config.ts";
import type { Database } from "../db/database.ts";
import {
  type ClusterInput,
  clusterKeywords,
  compactKeyword,
  type KeywordCluster,
  secondaryKeywords,
} from "../keywords/cluster.ts";
import { detectRegion, type RegionEntry, regionKey } from "../keywords/regions.ts";
import type { KeywordStat } from "../keywords/searchad.ts";
import { type KeywordFilter, passesFilter, type SectionSeeds } from "../keywords/seeds.ts";
import { inferArticleType } from "./intent.ts";

// 키워드 수집 → 묶기 → 점수 → 주제 후보 저장.

export interface KeywordSource {
  relatedKeywords(hints: string[]): Promise<KeywordStat[]>;
}

export type TrendFetcher = (
  groups: Record<string, string[]>,
) => Promise<Record<string, number | undefined>>;

export interface CollectDeps {
  db: Database;
  keywords: AppConfig["keywords"];
  searchad: KeywordSource;
  regions: RegionEntry[];
  seeds: SectionSeeds[];
  filter: KeywordFilter;
  trends?: TrendFetcher;
  now?: Date;
  log?: (message: string) => void;
}

export interface SectionSummary {
  channelId: string;
  sectionCode: string;
  fetched: number;
  kept: number;
  topics: number;
  error?: string;
}

export interface CollectSummary {
  collectedOn: string;
  sections: SectionSummary[];
  warnings: string[];
}

const COMPETITION_FACTOR: Record<string, number> = { 낮음: 1.15, 중간: 1, 높음: 0.9 };

/**
 * 주제 점수. 검색 수는 로그로 눌러 큰 키워드 하나가 독식하지 않게 하고,
 * 광고 경쟁도·추세로 보정한다. 이미 쓴 글이 있으면 낮춘다:
 *   similarArticles   같은 채널의 같은 유형·같은 지역 글 수
 *   writtenElsewhere  같은 대표 키워드로 다른 채널에 쓴 글 수 (채널 간 유사문서 방지)
 */
export function scoreTopic(input: {
  volume: number;
  competition: string;
  trend?: number;
  similarArticles: number;
  writtenElsewhere?: number;
}): number {
  const volume = Math.log10(1 + input.volume);
  const competition = COMPETITION_FACTOR[input.competition] ?? 1;
  const trend = input.trend === undefined ? 1 : Math.min(1.5, Math.max(0.7, input.trend));
  const coverage = 1 / (1 + 0.5 * input.similarArticles + (input.writtenElsewhere ?? 0));
  return Math.round(volume * competition * trend * coverage * 100) / 100;
}

export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

interface SectionClusters {
  section: SectionSeeds;
  clusters: KeywordCluster[];
}

export async function collectKeywords(deps: CollectDeps): Promise<CollectSummary> {
  const { db, keywords: opts } = deps;
  const now = deps.now ?? new Date();
  const collectedOn = localDate(now);
  const log = deps.log ?? (() => {});
  const summary: CollectSummary = { collectedOn, sections: [], warnings: [] };
  const results: SectionClusters[] = [];

  for (const section of deps.seeds) {
    const item: SectionSummary = {
      channelId: section.channelId,
      sectionCode: section.sectionCode,
      fetched: 0,
      kept: 0,
      topics: 0,
    };
    summary.sections.push(item);
    try {
      const found = new Map<string, { stat: KeywordStat; seed: string }>();
      for (let i = 0; i < section.seeds.length; i += 5) {
        const hints = section.seeds.slice(i, i + 5);
        const stats = await deps.searchad.relatedKeywords(hints);
        item.fetched += stats.length;
        for (const stat of stats) found.set(stat.keyword, { stat, seed: hints.join(",") });
      }
      const kept = [...found.values()].filter(
        ({ stat }) =>
          stat.total >= opts.minMonthlyVolume &&
          passesFilter(stat.keyword, deps.filter) &&
          passesFilter(stat.keyword, section),
      );
      item.kept = kept.length;

      db.transaction(() => {
        for (const { stat, seed } of kept) {
          db.run(
            `INSERT INTO keyword_stats (keyword, collected_on, pc, mobile, total, competition) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(keyword, collected_on) DO UPDATE SET pc = excluded.pc, mobile = excluded.mobile, total = excluded.total, competition = excluded.competition`,
            [stat.keyword, collectedOn, stat.pc, stat.mobile, stat.total, stat.competition],
          );
          db.run(
            "INSERT OR IGNORE INTO keyword_sources (keyword, channel_id, section_code, seed, collected_on) VALUES (?, ?, ?, ?, ?)",
            [stat.keyword, section.channelId, section.sectionCode, seed, collectedOn],
          );
        }
      });

      const inputs: ClusterInput[] = kept.map(({ stat }) => {
        const match = detectRegion(stat.keyword, deps.regions);
        return {
          ...stat,
          region: regionKey(match),
          regionAlias: match?.alias ?? "",
          intent: inferArticleType(stat.keyword),
        };
      });
      const clusters = clusterKeywords(inputs, opts.clusterThreshold)
        .sort((a, b) => b.volume - a.volume)
        .slice(0, opts.maxTopicsPerSection);
      results.push({ section, clusters });
      log(
        `${section.channelId}/${section.sectionCode}: 연관 ${item.fetched} → 유효 ${item.kept} → 묶음 ${clusters.length}`,
      );
    } catch (error) {
      item.error = error instanceof Error ? error.message : String(error);
      log(`${section.channelId}/${section.sectionCode} 실패: ${item.error}`);
    }
  }

  // 추세는 검색 수 상위 묶음만 조회한다 (데이터랩 일일 호출 한도).
  let trends: Record<string, number | undefined> = {};
  if (deps.trends) {
    const top = results
      .flatMap((r) => r.clusters)
      .sort((a, b) => b.volume - a.volume)
      .slice(0, opts.trendTopN);
    const groups: Record<string, string[]> = {};
    for (const c of top) groups[c.head.keyword] = c.members.slice(0, 20).map((m) => m.keyword);
    try {
      trends = await deps.trends(groups);
    } catch (error) {
      summary.warnings.push(`추세 조회 실패, 추세 없이 점수 계산: ${(error as Error).message}`);
    }
  } else {
    summary.warnings.push("데이터랩 인증 정보가 없어 추세 없이 점수를 계산했습니다");
  }

  const stamp = now.toISOString();
  db.transaction(() => {
    for (const { section, clusters } of results) {
      const item = summary.sections.find(
        (s) => s.channelId === section.channelId && s.sectionCode === section.sectionCode,
      )!;
      for (const c of clusters) {
        const articleType = c.head.intent;
        const similarArticles =
          db.get<{ n: number }>(
            "SELECT COUNT(*) AS n FROM articles WHERE channel_id = ? AND article_type = ? AND region = ? AND status != 'rejected'",
            [section.channelId, articleType, c.region],
          )?.n ?? 0;
        const topicKey = compactKeyword(c.head.keyword);
        const writtenElsewhere =
          db.get<{ n: number }>(
            `SELECT COUNT(*) AS n FROM articles a JOIN topics t ON t.id = a.topic_id
             WHERE t.topic_key = ? AND a.channel_id != ? AND a.status != 'rejected'`,
            [topicKey, section.channelId],
          )?.n ?? 0;
        const trend = trends[c.head.keyword];
        const score = scoreTopic({
          volume: c.volume,
          competition: c.head.competition,
          trend,
          similarArticles,
          writtenElsewhere,
        });
        const secondary = secondaryKeywords(c);
        db.run(
          `INSERT INTO topics (primary_keyword, secondary_keywords, channel_id, section_code, article_type, score,
             status, created_at, updated_at, topic_key, region, volume, trend, competition)
           VALUES (?, ?, ?, ?, ?, ?, 'candidate', ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(channel_id, section_code, topic_key) DO UPDATE SET
             primary_keyword = excluded.primary_keyword, secondary_keywords = excluded.secondary_keywords,
             article_type = excluded.article_type, score = excluded.score, updated_at = excluded.updated_at,
             region = excluded.region, volume = excluded.volume, trend = excluded.trend, competition = excluded.competition`,
          [
            c.head.keyword,
            JSON.stringify(secondary),
            section.channelId,
            section.sectionCode,
            articleType,
            score,
            stamp,
            stamp,
            topicKey,
            c.region,
            c.volume,
            trend ?? null,
            c.head.competition,
          ],
        );
        item.topics++;
      }
    }
  });
  return summary;
}
