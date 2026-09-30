import type { Database, Params } from "../db/database.ts";

export const TOPIC_STATUSES = ["candidate", "queued", "written", "skipped"] as const;
export type TopicStatus = (typeof TOPIC_STATUSES)[number];

/** collected: 키워드 수집 / copied: 다른 채널 주제에서 복사 / manual: 운영자 직접 추가 */
export const TOPIC_ORIGINS = ["collected", "copied", "manual"] as const;
export type TopicOrigin = (typeof TOPIC_ORIGINS)[number];

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
  origin: TopicOrigin;
  /** 운영자가 정한 글 방향. 비어 있으면 키워드와 글 유형만으로 쓴다. */
  brief: string;
  topicKey: string;
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
  origin: r.origin,
  brief: r.brief,
  topicKey: r.topic_key,
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

export function getTopic(db: Database, id: number): Topic | undefined {
  const row = db.get("SELECT * FROM topics WHERE id = ?", [id]);
  return row ? toTopic(row) : undefined;
}

/** 생성 과정에서의 상태 변경 (queued → written, 실패 시 candidate로 되돌림). */
export function setTopicProgress(
  db: Database,
  id: number,
  status: "candidate" | "queued" | "written",
): void {
  db.run("UPDATE topics SET status = ?, updated_at = ? WHERE id = ?", [
    status,
    new Date().toISOString(),
    id,
  ]);
}
