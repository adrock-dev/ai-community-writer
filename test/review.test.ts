import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AppContext } from "../src/app.ts";
import {
  approveArticle,
  editArticle,
  markExported,
  markPublished,
  ReviewError,
  rejectArticle,
} from "../src/articles/review.ts";
import { createArticle, getArticle, type NewArticle } from "../src/articles/store.ts";
import { parseConfig } from "../src/config.ts";
import { Database } from "../src/db/database.ts";
import { renderExport, writeExportBundle } from "../src/export/bundle.ts";
import { highlightToBold, markdownToHtml, stripTitle, toCafeText } from "../src/export/render.ts";
import { LlmClient } from "../src/llm/client.ts";
import { Pacer } from "../src/queue/pacer.ts";
import { JobQueue } from "../src/queue/queue.ts";
import { createApp } from "../src/server.ts";

const BODY = [
  "# 인천운전연수 학원 비교",
  "인천운전연수는 시간 구성과 차량 조건을 먼저 비교하세요.",
  "## 비용",
  "연수는 6시간 33만원(부가세 별도)이에요.",
  "![학원 사진](https://file.example/1.jpg)",
  "## 준비",
  "**체크할 점**",
  "- 보험 확인",
  "![삽화](/images/t1-1.png)",
  "<script>alert(1)</script>",
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
    status: "review",
    qualityIssues: [],
    similarArticles: [],
    facts: "6시간 33만원 (부가세 별도)",
    images: [
      {
        id: "img1",
        url: "https://file.example/1.jpg",
        kind: "photo",
        subject: "학원",
        alt: "학원 사진",
      },
      { id: "img2", url: "/images/t1-1.png", kind: "generated", subject: "삽화", alt: "삽화" },
    ],
    generation: {},
    provider: "codex",
    model: "",
    ...over,
  };
}

describe("검수 흐름", () => {
  it("승인 → 내보냄 → 발행, 게시 URL은 http(s)만", () => {
    const db = new Database(":memory:");
    const id = createArticle(db, article());
    expect(approveArticle(db, id).status).toBe("approved");
    expect(markExported(db, id).status).toBe("exported");
    expect(() => markPublished(db, id, "게시함")).toThrow(ReviewError);
    expect(markPublished(db, id, "https://app.drivingplus.me/community/article/1")).toMatchObject({
      status: "published",
      publishedUrl: "https://app.drivingplus.me/community/article/1",
    });
    expect(() => rejectArticle(db, id, "늦음")).toThrow(/published 상태/);
  });

  it("문제가 남은 초안은 확인 표시 없이는 승인하지 않는다", () => {
    const db = new Database(":memory:");
    const id = createArticle(db, article({ status: "draft", qualityIssues: ["이미지 부족"] }));
    expect(() => approveArticle(db, id)).toThrow(/남은 문제 1건/);
    expect(approveArticle(db, id, { acceptIssues: true }).status).toBe("approved");
  });

  it("승인한 글을 고치면 기계 검사를 다시 하고 검수 단계로 돌아간다", () => {
    const db = new Database(":memory:");
    const id = createArticle(db, article());
    approveArticle(db, id);
    const edited = editArticle(db, id, {
      title: "짧음",
      summary: "짧음",
      keywords: [],
      body: "# 짧음\n\n본문 450,000원",
    });
    expect(edited.status).toBe("draft");
    expect(edited.qualityIssues.join("\n")).toMatch(/만 단위|짧습니다|부가세/);
  });
});

describe("내보내기 형식", () => {
  it("본문의 제목 줄을 빼고, 원시 HTML과 스크립트 주소는 실행되지 않게 한다", () => {
    expect(stripTitle("# 제목\n\n본문")).toBe("본문");
    const html = markdownToHtml("<script>alert(1)</script>\n\n[x](javascript:alert(1))");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/href="javascript/);
  });

  it("색 강조(==문구==)는 채널 색 글씨로, 색이 없거나 잘못되면 굵게로 바꾼다", () => {
    expect(markdownToHtml("시험 전 ==신분증== 확인", "#ff5500")).toContain(
      '<span style="color:#ff5500;font-weight:700">신분증</span>',
    );
    expect(markdownToHtml("==**굵게** 안==", "#1474fa")).toContain(
      '<span style="color:#1474fa;font-weight:700"><strong>굵게</strong> 안</span>',
    );
    expect(markdownToHtml("==신분증==")).toContain("<strong>신분증</strong>");
    expect(markdownToHtml("==신분증==", 'red" onclick="x')).toContain("<strong>신분증</strong>");
    // 짝이 없거나 공백으로 시작하면 강조가 아니다
    expect(markdownToHtml("a == b")).not.toContain("<strong>");
    expect(highlightToBold("꼭 ==신분증==을 챙기세요")).toBe("꼭 **신분증**을 챙기세요");
    expect(toCafeText("꼭 ==신분증==을 챙기세요")).toBe("꼭 신분증을 챙기세요");
  });

  it("운전면허PLUS 내보내기는 색 강조를 굵게로, 블로그는 채널 색으로 바꾼다", () => {
    const body = "# 제목\n\n꼭 ==신분증==을 챙기세요.";
    const plus = renderExport({ ...article({ body }), id: 1 } as never);
    expect(plus.primary.content).toBe("꼭 **신분증**을 챙기세요.");
    const zone = renderExport({
      ...article({ channelId: "dztraining-blog", sectionCode: "blog_training", body }),
      id: 2,
    } as never);
    expect(zone.primary.content).toContain("color:#1474fa");
  });

  it("카페 원고는 Markdown 기호를 걷고 사진 위치를 표시한다", () => {
    const text = toCafeText(BODY);
    expect(text).not.toContain("#");
    expect(text).toContain("체크할 점");
    expect(text).toContain("· 보험 확인");
    expect(text).toContain("[사진: 학원 사진]");
  });

  it("채널마다 필드와 본문 형식이 다르다", () => {
    const plus = renderExport({ ...article(), id: 1 } as never);
    expect(plus.primary.kind).toBe("markdown");
    expect(plus.fields.map((f) => f.label)).toContain("SEO 키워드 (seo_keywords)");
    expect(plus.fields.find((f) => f.label.startsWith("노출 대상"))?.value).toMatch(/인천광역시/);
    expect(plus.uploads).toEqual(["t1-1.png"]);

    const zone = renderExport({
      ...article({ channelId: "drivingzone-blog", sectionCode: "blog" }),
      id: 2,
    } as never);
    expect(zone.primary.kind).toBe("html");
    expect(zone.primary.content).toContain("<h2>비용</h2>");
    expect(zone.fields.map((f) => f.label)).toContain("부제목·설명 (sub_title)");
  });

  it("내보내기 폴더에 본문·안내·이미지를 쓰고 생성 삽화 주소를 파일로 바꾼다", async () => {
    const dir = mkdtempSync(join(tmpdir(), "export-"));
    const db = new Database(":memory:");
    const id = createArticle(db, article());
    const out = await writeExportBundle(getArticle(db, id)!, dir);
    const md = readFileSync(join(out, "본문.md"), "utf8");
    expect(md).toContain("![삽화](images/t1-1.png)");
    expect(md).toContain("![학원 사진](https://file.example/1.jpg)");
    expect(readFileSync(join(out, "안내.txt"), "utf8")).toMatch(
      /직접 올려야 하는 이미지.*t1-1\.png/,
    );
    expect(existsSync(join(out, "본문-서식.html"))).toBe(true);
  });
});

describe("관리 화면", () => {
  function setup() {
    const db = new Database(":memory:");
    const config = parseConfig({});
    const queue = new JobQueue(db);
    const ctx = {
      db,
      config,
      queue,
      pacer: new Pacer(db, queue, config.pacing, "generate"),
      llm: new LlmClient(db, config.llm, async () => ({ kind: "error", message: "unused" })),
      handlers: {},
    } as unknown as AppContext;
    return { db, app: createApp(ctx), queue };
  }
  const form = (fields: Record<string, string>) => ({
    method: "POST",
    body: new URLSearchParams(fields),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });

  it("대시보드·주제·글·작업 화면이 열린다", async () => {
    const { db, app } = setup();
    const id = createArticle(db, article());
    for (const path of [
      "/",
      "/topics",
      "/articles",
      "/articles?status=draft",
      `/articles/${id}`,
      "/jobs",
    ]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(200);
    }
    // 목록에 품질 게이트와 같은 기준의 글자 수를 보인다
    expect(await (await app.request("/articles")).text()).toContain("<th>글자</th>");
    const detail = await (await app.request(`/articles/${id}`)).text();
    expect(detail).toContain("인천운전연수 학원 비교");
    expect(detail).toContain("&lt;script&gt;"); // 원고 속 스크립트는 글자로
    expect(detail).not.toContain("<script>alert(1)</script>");
  });

  it("작업 목록에 채널·유형이 보인다 (발행 작업은 글에서 읽는다)", async () => {
    const { db, app, queue } = setup();
    const id = createArticle(db, article({ channelId: "dztraining-blog", articleType: "cost" }));
    queue.enqueue("publish", { articleId: id });
    const jobs = await (await app.request("/jobs")).text();
    expect(jobs).toContain("<th>채널</th><th>유형</th>");
    expect(jobs).toContain("자동 발행");
    expect(jobs).toContain("드라이빙존 연수 블로그");
    expect(jobs).toContain("비용·가격");
    expect(jobs).toContain(`글 #${id}`);
  });

  it("승인 후 내보내기 영역이 열리고, 반려는 사유가 필요하다", async () => {
    const { db, app } = setup();
    const id = createArticle(db, article());
    expect(await (await app.request(`/articles/${id}`)).text()).toContain(
      "승인한 뒤 내보낼 수 있습니다",
    );
    let res = await app.request(`/articles/${id}/approve`, form({}));
    expect(res.headers.get("location")).toBe(`/articles/${id}?done=approved`);
    const html = await (await app.request(`/articles/${id}`)).text();
    expect(html).toContain("본문 (Markdown, content_format=md)");
    expect(html).toContain("서식 포함 복사");

    res = await app.request(`/articles/${id}/publish`, form({ url: "nope" }));
    expect(decodeURIComponent(res.headers.get("location") ?? "")).toMatch(/error=게시 URL/);
  });

  it("승인한 글은 자동 발행 작업을 한 번만 예약하고, 카페 원고는 자동 발행하지 않는다", async () => {
    const { db, app, queue } = setup();
    const id = createArticle(db, article({ status: "approved" }));
    expect(await (await app.request(`/articles/${id}`)).text()).toContain("자동 발행");
    await app.request(`/articles/${id}/auto-publish`, form({}));
    await app.request(`/articles/${id}/auto-publish`, form({}));
    expect(queue.list(10).filter((j) => j.kind === "publish")).toHaveLength(1);
    expect(queue.list(1)[0]).toMatchObject({ kind: "publish", payload: { articleId: id } });

    const cafe = createArticle(
      db,
      article({ status: "approved", channelId: "drivingzone-cafe", sectionCode: "cafe" }),
    );
    const res = await app.request(`/articles/${cafe}/auto-publish`, form({}));
    expect(decodeURIComponent(res.headers.get("location") ?? "")).toMatch(
      /자동 발행 대상이 아닙니다/,
    );
  });

  it("반려 후 다시 생성하면 주제로 생성 작업을 넣는다", async () => {
    const { db, app, queue } = setup();
    const now = new Date().toISOString();
    const topicId = db.run(
      `INSERT INTO topics (primary_keyword, channel_id, section_code, article_type, created_at, updated_at, topic_key)
       VALUES ('인천운전연수', 'drivingplus-community', 'drive_story', 'training', ?, ?, '인천운전연수')`,
      [now, now],
    ).lastInsertRowid;
    const id = createArticle(db, article({ topicId }));
    await app.request(`/articles/${id}/regenerate`, form({ note: "톤 변경" }));
    expect(getArticle(db, id)).toMatchObject({
      status: "rejected",
      reviewNote: "다시 생성: 톤 변경",
    });
    expect(queue.list(1)[0]).toMatchObject({ kind: "generate", payload: { topicId } });
  });
});
