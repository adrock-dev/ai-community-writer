import { describe, expect, it } from "vitest";
import { createArticle, getArticle, type NewArticle } from "../src/articles/store.ts";
import { findSection } from "../src/channels.ts";
import { parseConfig } from "../src/config.ts";
import { Database } from "../src/db/database.ts";
import {
  audienceAreas,
  blogSlug,
  communityPayload,
  replaceUrls,
  sourceKeyFor,
} from "../src/publish/payload.ts";
import { publishArticle } from "../src/publish/publisher.ts";

const BODY = [
  "# 인천운전연수 학원 비교",
  "인천운전연수는 시간 구성과 차량 조건을 먼저 비교하세요.",
  "## 비용",
  "![학원 사진](https://file.drivingplus.me/a.jpg)",
  "## 준비",
  "![코스 예시 이미지](/images/t1-1.png)",
].join("\n\n");

function article(over: Partial<NewArticle> = {}): NewArticle {
  return {
    topicId: null,
    channelId: "drivingplus-community",
    sectionCode: "drive_story",
    articleType: "training",
    region: "인천광역시",
    title: "인천운전연수 학원 비교",
    summary: "요약",
    body: BODY,
    format: "markdown",
    keywords: ["인천운전연수", "도로연수"],
    status: "approved",
    qualityIssues: [],
    similarArticles: [],
    facts: "",
    images: [
      {
        id: "img1",
        url: "https://file.drivingplus.me/a.jpg",
        kind: "photo",
        subject: "학원",
        alt: "학원 사진",
      },
      { id: "img2", url: "/images/t1-1.png", kind: "generated", subject: "코스", alt: "코스" },
    ],
    generation: {},
    provider: "codex",
    model: "",
    ...over,
  };
}

/** 대상 API·사진 서버·IndexNow 를 흉내 내고 요청을 기록한다. */
function fakeFetch(opts: { putStatus?: number } = {}) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify({ code: status, message: "ok", data }), {
      status,
      headers: { "content-type": "application/json" },
    });
  let uploads = 0;
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body =
      typeof init?.body === "string" ? JSON.parse(init.body) : init?.body ? "form" : undefined;
    calls.push({ url, method, body });
    if (url.endsWith("/images")) {
      uploads++;
      return json({ upfileId: 100 + uploads, url: `https://file.example/up${uploads}.png` });
    }
    if (method === "PUT") {
      if (opts.putStatus && opts.putStatus !== 200) {
        return new Response(JSON.stringify({ message: "칸이 없습니다" }), {
          status: opts.putStatus,
        });
      }
      return url.includes("/community/")
        ? json({ id: 77, path: "/community/article/77", created: true, regionIds: [90] })
        : json({ id: 901, created: true });
    }
    if (url.includes("indexnow")) return new Response("", { status: 202 });
    if (url.startsWith("https://file.")) return new Response(new Uint8Array([1, 2, 3]));
    return new Response("", { status: 404 });
  }) as typeof fetch;
  return { impl, calls };
}

function setup() {
  const db = new Database(":memory:");
  const config = parseConfig({
    publish: { drivingplusApi: "https://api.test", drivingzoneApi: "https://dz.test" },
  });
  return { db, config };
}

const deps = (db: Database, config: ReturnType<typeof parseConfig>, impl: typeof fetch) => ({
  db,
  config,
  fetch: impl,
  keys: { drivingplus: "k1", drivingzone: "k2" },
  readImage: async () => new Uint8Array([9]),
});

describe("발행 요청 본문", () => {
  it("지역 키를 시도·시군구로 나눈다", () => {
    expect(audienceAreas("인천광역시")).toEqual([{ siDo: "인천광역시" }]);
    expect(audienceAreas("경기도 고양시 일산동구|경기도 고양시 일산서구")).toEqual([
      { siDo: "경기도", siGunGu: "고양시 일산동구" },
      { siDo: "경기도", siGunGu: "고양시 일산서구" },
    ]);
    expect(audienceAreas("")).toEqual([]);
  });

  it("블로그 슬러그는 사이트의 slugify 와 같다", () => {
    expect(blogSlug("장롱 면허 연수", 12)).toBe(
      `${encodeURIComponent("장롱 면허 연수").toLowerCase()}-12`,
    );
  });

  it("식별자·주소 치환", () => {
    expect(sourceKeyFor("AB12", 3)).toBe("aiw-ab12:3");
    expect(replaceUrls("a /images/x.png b /images/x.png", new Map([["/images/x.png", "U"]]))).toBe(
      "a U b U",
    );
  });

  it("지역 글이 아닌 채널이면 노출 대상은 항상 전국", () => {
    const a = { ...article(), id: 1, externalId: "", publishError: "" } as never;
    const section = findSection("drivingplus-community", "drive_story")!;
    const base = { article: a, section, primaryKeyword: "인천운전연수", content: "x" };
    expect(communityPayload({ ...base, regional: true }).audienceAreas).toEqual([
      { siDo: "인천광역시" },
    ]);
    expect(communityPayload({ ...base, regional: false }).audienceAreas).toEqual([]);
    expect(communityPayload({ ...base, regional: true }).filterCodes).toEqual(["driving_info"]);
  });
});

describe("publishArticle", () => {
  it("커뮤니티: 삽화를 올려 주소를 바꾸고, 지역·칸과 함께 게시한 뒤 주소를 기록한다", async () => {
    const { db, config } = setup();
    const id = createArticle(db, article());
    const { impl, calls } = fakeFetch();
    const result = await publishArticle(deps(db, config, impl), id);

    expect(result).toMatchObject({ externalId: "77", created: true });
    expect(result.url).toBe("https://app.drivingplus.me/community/article/77");
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toMatch(
      /^https:\/\/api\.test\/v1\/writer\/community\/posts\/aiw-[0-9a-f]{8}%3A\d+$/,
    );
    const body = put.body as Record<string, unknown>;
    expect(body.content).toContain("https://file.example/up1.png");
    expect(body.content).not.toContain("/images/");
    expect(body.content).not.toMatch(/^# /m); // 제목 줄은 대상 제목 필드와 겹치므로 뺀다
    expect(body).toMatchObject({
      sectionCode: "drive_story",
      filterCodes: ["driving_info"],
      audienceAreas: [{ siDo: "인천광역시" }],
      contentFormat: "md",
    });
    // 첫 이미지가 실제 사진이면 커뮤니티 썸네일은 올리지 않는다(본문 첫 이미지로 폴백)
    expect(calls.filter((c) => c.url.endsWith("/images"))).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes("indexnow"))).toHaveLength(2);
    expect(getArticle(db, id)).toMatchObject({
      status: "published",
      externalId: "77",
      publishedUrl: result.url,
      publishError: "",
    });
  });

  it("블로그: 첫 사진을 받아 썸네일로 올리고 HTML 본문으로 게시한다", async () => {
    const { db, config } = setup();
    const id = createArticle(
      db,
      article({
        channelId: "dztraining-blog",
        sectionCode: "blog_training",
        region: "인천광역시", // 예전 데이터에 지역이 남아 있어도 블로그 요청에는 지역이 없다
        format: "html",
      }),
    );
    const { impl, calls } = fakeFetch();
    const result = await publishArticle(deps(db, config, impl), id);
    expect(result.url).toBe(
      `https://www.dztraining.co.kr/blog/${blogSlug("인천운전연수 학원 비교", 901)}`,
    );
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toMatch(/^https:\/\/dz\.test\/v1\/writer\/articles\//);
    const body = put.body as Record<string, unknown>;
    expect(body).toMatchObject({
      boardType: "blog_training",
      status: "enable",
      thumbUpfileId: 102,
    });
    expect(body).not.toHaveProperty("audienceAreas");
    expect(String(body.content)).toContain("<h2>");
    // 드라이빙존 사이트에는 IndexNow 키가 없어 통보하지 않는다
    expect(calls.some((c) => c.url.includes("indexnow"))).toBe(false);
  });

  it("다시 보내면 올린 이미지를 다시 올리지 않고 같은 식별자로 보낸다", async () => {
    const { db, config } = setup();
    const id = createArticle(db, article());
    const first = fakeFetch();
    await publishArticle(deps(db, config, first.impl), id);
    db.run("UPDATE articles SET status = 'approved' WHERE id = ?", [id]);
    const second = fakeFetch();
    await publishArticle(deps(db, config, second.impl), id);
    expect(second.calls.filter((c) => c.url.endsWith("/images"))).toHaveLength(0);
    expect(second.calls.find((c) => c.method === "PUT")!.url).toBe(
      first.calls.find((c) => c.method === "PUT")!.url,
    );
  });

  it("승인 전·원고 전용 채널·키 없음·대상 오류는 게시하지 않는다", async () => {
    const { db, config } = setup();
    const { impl } = fakeFetch();
    const review = createArticle(db, article({ status: "review" }));
    await expect(publishArticle(deps(db, config, impl), review)).rejects.toThrow(/승인 후/);

    const cafe = createArticle(db, article({ channelId: "drivingzone-cafe", sectionCode: "cafe" }));
    await expect(publishArticle(deps(db, config, impl), cafe)).rejects.toThrow(/원고만/);

    const ok = createArticle(db, article());
    await expect(
      publishArticle({ ...deps(db, config, impl), keys: { drivingplus: "" } }, ok),
    ).rejects.toThrow(/발행 API 키가 없습니다/);

    const bad = fakeFetch({ putStatus: 400 });
    await expect(publishArticle(deps(db, config, bad.impl), ok)).rejects.toThrow(
      /400: 칸이 없습니다/,
    );
    expect(getArticle(db, ok)?.status).toBe("approved");
  });
});
