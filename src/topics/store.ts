import type { Database, Params } from "../db/database.ts";

export const TOPIC_STATUSES = ["candidate", "queued", "written", "skipped"] as const;
export type TopicStatus = (typeof TOPIC_STATUSES)[number];

export interface Topic {
  id: number;
  primaryKeyword: string;
  secondaryKeywords: string[];
  channelId: string;
  sectionCode: string;
  articleType: string;
  region: string;
  volume: number;
  trend: number | null;
  competition: string;
  score: number;
  status: TopicStatus;
  note: string;
  updatedAt: string;
}

const toTopic = (r: any): Topic => ({
  id: r.id,
  primaryKeyword: r.primary_keyword,
  secondaryKeywords: JSON.parse(r.secondary_keywords),
  channelId: r.channel_id,
  sectionCode: r.section_code,
  articleType: r.article_type,
  region: r.region,
  volume: r.volume,
  trend: r.trend,
  competition: r.competition,
  score: r.score,
  status: r.status,
  note: r.note,
  updatedAt: r.updated_at,
});

export interface TopicQuery {
  channelId?: string;
  sectionCode?: string;
  status?: TopicStatus;
  limit?: number;
}

export function listTopics(db: Database, q: TopicQuery = {}): Topic[] {
  const where: string[] = [];
  const params: Params = [];
  if (q.channelId) {
    where.push("channel_id = ?");
    params.push(q.channelId);
  }
  if (q.sectionCode) {
    where.push("section_code = ?");
    params.push(q.sectionCode);
  }
  if (q.status) {
    where.push("status = ?");
    params.push(q.status);
  }
  params.push(Math.min(Math.max(q.limit ?? 100, 1), 1000));
  return db
    .all(
      `SELECT * FROM topics ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY score DESC, volume DESC LIMIT ?`,
      params,
    )
    .map(toTopic);
}

/** 운영자가 후보를 건너뛰거나 되살린다. queued/written은 생성 과정에서만 바뀐다. */
export function setTopicStatus(
  db: Database,
  id: number,
  status: "candidate" | "skipped",
  note?: string,
): boolean {
  return (
    db.run(
      "UPDATE topics SET status = ?, note = COALESCE(?, note), updated_at = ? WHERE id = ? AND status IN ('candidate', 'skipped')",
      [status, note ?? null, new Date().toISOString(), id],
    ).changes > 0
  );
}
