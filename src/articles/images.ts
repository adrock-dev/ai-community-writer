import { join } from "node:path";
import type { AppConfig } from "../config.ts";
import type { Database } from "../db/database.ts";
import { IMAGES_DIR, type ImageGenerator, type ImageStyle } from "../images/generator.ts";
import { saveUploadedImage } from "../images/optimize.ts";
import { type LlmClient, LlmUnavailableError } from "../llm/client.ts";
import { looksRateLimited } from "../llm/limits.ts";
import { fingerprint, saveFingerprint } from "../similarity/fingerprint.ts";
import { generatedImageUrl } from "../writer/generate.ts";
import { ReviewError, recheckArticle } from "./review.ts";
import { type Article, type ArticleImage, type ArticleStatus, getArticle } from "./store.ts";

// 검수 중 이미지 한 장씩 바꾸기: 파일로 교체 · 삽화 다시 만들기 · 빼기 · 썸네일(첫 이미지) 지정.
// 바꾼 이미지는 항상 새 파일 이름으로 저장한다. 자동 발행의 업로드 기록(app_state)이 주소 기준이라
// 같은 이름으로 덮어쓰면 다시 게시할 때 새 이미지가 올라가지 않는다.
// 본문이 바뀌는 동작(교체·다시 만들기·빼기)은 글 수정과 같이 기계 검사를 다시 하고 검수 대기로 돌린다.

export const REGENERATE_IMAGE_KIND = "regenerate_image";

/** 이미지를 바꿀 수 있는 상태(글 수정과 같다). 발행한 글은 바꾸지 않는다. */
export const IMAGE_EDITABLE_STATUSES: ArticleStatus[] = ["draft", "review", "approved"];

export interface RegenerateImagePayload {
  articleId: number;
  imageId: string;
  scene: string;
  style: ImageStyle;
  alt?: string;
}

function requireImage(
  db: Database,
  id: number,
  imageId: string,
): { article: Article; image: ArticleImage } {
  const article = getArticle(db, id);
  if (!article) throw new ReviewError("글이 없습니다");
  if (!IMAGE_EDITABLE_STATUSES.includes(article.status)) {
    throw new ReviewError(`${article.status} 상태의 글은 이미지를 바꿀 수 없습니다`);
  }
  const image = article.images.find((i) => i.id === imageId);
  if (!image) throw new ReviewError(`이미지 ${imageId}가 없습니다`);
  return { article, image };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const imageTag = (url: string) => new RegExp(`!\\[([^\\]]*)\\]\\(${escapeRegExp(url)}\\)`, "g");

/** 본문의 이미지 주소를 바꾼다. alt 를 주면 대체 텍스트도 바꾼다. */
export function swapImageInBody(
  body: string,
  oldUrl: string,
  newUrl: string,
  alt?: string,
): string {
  return body.replace(imageTag(oldUrl), (_m, before: string) => `![${alt ?? before}](${newUrl})`);
}

/** 본문에서 이미지 줄을 지우고 남은 빈 줄을 정리한다. */
export function dropImageFromBody(body: string, url: string): string {
  return body.replace(imageTag(url), "").replace(/\n{3,}/g, "\n\n");
}

const now = () => new Date().toISOString();

/** 본문·이미지 목록을 저장하고 기계 검사를 다시 한다(글 수정과 같은 상태 전이). */
function saveImageChange(db: Database, before: Article, body: string, images: ArticleImage[]) {
  const issues = recheckArticle(db, { ...before, body, images });
  db.run(
    `UPDATE articles SET body = ?, images = ?, quality_issues = ?, status = ?, approved_at = NULL,
       updated_at = ? WHERE id = ?`,
    [
      body,
      JSON.stringify(images),
      JSON.stringify(issues),
      issues.length ? "draft" : "review",
      now(),
      before.id,
    ],
  );
  saveFingerprint(db, before.id, fingerprint(body));
  return getArticle(db, before.id)!;
}

/** 이미지 한 장을 새 주소로 바꾼다(본문의 같은 이미지도 함께). */
export function replaceArticleImage(
  db: Database,
  id: number,
  imageId: string,
  next: Pick<ArticleImage, "url" | "kind" | "subject"> & { alt?: string },
): Article {
  const { article, image } = requireImage(db, id, imageId);
  const alt = next.alt?.trim() || image.alt;
  const body = swapImageInBody(article.body, image.url, next.url, alt);
  const images = article.images.map((i) =>
    i.id === imageId ? { ...i, url: next.url, kind: next.kind, subject: next.subject, alt } : i,
  );
  return saveImageChange(db, article, body, images);
}

/** 이미지 한 장을 본문과 목록에서 뺀다. 최소 장수 미달은 기계 검사가 문제로 남긴다. */
export function removeArticleImage(db: Database, id: number, imageId: string): Article {
  const { article, image } = requireImage(db, id, imageId);
  const body = dropImageFromBody(article.body, image.url);
  return saveImageChange(
    db,
    article,
    body,
    article.images.filter((i) => i.id !== imageId),
  );
}

/** 블로그 목록 썸네일(자동 발행 때 첫 이미지)로 지정한다. 본문은 그대로라 상태도 그대로 둔다. */
export function setArticleThumbnail(db: Database, id: number, imageId: string): Article {
  const { article, image } = requireImage(db, id, imageId);
  const images = [image, ...article.images.filter((i) => i.id !== imageId)];
  db.run("UPDATE articles SET images = ?, updated_at = ? WHERE id = ?", [
    JSON.stringify(images),
    now(),
    id,
  ]);
  return getArticle(db, id)!;
}

/** 새 파일 이름(글·이미지·시각). 같은 이름을 다시 쓰지 않는다. */
function newFileBase(articleId: number, imageId: string, at: Date): string {
  const stamp = at.toISOString().replace(/\D/g, "").slice(0, 17);
  return `a${articleId}-${imageId.replace(/[^\w-]/g, "")}-${stamp}`;
}

/** 검수자가 올린 파일로 이미지를 바꾼다. 가로 1200px·WebP 로 줄여 저장한다. */
export async function uploadArticleImage(
  db: Database,
  id: number,
  imageId: string,
  file: { data: Uint8Array; name: string },
  alt?: string,
  at: Date = new Date(),
): Promise<Article> {
  requireImage(db, id, imageId);
  const base = newFileBase(id, imageId, at);
  let ext: string;
  try {
    ext = await saveUploadedImage(file.data, join(IMAGES_DIR, base));
  } catch (error) {
    throw new ReviewError((error as Error).message);
  }
  return replaceArticleImage(db, id, imageId, {
    url: generatedImageUrl(`${base}${ext}`),
    kind: "uploaded",
    subject: `올린 파일: ${file.name}`,
    alt,
  });
}

export interface RegenerateDeps {
  db: Database;
  config: AppConfig;
  llm: LlmClient;
  images: ImageGenerator;
  now?: () => Date;
  log?: (message: string) => void;
}

/**
 * 삽화 한 장을 다시 만든다(작업 큐에서 실행, Codex 사용량 소모).
 * 만드는 동안 글이 발행·반려됐거나 이미지가 빠졌으면 바꾸지 않고 건너뛴다.
 */
export async function regenerateArticleImage(
  deps: RegenerateDeps,
  payload: RegenerateImagePayload,
): Promise<{ articleId: number; imageId: string; url?: string; skipped?: string }> {
  const { db } = deps;
  const clock = deps.now ?? (() => new Date());
  const { articleId, imageId } = payload;
  const result = { articleId, imageId };
  try {
    requireImage(db, articleId, imageId);
  } catch (error) {
    if (error instanceof ReviewError) return { ...result, skipped: error.message };
    throw error;
  }
  // 이미지 생성은 Codex 로그인을 쓰므로 Codex 가 한도로 쉬는 중이면 실패가 아니라 보류한다
  const codex = deps.llm.status(clock()).find((s) => s.provider === "codex");
  if (codex?.blockedUntil) {
    throw new LlmUnavailableError(new Date(codex.blockedUntil), `codex: ${codex.reason}`);
  }
  let file: string;
  try {
    deps.log?.(`  삽화 다시 만들기 #${articleId} ${imageId} (${payload.style}): ${payload.scene}`);
    file = await deps.images.generate(
      payload.scene,
      newFileBase(articleId, imageId, clock()),
      payload.style,
    );
  } catch (error) {
    const message = (error as Error).message;
    if (looksRateLimited(message)) {
      const until = new Date(clock().getTime() + deps.config.llm.limitCooldownMin * 60_000);
      throw new LlmUnavailableError(until, message);
    }
    throw error;
  }
  try {
    const article = replaceArticleImage(db, articleId, imageId, {
      url: generatedImageUrl(file),
      kind: "generated",
      subject: payload.scene,
      alt: payload.alt,
    });
    return { ...result, url: article.images.find((i) => i.id === imageId)?.url };
  } catch (error) {
    if (error instanceof ReviewError) return { ...result, skipped: error.message };
    throw error;
  }
}
