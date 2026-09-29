import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { Article } from "../articles/store.ts";
import { findChannel, findSection, resolveFilterCodes } from "../channels.ts";
import { IMAGES_DIR } from "../images/generator.ts";
import { regionLabel } from "../keywords/regions.ts";
import { PROJECT_ROOT } from "../paths.ts";
import {
  highlightToBold,
  markdownToHtml,
  replaceImageUrls,
  stripTitle,
  toCafeText,
} from "./render.ts";

// 승인한 글을 채널별 형식으로 내보낸다. 자동 발행(P6) 전까지는 운영자가 이 결과를 복사해 올린다.
//   output/exports/<글 번호>-<채널>/
//     본문.md | 본문.html | 카페원고.txt + 카페원고.html
//     images/            본문에 쓴 모든 이미지 (생성 삽화는 반드시 업로드 필요)
//     안내.txt           제목·설명·키워드·섹션·노출 지역·업로드할 이미지

export const EXPORTS_DIR = join(PROJECT_ROOT, "output", "exports");

export interface ChannelExport {
  /** 화면에서 복사할 본문 */
  primary: { label: string; content: string; kind: "markdown" | "html" | "text" };
  /** 서식 복사(붙여넣기)용 HTML */
  richHtml: string;
  fields: { label: string; value: string }[];
  /** 대상 시스템에 직접 올려야 하는 이미지 (생성 삽화) */
  uploads: string[];
}

/** 채널 형식의 결과를 만든다 (파일은 쓰지 않음). */
export function renderExport(article: Article): ChannelExport {
  const channel = findChannel(article.channelId);
  const section = findSection(article.channelId, article.sectionCode);
  const body = stripTitle(article.body);
  const html = markdownToHtml(body, channel?.highlightColor);
  const uploads = article.images.filter((i) => i.kind === "generated").map((i) => basename(i.url));
  const keywords = article.keywords.join(", ");
  const region = channel?.regional && article.region ? regionLabel(article.region) : "";

  if (channel?.brand === "drivingplus") {
    return {
      primary: {
        label: "본문 (Markdown, content_format=md)",
        content: highlightToBold(body),
        kind: "markdown",
      },
      richHtml: html,
      fields: [
        { label: "섹션", value: `${section?.label ?? ""} (${article.sectionCode})` },
        {
          label: "칸 (community_post_filter)",
          value: section
            ? resolveFilterCodes(
                section,
                article.articleType,
                article.keywords[0] ?? article.title,
              ).join(", ")
            : "",
        },
        { label: "제목 (title)", value: article.title },
        { label: "요약 (summary)", value: article.summary },
        { label: "SEO 키워드 (seo_keywords)", value: keywords },
        {
          label: "노출 대상 (audience)",
          value: region ? `지역 글: ${region} — 서비스 지역 지정 권장` : "전국 (EVERYWHERE)",
        },
      ],
      uploads,
    };
  }
  if (channel?.format === "cafe-text") {
    return {
      primary: { label: "카페 원고 (텍스트)", content: toCafeText(article.body), kind: "text" },
      richHtml: html,
      fields: [
        { label: "제목", value: article.title },
        { label: "태그로 쓸 키워드", value: keywords },
      ],
      uploads,
    };
  }
  return {
    primary: { label: "본문 (에디터 HTML)", content: html, kind: "html" },
    richHtml: html,
    fields: [
      { label: "게시판 (board type)", value: article.sectionCode },
      { label: "제목 (title)", value: article.title },
      { label: "부제목·설명 (sub_title)", value: article.summary },
      { label: "키워드 (keywords)", value: keywords },
    ],
    uploads,
  };
}

async function download(url: string, to: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return false;
    writeFileSync(to, Buffer.from(await res.arrayBuffer()));
    return true;
  } catch {
    return false;
  }
}

/** 내보내기 폴더를 만든다. 폴더 경로를 돌려준다. */
export async function writeExportBundle(article: Article, dir = EXPORTS_DIR): Promise<string> {
  const out = join(dir, `${article.id}-${article.channelId}`);
  const imagesOut = join(out, "images");
  mkdirSync(imagesOut, { recursive: true });

  // 이미지: 생성 삽화는 복사하고 본문 주소를 images/파일 로 바꾼다. 실제 사진은 공개 주소를 그대로 두고 사본만 받는다.
  const urlMap = new Map<string, string>();
  const missing: string[] = [];
  for (const [i, image] of article.images.entries()) {
    if (image.kind === "generated") {
      const file = basename(image.url);
      const src = join(IMAGES_DIR, file);
      if (existsSync(src)) copyFileSync(src, join(imagesOut, file));
      else missing.push(file);
      urlMap.set(image.url, `images/${file}`);
    } else {
      const ext = extname(new URL(image.url).pathname).toLowerCase() || ".jpg";
      if (!(await download(image.url, join(imagesOut, `photo-${i + 1}${ext}`))))
        missing.push(image.url);
    }
  }
  const localized = { ...article, body: replaceImageUrls(article.body, urlMap) };
  const result = renderExport(localized);

  const ext =
    result.primary.kind === "markdown" ? "md" : result.primary.kind === "html" ? "html" : "txt";
  writeFileSync(join(out, `본문.${ext}`), `${result.primary.content}\n`);
  if (result.primary.kind !== "html")
    writeFileSync(join(out, "본문-서식.html"), `${result.richHtml}\n`);
  writeFileSync(
    join(out, "안내.txt"),
    [
      `글 #${article.id} · ${findChannel(article.channelId)?.label ?? article.channelId}`,
      "",
      ...result.fields.map((f) => `${f.label}: ${f.value}`),
      "",
      result.uploads.length
        ? `직접 올려야 하는 이미지 (생성 삽화, images/ 폴더): ${result.uploads.join(", ")}\n올린 뒤 본문의 images/파일 주소를 올린 이미지 주소로 바꾸세요.`
        : "생성 삽화 없음 (본문 이미지는 공개 주소)",
      missing.length ? `\n받지 못한 이미지: ${missing.join(", ")}` : "",
    ].join("\n"),
  );
  return out;
}
