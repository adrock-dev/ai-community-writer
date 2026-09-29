import { findChannel } from "../channels.ts";
import type { Database } from "../db/database.ts";
import { loadGuideRules } from "../guides.ts";
import { qualityIssues } from "../quality/gate.ts";
import {
  findSimilar,
  fingerprint,
  saveFingerprint,
  similarityIssues,
} from "../similarity/fingerprint.ts";
import { getTopic } from "../topics/store.ts";
import { type Article, type ArticleStatus, getArticle } from "./store.ts";

// 사람 검수 흐름.
//   draft(문제 남음) / review(검수 대기) ──수정──▶ 기계 검사 다시 → draft/review
//                                       ──승인──▶ approved ──내보내기──▶ exported ──발행 URL──▶ published
//   발행 전 어느 단계에서든 반려 → rejected
// 승인한 글을 고치면 다시 검수 대기로 돌아간다(고친 내용도 사람이 확인해야 하므로).

export class ReviewError extends Error {
  override name = "ReviewError";
}

function require(db: Database, id: number, allowed: ArticleStatus[], action: string): Article {
  const article = getArticle(db, id);
  if (!article) throw new ReviewError("글이 없습니다");
  if (!allowed.includes(article.status)) {
    throw new ReviewError(`${article.status} 상태의 글은 ${action}할 수 없습니다`);
  }
  return article;
}

const now = () => new Date().toISOString();

/** 저장된 글을 기계 검사(품질 게이트 + 유사도)로 다시 본다. LLM은 쓰지 않는다. */
export function recheckArticle(db: Database, article: Article): string[] {
  const channel = findChannel(article.channelId);
  if (!channel) return [`알 수 없는 채널: ${article.channelId}`];
  const topic = article.topicId ? getTopic(db, article.topicId) : undefined;
  const guides = loadGuideRules(db, channel.id);
  const draft = {
    title: article.title,
    summary: article.summary,
    keywords: article.keywords,
    body: article.body,
  };
  const similar = findSimilar(
    db,
    {
      title: article.title,
      channelId: channel.id,
      articleType: article.articleType,
      fp: fingerprint(article.body),
    },
    article.id,
  );
  return [
    ...qualityIssues(draft, {
      channel,
      primaryKeyword: topic?.primaryKeyword ?? article.keywords[0] ?? "",
      articleType: article.articleType,
      corpus: `${article.facts}\n${guides.map((g) => g.text).join("\n")}`,
      candidates: [],
      // 검수 중 고친 글도 채널의 자사 링크는 허용한다(생성 때 넣었거나 검수자가 넣은 것).
      allowedLinks: channel.linkTargets?.map((l) => l.url) ?? [],
    }),
    ...similarityIssues(similar),
  ];
}

export interface ArticleEdit {
  title: string;
  summary: string;
  keywords: string[];
  body: string;
}

export function editArticle(db: Database, id: number, edit: ArticleEdit): Article {
  const before = require(db, id, ["draft", "review", "approved"], "수정");
  const next = { ...before, ...edit };
  const issues = recheckArticle(db, next);
  db.run(
    `UPDATE articles SET title = ?, summary = ?, keywords = ?, body = ?, quality_issues = ?, status = ?,
       approved_at = NULL, updated_at = ? WHERE id = ?`,
    [
      edit.title.trim(),
      edit.summary.trim(),
      JSON.stringify(edit.keywords),
      edit.body,
      JSON.stringify(issues),
      issues.length ? "draft" : "review",
      now(),
      id,
    ],
  );
  saveFingerprint(db, id, fingerprint(edit.body));
  return getArticle(db, id)!;
}

/** 승인. 문제가 남은 초안은 검수자가 확인했다고 밝힌 경우에만 승인한다. */
export function approveArticle(
  db: Database,
  id: number,
  opts: { acceptIssues?: boolean; note?: string } = {},
): Article {
  const article = require(db, id, ["draft", "review"], "승인");
  if (article.qualityIssues.length && !opts.acceptIssues) {
    throw new ReviewError(
      `남은 문제 ${article.qualityIssues.length}건이 있습니다. 확인했다면 "남은 문제를 확인했습니다"에 체크하고 승인하세요`,
    );
  }
  db.run(
    "UPDATE articles SET status = 'approved', approved_at = ?, review_note = COALESCE(?, review_note), updated_at = ? WHERE id = ?",
    [now(), opts.note?.trim() || null, now(), id],
  );
  return getArticle(db, id)!;
}

export function rejectArticle(db: Database, id: number, note: string): Article {
  require(db, id, ["draft", "review", "approved", "exported"], "반려");
  db.run("UPDATE articles SET status = 'rejected', review_note = ?, updated_at = ? WHERE id = ?", [
    note.trim(),
    now(),
    id,
  ]);
  return getArticle(db, id)!;
}

export function markExported(db: Database, id: number): Article {
  const article = require(db, id, ["approved", "exported"], "내보내기");
  if (article.status === "approved") {
    db.run(
      "UPDATE articles SET status = 'exported', exported_at = ?, updated_at = ? WHERE id = ?",
      [now(), now(), id],
    );
  }
  return getArticle(db, id)!;
}

export function markPublished(db: Database, id: number, url: string): Article {
  require(db, id, ["approved", "exported", "published"], "발행 처리");
  if (!/^https?:\/\/\S+$/.test(url.trim()))
    throw new ReviewError("게시 URL은 http(s)://로 시작해야 합니다");
  db.run(
    "UPDATE articles SET status = 'published', published_url = ?, published_at = COALESCE(published_at, ?), updated_at = ? WHERE id = ?",
    [url.trim(), now(), now(), id],
  );
  return getArticle(db, id)!;
}

export function articleCounts(db: Database): Record<ArticleStatus, number> {
  const counts: Record<ArticleStatus, number> = {
    draft: 0,
    review: 0,
    approved: 0,
    exported: 0,
    published: 0,
    rejected: 0,
  };
  for (const r of db.all<{ status: ArticleStatus; n: number }>(
    "SELECT status, COUNT(*) AS n FROM articles GROUP BY status",
  )) {
    counts[r.status] = r.n;
  }
  return counts;
}
