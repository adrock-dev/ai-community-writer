import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.ts";
import { Database } from "../src/db/database.ts";
import { saveOptimizedImage } from "../src/images/optimize.ts";
import {
  hasSavedImageStyles,
  imageStyleFor,
  imageStyleSettings,
  resetImageStyles,
  saveImageStyles,
} from "../src/images/style.ts";
import { mountImageSettings } from "../src/web/images.ts";

describe("삽화 화풍 설정", () => {
  const config = parseConfig({
    images: { style: "photo", styleByChannel: { "drivingzone-cafe": "mixed" } },
  });

  it("화면 저장 값이 config.json 값보다 우선하고, 지우면 config.json 값으로 돌아간다", () => {
    const db = new Database(":memory:");
    expect(imageStyleSettings(db, config)).toEqual(config.images);
    expect(hasSavedImageStyles(db)).toBe(false);

    saveImageStyles(db, { style: "illustration", styleByChannel: { "drivingzone-blog": "photo" } });
    const saved = imageStyleSettings(db, config);
    expect(imageStyleFor(saved, "drivingzone-blog")).toBe("photo");
    // 화면 저장 값은 통째로 적용된다 (config.json 의 채널별 값과 섞지 않는다)
    expect(imageStyleFor(saved, "drivingzone-cafe")).toBe("illustration");

    resetImageStyles(db);
    expect(imageStyleSettings(db, config)).toEqual(config.images);
  });

  it("깨진 저장 값은 무시하고, 없어진 채널·잘못된 화풍은 버린다", () => {
    const db = new Database(":memory:");
    db.setState("image_styles", "{broken");
    expect(imageStyleSettings(db, config)).toEqual(config.images);
    db.setState(
      "image_styles",
      JSON.stringify({
        style: "mixed",
        styleByChannel: { gone: "photo", "drivingzone-blog": "anime" },
      }),
    );
    expect(imageStyleSettings(db, config)).toEqual({ style: "mixed", styleByChannel: {} });
  });

  it("화면에서 채널별로 저장하고 되돌린다", async () => {
    const db = new Database(":memory:");
    const app = new Hono();
    mountImageSettings(app, db, config);
    const post = (path: string, fields: Record<string, string>) =>
      app.request(path, {
        method: "POST",
        body: new URLSearchParams(fields),
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });

    expect(await (await app.request("/settings/images")).text()).toContain(
      "config.json 값 사용 중",
    );

    let res = await post("/settings/images", {
      style: "photo",
      "channel:drivingzone-blog": "illustration",
      "channel:drivingzone-cafe": "",
    });
    expect(res.status).toBe(303);
    expect(imageStyleSettings(db, config)).toEqual({
      style: "photo",
      styleByChannel: { "drivingzone-blog": "illustration" },
    });
    expect(await (await app.request("/settings/images")).text()).toContain(
      "화면에서 저장한 값 사용 중",
    );

    res = await post("/settings/images", { style: "anime" });
    expect(res.status).toBe(400);
    res = await post("/settings/images", { style: "photo", "channel:drivingzone-blog": "x" });
    expect(res.status).toBe(400);

    await post("/settings/images/reset", {});
    expect(hasSavedImageStyles(db)).toBe(false);
  });
});

describe("삽화 용량 줄이기", () => {
  it("큰 PNG 는 가로 1200px WebP 로 줄이고, 변환 실패 시 원본을 그대로 둔다", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aiw-img-"));
    try {
      const src = join(dir, "image.png");
      await sharp({
        create: { width: 1536, height: 1024, channels: 3, background: { r: 40, g: 120, b: 200 } },
      })
        .png()
        .toFile(src);
      expect(await saveOptimizedImage(src, join(dir, "t1-1"), ".png")).toBe(".webp");
      const meta = await sharp(join(dir, "t1-1.webp")).metadata();
      expect(meta).toMatchObject({ format: "webp", width: 1200, height: 800 });

      const broken = join(dir, "broken.png");
      writeFileSync(broken, "not an image");
      const logs: string[] = [];
      expect(await saveOptimizedImage(broken, join(dir, "t1-2"), ".png", (m) => logs.push(m))).toBe(
        ".png",
      );
      expect(existsSync(join(dir, "t1-2.png"))).toBe(true);
      expect(logs[0]).toContain("원본 저장");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
