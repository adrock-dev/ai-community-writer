import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { getArticle } from "../articles/store.ts";
import { type BrandId, findChannel, findSection } from "../channels.ts";
import type { AppConfig } from "../config.ts";
import type { Database } from "../db/database.ts";
import { highlightToBold, markdownToHtml, stripTitle } from "../export/render.ts";
import { IMAGES_DIR } from "../images/generator.ts";
import { readEnvFile } from "../keywords/searchad.ts";
import { getTopic } from "../topics/store.ts";
import { type FetchLike, PublishError, WriterApi } from "./client.ts";
import { blogPayload, blogSlug, communityPayload, replaceUrls, sourceKeyFor } from "./payload.ts";

// 승인한 글을 대상 시스템에 자동 발행한다.
//   이미지 업로드(생성 삽화 · 블로그 썸네일) → 본문 주소 교체 → PUT(sourceKey upsert) → 게시 주소 기록 → IndexNow
// 같은 글을 다시 보내도 대상에서는 수정이 된다(sourceKey). 업로드한 이미지는 app_state 에 기억해 재시도 때 다시 올리지 않는다.

export const PUBLISH_KIND = "publish";

const KEY_NAMES: Record<BrandId, string> = {
  drivingplus: "DRIVINGPLUS_WRITER_API_KEY",
  drivingzone: "DRIVINGZONE_WRITER_API_KEY",
};

export interface PublishDeps {
  db: Database;
  config: AppConfig;
  fetch?: FetchLike;
  readImage?: (path: string) => Promise<Uint8Array>;
  /** 키를 직접 준다(테스트). 없으면 환경 변수 → 키 파일 */
  keys?: Partial<Record<BrandId, string>>;
  now?: Date;
  log?: (message: string) => void;
}

export interface PublishResult {
  articleId: number;
  externalId: string;
  url: string;
  created: boolean;
  warnings: string[];
}

/** 발행 키 유무(값은 돌려주지 않는다). doctor·화면 안내용 */
export function publishKeyStatus(config: AppConfig): Record<BrandId, boolean> {
  const file = readEnvFile(config.publish.credentialsFile);
  return {
    drivingplus: Boolean(process.env[KEY_NAMES.drivingplus] || file[KEY_NAMES.drivingplus]),
    drivingzone: Boolean(process.env[KEY_NAMES.drivingzone] || file[KEY_NAMES.drivingzone]),
  };
}

/** 발행 키: 환경 변수 → 키 파일. 값은 로그·화면에 내보내지 않는다. */
export function loadWriterKey(config: AppConfig, brand: BrandId): string {
  const name = KEY_NAMES[brand];
  return process.env[name] || readEnvFile(config.publish.credentialsFile)[name] || "";
}

function writerKey(deps: PublishDeps, brand: BrandId): string {
  return deps.keys?.[brand] ?? loadWriterKey(deps.config, brand);
}

/** 발행 API 주소(없으면 원천 데이터 주소). */
export function publishApiBase(config: AppConfig, brand: BrandId): string {
  return brand === "drivingplus"
    ? config.publish.drivingplusApi || config.sources.drivingplusApi
    : config.publish.drivingzoneApi || config.sources.drivingzoneApi;
}

/** 설치(로컬 DB)마다 한 번 만드는 식별자. 샘플 DB와 운영 DB의 글 번호가 겹쳐도 섞이지 않게 한다. */
function installId(db: Database): string {
  let id = db.getState("install_id");
  if (!id) {
    id = randomBytes(4).toString("hex");
    db.setState("install_id", id);
  }
  return id;
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function publishArticle(deps: PublishDeps, articleId: number): Promise<PublishResult> {
  const { db, config } = deps;
  const log = deps.log ?? (() => {});
  const article = getArticle(db, articleId);
  if (!article) throw new PublishError(`글 #${articleId}가 없습니다`);
  // 사람이 승인하지 않은 글은 내보내지 않는다
  if (!["approved", "exported"].includes(article.status)) {
    throw new PublishError(`${article.status} 상태의 글은 자동 발행할 수 없습니다(승인 후 가능)`);
  }
  const channel = findChannel(article.channelId);
  const section = findSection(article.channelId, article.sectionCode);
  if (!channel || !section)
    throw new PublishError(`채널·섹션 정의가 없습니다: ${article.channelId}`);
  if (channel.autoPublish === "none") {
    throw new PublishError(`${channel.label}은(는) 자동 발행 대상이 아닙니다(원고만)`);
  }

  const key = writerKey(deps, channel.brand);
  if (!key) {
    throw new PublishError(
      `발행 API 키가 없습니다. ${config.publish.credentialsFile} 에 ${KEY_NAMES[channel.brand]}=… 를 적으세요`,
    );
  }
  const api = new WriterApi(
    publishApiBase(config, channel.brand),
    key,
    config.publish.timeoutSec,
    deps.fetch,
  );
  const imagePath =
    channel.autoPublish === "community"
      ? "/v1/writer/community/images"
      : "/v1/writer/articles/images";
  const warnings: string[] = [];

  // 1) 이미지: 생성 삽화는 이 PC에만 있으므로 올린다. 블로그는 목록 썸네일(첫 이미지)도 올린다.
  const readImage = deps.readImage ?? ((p: string) => readFile(p));
  const upload = async (image: { url: string; kind: string }) => {
    const cacheKey = `upload:${channel.brand}:${image.url}`;
    const cached = db.getState(cacheKey);
    if (cached) return JSON.parse(cached) as { upfileId: number; url: string };
    let data: Uint8Array;
    let name: string;
    if (image.kind === "generated") {
      name = basename(image.url);
      data = await readImage(join(IMAGES_DIR, name));
    } else {
      const res = await (deps.fetch ?? fetch)(image.url, {
        signal: AbortSignal.timeout(config.publish.timeoutSec * 1000),
      });
      if (!res.ok) throw new PublishError(`사진을 받지 못했습니다(${res.status}): ${image.url}`);
      data = new Uint8Array(await res.arrayBuffer());
      name = basename(new URL(image.url).pathname) || "photo.jpg";
    }
    const type = MIME[extname(name).toLowerCase()] ?? "image/jpeg";
    const uploaded = await api.uploadImage(imagePath, { data, name, type });
    db.setState(cacheKey, JSON.stringify(uploaded));
    log(`  이미지 업로드: ${name} → ${uploaded.url}`);
    return uploaded;
  };

  const urlMap = new Map<string, string>();
  for (const image of article.images.filter((i) => i.kind === "generated")) {
    urlMap.set(image.url, (await upload(image)).url);
  }
  let thumbUpfileId: number | undefined;
  const first = article.images[0];
  if (first) {
    try {
      if (first.kind === "generated" || channel.autoPublish === "blog") {
        thumbUpfileId = (await upload(first)).upfileId;
      }
    } catch (error) {
      warnings.push(`썸네일을 올리지 못했습니다: ${(error as Error).message}`);
    }
  }
  const body = replaceUrls(stripTitle(article.body), urlMap);
  if (/\]\(\/images\//.test(body)) {
    throw new PublishError("본문에 올리지 못한 로컬 이미지가 남아 있습니다");
  }

  // 2) 발행(upsert)
  const sourceKey = sourceKeyFor(installId(db), article.id);
  let externalId: string;
  let url: string;
  let created: boolean;
  if (channel.autoPublish === "community") {
    const topic = article.topicId ? getTopic(db, article.topicId) : undefined;
    const payload = communityPayload({
      article,
      section,
      primaryKeyword: topic?.primaryKeyword ?? article.keywords[0] ?? article.title,
      content: highlightToBold(body),
      regional: channel.regional,
      thumbUpfileId,
    });
    if (!payload.filterCodes.length)
      throw new PublishError(`${section.code} 섹션의 칸 규칙이 없습니다`);
    const res = await api.put<{ id: number; path: string; created: boolean }>(
      `/v1/writer/community/posts/${encodeURIComponent(sourceKey)}`,
      payload,
    );
    externalId = String(res.id);
    url = `${config.publish.drivingplusSiteUrl.replace(/\/+$/, "")}${res.path}`;
    created = res.created;
  } else {
    const res = await api.put<{ id: number; created: boolean }>(
      `/v1/writer/articles/${encodeURIComponent(sourceKey)}`,
      blogPayload({
        article,
        contentHtml: markdownToHtml(body, channel.highlightColor),
        thumbUpfileId,
      }),
    );
    externalId = String(res.id);
    const training = article.sectionCode === "blog_training";
    const site = (
      training ? config.publish.dztrainingSiteUrl : config.publish.drivingzoneSiteUrl
    ).replace(/\/+$/, "");
    url = `${site}${training ? "/blog" : "/story/blog"}/${blogSlug(article.title, res.id)}`;
    created = res.created;
  }

  const stamp = (deps.now ?? new Date()).toISOString();
  db.run(
    `UPDATE articles SET status = 'published', published_url = ?, published_at = COALESCE(published_at, ?),
       external_id = ?, publish_error = '', updated_at = ? WHERE id = ?`,
    [url, stamp, externalId, stamp, article.id],
  );
  log(`글 #${article.id} 발행 → ${url}${created ? "" : " (수정)"}`);

  // 3) IndexNow (실패해도 발행은 끝난 것)
  const indexKey =
    channel.brand === "drivingplus"
      ? config.publish.indexNowKeys.drivingplus
      : article.sectionCode === "blog_training"
        ? config.publish.indexNowKeys.dztraining
        : config.publish.indexNowKeys.drivingzone;
  if (indexKey) {
    const warning = await submitIndexNow(url, indexKey, deps.fetch ?? fetch);
    if (warning) warnings.push(warning);
  }
  return { articleId: article.id, externalId, url, created, warnings };
}

const INDEXNOW_ENDPOINTS = [
  "https://api.indexnow.org/indexnow",
  "https://searchadvisor.naver.com/indexnow",
];

/** 글 주소 1건 통보. 실패는 경고 문구로 돌려준다. */
export async function submitIndexNow(
  url: string,
  key: string,
  fetchImpl: FetchLike,
): Promise<string | undefined> {
  const { host, origin } = new URL(url);
  const body = JSON.stringify({ host, key, keyLocation: `${origin}/${key}.txt`, urlList: [url] });
  const failed: string[] = [];
  for (const endpoint of INDEXNOW_ENDPOINTS) {
    try {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok && res.status !== 202) failed.push(`${new URL(endpoint).host} ${res.status}`);
    } catch (error) {
      failed.push(`${new URL(endpoint).host} ${(error as Error).message}`);
    }
  }
  return failed.length ? `IndexNow 통보 실패: ${failed.join(", ")}` : undefined;
}

/** 발행 실패 사유를 글에 남긴다(화면에 표시). */
export function recordPublishError(db: Database, articleId: number, message: string): void {
  db.run("UPDATE articles SET publish_error = ?, updated_at = ? WHERE id = ?", [
    message,
    new Date().toISOString(),
    articleId,
  ]);
}
