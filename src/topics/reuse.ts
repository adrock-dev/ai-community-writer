import { CHANNELS, findChannel, findSection } from "../channels.ts";
import type { Database } from "../db/database.ts";
import { compactKeyword } from "../keywords/cluster.ts";
import { ARTICLE_TYPES, inferArticleType } from "./intent.ts";
import { type KeywordSource, scoreTopic, writtenCounts } from "./planner.ts";
import { getTopic, type Topic } from "./store.ts";

// 주제 재활용: 수집된 주제를 다른 채널·섹션에서 다시 쓰거나, 검색 키워드에서 나오지 않는
// 주제(예: 학원 가기 전 드라이빙존 연습)를 운영자가 직접 추가한다.
// 채널 간 중복은 주제 단계에서 막지 않고, 글 단위 유사도 검사와 채널 × 유형 프롬프트로 가른다.

export interface TopicTarget {
  channelId: string;
  sectionCode: string;
}

/** 주제를 둘 수 있는 채널·섹션 전체. 화면의 선택지로 쓴다. */
export function topicTargets(): (TopicTarget & { label: string; regional: boolean })[] {
  return CHANNELS.flatMap((ch) =>
    ch.sections.map((s) => ({
      channelId: ch.id,
      sectionCode: s.code,
      label: ch.sections.length > 1 ? `${ch.label} · ${s.label}` : ch.label,
      regional: ch.regional,
    })),
  );
}

export const targetValue = (t: TopicTarget) => `${t.channelId}/${t.sectionCode}`;

/** 화면에서 받은 "채널/섹션" 값을 확인해 돌려준다. */
export function parseTarget(value: string): TopicTarget | undefined {
  const [channelId = "", sectionCode = ""] = value.split("/");
  return findSection(channelId, sectionCode) ? { channelId, sectionCode } : undefined;
}

function findByKey(db: Database, t: TopicTarget, topicKey: string): Topic | undefined {
  const row = db.get<{ id: number }>(
    "SELECT id FROM topics WHERE channel_id = ? AND section_code = ? AND topic_key = ?",
    [t.channelId, t.sectionCode, topicKey],
  );
  return row ? getTopic(db, row.id) : undefined;
}

interface NewTopic {
  primaryKeyword: string;
  secondaryKeywords: string[];
  articleType: string;
  region: string;
  volume: number;
  trend: number | null;
  competition: string;
  brief: string;
  origin: "copied" | "manual";
}

function insertTopic(db: Database, t: TopicTarget, topicKey: string, n: NewTopic): Topic {
  const score = scoreTopic({
    volume: n.volume,
    competition: n.competition,
    trend: n.trend ?? undefined,
    ...writtenCounts(db, { ...t, articleType: n.articleType, region: n.region, topicKey }),
  });
  const now = new Date().toISOString();
  const { lastInsertRowid } = db.run(
    `INSERT INTO topics (primary_keyword, secondary_keywords, channel_id, section_code, article_type, score,
       status, created_at, updated_at, topic_key, region, volume, trend, competition, origin, brief)
     VALUES (?, ?, ?, ?, ?, ?, 'candidate', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      n.primaryKeyword,
      JSON.stringify(n.secondaryKeywords),
      t.channelId,
      t.sectionCode,
      n.articleType,
      score,
      now,
      now,
      topicKey,
      n.region,
      n.volume,
      n.trend,
      n.competition,
      n.origin,
      n.brief,
    ],
  );
  return getTopic(db, Number(lastInsertRowid))!;
}

/**
 * 주제를 다른 채널·섹션에서 쓰도록 복사한다. 그 채널에 같은 주제가 이미 있으면 그것을 돌려준다.
 * 지역 주제는 지역 글을 쓰는 채널(운전면허PLUS)로만 옮길 수 있다.
 */
export function copyTopic(
  db: Database,
  sourceId: number,
  target: TopicTarget,
): { topic: Topic; created: boolean } {
  const source = getTopic(db, sourceId);
  if (!source) throw new Error(`주제 #${sourceId}가 없습니다`);
  const channel = findChannel(target.channelId);
  if (!channel || !findSection(target.channelId, target.sectionCode)) {
    throw new Error("대상 채널·섹션이 올바르지 않습니다");
  }
  if (source.channelId === target.channelId && source.sectionCode === target.sectionCode) {
    throw new Error("같은 채널·섹션으로는 복사할 수 없습니다");
  }
  if (source.region && !channel.regional) {
    throw new Error(
      `${channel.label}에서는 지역 글을 쓰지 않습니다. 지역 주제는 운전면허PLUS 커뮤니티에서만 씁니다`,
    );
  }
  const topicKey = source.topicKey || compactKeyword(source.primaryKeyword);
  const existing = findByKey(db, target, topicKey);
  if (existing) return { topic: existing, created: false };
  const topic = insertTopic(db, target, topicKey, {
    primaryKeyword: source.primaryKeyword,
    secondaryKeywords: source.secondaryKeywords,
    articleType: source.articleType,
    region: source.region,
    volume: source.volume,
    trend: source.trend,
    competition: source.competition,
    brief: source.brief,
    origin: "copied",
  });
  return { topic, created: true };
}

export interface KeywordVolume {
  total: number;
  competition: string;
}

/** 가장 최근 수집의 30일 검색 수. 띄어쓰기만 다른 키워드는 더한다. 수집한 적 없으면 undefined. */
export function storedKeywordVolume(db: Database, keyword: string): KeywordVolume | undefined {
  const key = compactKeyword(keyword);
  const rows = db.all<{
    keyword: string;
    collected_on: string;
    total: number;
    competition: string;
  }>(
    "SELECT keyword, collected_on, total, competition FROM keyword_stats WHERE lower(replace(keyword, ' ', '')) = ? ORDER BY collected_on DESC, total DESC",
    [key],
  );
  const latest = rows[0];
  if (!latest) return undefined;
  const same = rows.filter((r) => r.collected_on === latest.collected_on);
  return {
    total: same.reduce((sum, r) => sum + r.total, 0),
    competition: latest.competition ?? "",
  };
}

/** 수집 기록에 없으면 검색광고 API로 조회한다. 조회 실패나 검색 기록이 없으면 0회로 본다. */
export async function lookupKeywordVolume(
  db: Database,
  keyword: string,
  searchad?: KeywordSource,
): Promise<KeywordVolume & { source: "stored" | "api" | "none"; error?: string }> {
  const stored = storedKeywordVolume(db, keyword);
  if (stored) return { ...stored, source: "stored" };
  if (!searchad) return { total: 0, competition: "", source: "none" };
  try {
    const key = compactKeyword(keyword);
    const hits = (await searchad.relatedKeywords([keyword])).filter(
      (s) => compactKeyword(s.keyword) === key,
    );
    if (!hits.length) return { total: 0, competition: "", source: "none" };
    return {
      total: hits.reduce((sum, s) => sum + s.total, 0),
      competition: hits[0]!.competition,
      source: "api",
    };
  } catch (error) {
    return { total: 0, competition: "", source: "none", error: (error as Error).message };
  }
}

export interface ManualTopicInput {
  primaryKeyword: string;
  secondaryKeywords: string[];
  /** 비우면 대표 키워드로 판정한다. */
  articleType?: string;
  brief: string;
  targets: TopicTarget[];
  volume: KeywordVolume;
}

/**
 * 운영자가 주제를 직접 추가한다. 고른 채널·섹션마다 주제를 하나씩 만든다.
 * 같은 대표 키워드의 주제가 이미 있으면 새로 만들지 않고 글 방향만 바꾼다.
 * 지역은 두지 않는다(지역 글은 수집된 운전면허PLUS 주제로 쓴다).
 */
export function addManualTopics(
  db: Database,
  input: ManualTopicInput,
): { topics: Topic[]; created: number } {
  const primaryKeyword = input.primaryKeyword.replace(/\s+/g, " ").trim();
  if (!primaryKeyword) throw new Error("대표 키워드를 입력하세요");
  if (!input.targets.length) throw new Error("채널을 하나 이상 고르세요");
  for (const t of input.targets) {
    if (!findSection(t.channelId, t.sectionCode)) {
      throw new Error(`채널·섹션이 올바르지 않습니다: ${targetValue(t)}`);
    }
  }
  const articleType = ARTICLE_TYPES.some((t) => t.type === input.articleType)
    ? input.articleType!
    : inferArticleType(primaryKeyword);
  const topicKey = compactKeyword(primaryKeyword);
  const secondaryKeywords = [
    ...new Map(
      input.secondaryKeywords
        .map((k) => k.replace(/\s+/g, " ").trim())
        .filter((k) => k && compactKeyword(k) !== topicKey)
        .map((k) => [compactKeyword(k), k] as const),
    ).values(),
  ];
  const brief = input.brief.trim();

  let created = 0;
  const topics = db.transaction(() =>
    input.targets.map((t) => {
      const existing = findByKey(db, t, topicKey);
      if (existing) {
        if (brief) {
          db.run("UPDATE topics SET brief = ?, updated_at = ? WHERE id = ?", [
            brief,
            new Date().toISOString(),
            existing.id,
          ]);
        }
        return getTopic(db, existing.id)!;
      }
      created++;
      return insertTopic(db, t, topicKey, {
        primaryKeyword,
        secondaryKeywords,
        articleType,
        region: "",
        volume: input.volume.total,
        trend: null,
        competition: input.volume.competition,
        brief,
        origin: "manual",
      });
    }),
  );
  return { topics, created };
}
