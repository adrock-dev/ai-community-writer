import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  dropImageFromBody,
  regenerateArticleImage,
  removeArticleImage,
  replaceArticleImage,
  setArticleThumbnail,
  swapImageInBody,
} from "../src/articles/images.ts";
import { approveArticle, markPublished, ReviewError } from "../src/articles/review.ts";
import { createArticle, getArticle, type NewArticle } from "../src/articles/store.ts";
import { parseConfig } from "../src/config.ts";
import { Database } from "../src/db/database.ts";
import type { ImageGenerator } from "../src/images/generator.ts";
import { saveUploadedImage } from "../src/images/optimize.ts";
import { LlmClient, LlmUnavailableError } from "../src/llm/client.ts";

const BODY = [
  "# 운전면허 취득 절차",
  "운전면허 취득 절차는 교육부터 도로주행까지 순서대로 진행돼요.",
  "## 교육",
  "![교육 장면](/images/t1-1.webp)",
  "교통안전교육을 먼저 들어요.",
  "## 기능시험",
  "![코스 사진](https://file.example/2.jpg)",
  "코스를 연습해요.",
].join("\n\n");

function article(over: Partial<NewArticle> = {}): NewArticle {
  return {
    topicId: null,
    channelId: "drivingzone-blog",
    sectionCode: "license_process",
    articleType: "exam",
    region: "",
    title: "운전면허 취득 절차",
    summary: "요약",
    body: BODY,
    format: "html",
    keywords: ["운전면허 취득 절차"],
    status: "review",
    qualityIssues: [],
    similarArticles: [],
    facts: "",
    images: [
      {
        id: "img1",
        url: "/images/t1-1.webp",
        kind: "generated",
        subject: "교육",
        alt: "교육 장면",
      },
      {
        id: "img2",
        url: "https://file.example/2.jpg",
        kind: "photo",
        subject: "코스",
        alt: "코스 사진",
      },
    ],
    generation: {},
    provider: "codex",
    model: "",
    ...over,
  };
}

const config = parseConfig({});
const llm = (db: Database) =>
  new LlmClient(db, config.llm, async () => ({ kind: "error", message: "unused" }));

describe("본문 이미지 줄 바꾸기", () => {
  it("주소·대체 텍스트를 바꾸고, 뺄 때는 빈 줄을 정리한다", () => {
    expect(swapImageInBody(BODY, "/images/t1-1.webp", "/images/new.webp", "새 설명")).toContain(
      "![새 설명](/images/new.webp)",
    );
    // 정규식 특수 문자가 든 주소도 그대로 찾는다
    expect(
      swapImageInBody("![a](https://x.test/a.jpg?w=1)", "https://x.test/a.jpg?w=1", "/n"),
    ).toBe("![a](/n)");
    const dropped = dropImageFromBody(BODY, "/images/t1-1.webp");
    expect(dropped).not.toContain("t1-1.webp");
    expect(dropped).not.toMatch(/\n{3,}/);
  });
});

describe("검수 중 이미지 바꾸기", () => {
  it("교체하면 본문·목록이 함께 바뀌고 승인한 글은 다시 검수로 돌아간다", () => {
    const db = new Database(":memory:");
    const id = createArticle(db, article());
    approveArticle(db, id, { acceptIssues: true });
    const after = replaceArticleImage(db, id, "img1", {
      url: "/images/a1-img1-new.webp",
      kind: "uploaded",
      subject: "올린 파일: x.jpg",
      alt: "",
    });
    expect(after.status).not.toBe("approved");
    expect(after.body).toContain("![교육 장면](/images/a1-img1-new.webp)");
    expect(after.images[0]).toMatchObject({ id: "img1", kind: "uploaded", alt: "교육 장면" });
  });

  it("빼면 본문에서 사라지고, 최소 장수 미달은 문제로 남는다", () => {
    const db = new Database(":memory:");
    const id = createArticle(db, article());
    const after = removeArticleImage(db, id, "img2");
    expect(after.images.map((i) => i.id)).toEqual(["img1"]);
    expect(after.body).not.toContain("file.example/2.jpg");
    expect(after.status).toBe("draft");
    expect(after.qualityIssues.join(" ")).toMatch(/이미지/);
  });

  it("썸네일 지정은 순서만 바꾸고 상태는 그대로 둔다", () => {
    const db = new Database(":memory:");
    const id = createArticle(db, article());
    approveArticle(db, id, { acceptIssues: true });
    const after = setArticleThumbnail(db, id, "img2");
    expect(after.images.map((i) => i.id)).toEqual(["img2", "img1"]);
    expect(after.status).toBe("approved");
    expect(after.body).toBe(BODY);
  });

  it("발행한 글·없는 이미지는 바꾸지 않는다", () => {
    const db = new Database(":memory:");
    const id = createArticle(db, article());
    expect(() => removeArticleImage(db, id, "img9")).toThrow(ReviewError);
    approveArticle(db, id, { acceptIssues: true });
    markPublished(db, id, "https://www.drivingzone.co.kr/story/license-process/1");
    expect(() => setArticleThumbnail(db, id, "img2")).toThrow(ReviewError);
  });
});

describe("삽화 다시 만들기 작업", () => {
  const generator = (file: string, calls: string[] = []): ImageGenerator => ({
    async generate(scene, fileBase, style) {
      calls.push(`${scene}|${fileBase}|${style}`);
      return file || `${fileBase}.webp`;
    },
  });

  it("새 파일 이름으로 만들어 바꾼다", async () => {
    const db = new Database(":memory:");
    const id = createArticle(db, article());
    const calls: string[] = [];
    const result = await regenerateArticleImage(
      {
        db,
        config,
        llm: llm(db),
        images: generator("", calls),
        now: () => new Date("2026-10-13T01:02:03.456Z"),
      },
      { articleId: id, imageId: "img1", scene: "새 장면", style: "illustration", alt: "새 설명" },
    );
    expect(calls).toEqual([`새 장면|a${id}-img1-20261013010203456|illustration`]);
    expect(result.url).toBe(`/images/a${id}-img1-20261013010203456.webp`);
    expect(getArticle(db, id)!.images[0]).toMatchObject({
      kind: "generated",
      subject: "새 장면",
      alt: "새 설명",
    });
  });

  it("Codex 가 한도로 쉬는 중이면 보류하고, 그새 발행된 글은 건너뛴다", async () => {
    const db = new Database(":memory:");
    const id = createArticle(db, article());
    db.run(
      "INSERT INTO provider_state (provider, blocked_until, reason, updated_at) VALUES ('codex', ?, '한도', ?)",
      [new Date(Date.now() + 3_600_000).toISOString(), new Date().toISOString()],
    );
    const payload = { articleId: id, imageId: "img1", scene: "장면", style: "photo" as const };
    await expect(
      regenerateArticleImage({ db, config, llm: llm(db), images: generator("x.webp") }, payload),
    ).rejects.toBeInstanceOf(LlmUnavailableError);

    approveArticle(db, id, { acceptIssues: true });
    markPublished(db, id, "https://www.drivingzone.co.kr/story/license-process/1");
    const skipped = await regenerateArticleImage(
      { db, config, llm: llm(db), images: generator("x.webp") },
      payload,
    );
    expect(skipped.skipped).toMatch(/published/);
  });
});

describe("올린 파일 저장", () => {
  it("가로 1200px WebP 로 줄이고, 이미지가 아니면 오류를 낸다", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aiw-upload-"));
    try {
      const png = await sharp({
        create: { width: 2400, height: 1600, channels: 3, background: "#3366aa" },
      })
        .png()
        .toBuffer();
      expect(await saveUploadedImage(png, join(dir, "a"))).toBe(".webp");
      expect((await sharp(join(dir, "a.webp")).metadata()).width).toBe(1200);
      await expect(
        saveUploadedImage(new TextEncoder().encode("hello"), join(dir, "b")),
      ).rejects.toThrow(/이미지 파일/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
