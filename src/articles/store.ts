import type { Database, Params } from "../db/database.ts";
import type { SimilarHit } from "../similarity/fingerprint.ts";

export const ARTICLE_STATUSES = [
  "draft",
  "review",
  "approved",
  "exported",
  "published",
  "rejected",
] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export interface ArticleImage {
  id: string;
  url: string;
  kind: "photo" | "generated";
  subject: string;
  alt: string;
}

export interface Article {
  id: number;
  topicId: number | null;
  channelId: string;
  sectionCode: string;
  articleType: string;
  region: string;
  title: string;
  summary: string;
  body: string;
  format: string;
  keywords: string[];
  audience: Record<string, unknown>;
  /** draft: 품질 문제가 남은 원고 / review: 검수 대기 */
  status: ArticleStatus;
  qualityIssues: string[];
  similarArticles: SimilarHit[];
  facts: string;
  /** 본문에 쓴 이미지 (실제 사진 / 생성 삽화) */
  images: ArticleImage[];
  generation: Record<string, unknown>;
  provider: string;
  model: string;
  reviewNote: string;
  publishedUrl: string;
  createdAt: string;
  updatedAt: string;
}

const toArticle = (r: any): Article => ({
  id: r.id,
  topicId: r.topic_id,
  channelId: r.channel_id,
  sectionCode: r.section_code,
  articleType: r.article_type,
  region: r.region,
  title: r.title,
  summary: r.summary,
  body: r.body,
  format: r.format,
  keywords: JSON.parse(r.keywords),
  audience: JSON.parse(r.audience),
  status: r.status,
  qualityIssues: JSON.parse(r.quality_issues),
  similarArticles: JSON.parse(r.similar_articles),
  facts: r.facts,
  images: JSON.parse(r.images),
  generation: JSON.parse(r.generation),
  provider: r.provider,
  model: r.model,
  reviewNote: r.review_note,
  publishedUrl: r.published_url,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export type NewArticle = Pick<
  Article,
  | "topicId"
  | "channelId"
  | "sectionCode"
  | "articleType"
  | "region"
  | "title"
  | "summary"
  | "body"
  | "format"
  | "keywords"
  | "status"
  | "qualityIssues"
  | "similarArticles"
  | "facts"
  | "images"
  | "generation"
  | "provider"
  | "model"
>;

export function createArticle(db: Database, a: NewArticle): number {
  const now = new Date().toISOString();
  return db.run(
    `INSERT INTO articles (topic_id, channel_id, section_code, article_type, region, title, summary, body, format,
       keywords, status, quality_issues, similar_articles, facts, images, generation, provider, model, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      a.topicId,
      a.channelId,
      a.sectionCode,
      a.articleType,
      a.region,
      a.title,
      a.summary,
      a.body,
      a.format,
      JSON.stringify(a.keywords),
      a.status,
      JSON.stringify(a.qualityIssues),
      JSON.stringify(a.similarArticles),
      a.facts,
      JSON.stringify(a.images),
      JSON.stringify(a.generation),
      a.provider,
      a.model,
      now,
      now,
    ],
  ).lastInsertRowid;
}

export function getArticle(db: Database, id: number): Article | undefined {
  const row = db.get("SELECT * FROM articles WHERE id = ?", [id]);
  return row ? toArticle(row) : undefined;
}

export function listArticles(
  db: Database,
  q: { channelId?: string; status?: ArticleStatus; limit?: number } = {},
): Article[] {
  const where: string[] = [];
  const params: Params = [];
  if (q.channelId) {
    where.push("channel_id = ?");
    params.push(q.channelId);
  }
  if (q.status) {
    where.push("status = ?");
    params.push(q.status);
  }
  params.push(Math.min(Math.max(q.limit ?? 50, 1), 500));
  return db
    .all(
      `SELECT * FROM articles ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`,
      params,
    )
    .map(toArticle);
}
