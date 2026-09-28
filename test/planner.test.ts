import { describe, expect, it } from "vitest";
import type { AppContext } from "../src/app.ts";
import { parseConfig } from "../src/config.ts";
import { Database } from "../src/db/database.ts";
import { buildRegionIndex } from "../src/keywords/regions.ts";
import type { KeywordStat } from "../src/keywords/searchad.ts";
import { JobQueue } from "../src/queue/queue.ts";
import { createApp } from "../src/server.ts";
import { collectKeywords, scoreTopic } from "../src/topics/planner.ts";
import { listTopics, setTopicStatus } from "../src/topics/store.ts";

const stat = (keyword: string, total: number, competition = "중간"): KeywordStat => ({
  keyword,
  pc: 0,
  mobile: total,
  total,
  competition,
});

const RELATED: Record<string, KeywordStat[]> = {
  운전연수: [
    stat("운전연수", 30000),
    stat("운전 연수", 100),
    stat("강남운전연수", 2000, "낮음"),
    stat("운전연수비용", 5000),
    stat("운전면허필기시험", 50000),
    stat("대리운전", 90000),
    stat("장롱면허연수", 10),
  ],
};

function deps(db: Database, extra: object = {}) {
  const calls: string[][] = [];
  return {
    calls,
    deps: {
      db,
      keywords: parseConfig({}).keywords,
      searchad: {
        relatedKeywords: async (hints: string[]) => {
          calls.push(hints);
          return hints.flatMap((h) => RELATED[h] ?? []);
        },
      },
      regions: buildRegionIndex(["서울특별시 강남구"]),
      seeds: [
        {
          channelId: "dztraining-blog",
          sectionCode: "blog_training",
          seeds: ["운전연수"],
          include: ["연수"],
          exclude: ["필기"],
        },
      ],
      filter: { include: ["운전", "면허", "연수"], exclude: ["대리운전"] },
      now: new Date(2026, 8, 28, 10),
      ...extra,
    },
  };
}

describe("scoreTopic", () => {
  it("검색 수는 로그 스케일, 이미 쓴 글이 있으면 낮춘다", () => {
    const base = { competition: "중간", similarArticles: 0 };
    expect(scoreTopic({ ...base, volume: 9999 })).toBe(4);
    expect(scoreTopic({ ...base, volume: 9999, competition: "낮음" })).toBe(4.6);
    expect(scoreTopic({ ...base, volume: 9999, trend: 3 })).toBe(6);
    expect(scoreTopic({ ...base, volume: 9999, similarArticles: 2 })).toBe(2);
    expect(scoreTopic({ ...base, volume: 9999, writtenElsewhere: 1 })).toBe(2);
  });
});

describe("collectKeywords", () => {
  it("공통·섹션 필터와 최소 검색 수를 거쳐 묶은 뒤 주제로 저장한다", async () => {
    const db = new Database(":memory:");
    const { deps: d } = deps(db);
    const summary = await collectKeywords(d);
    // 드라이빙존 연수 블로그는 지역 글을 쓰지 않으므로 "강남운전연수"는 뺀다
    expect(summary.sections[0]).toMatchObject({
      fetched: 7,
      kept: 4,
      regionalDropped: 1,
      topics: 2,
    });

    const topics = listTopics(db, { channelId: "dztraining-blog" });
    expect(topics.map((t) => t.primaryKeyword)).toEqual(["운전연수", "운전연수비용"]);
    expect(topics.every((t) => t.region === "")).toBe(true);
    expect(topics[1]?.articleType).toBe("cost");
    expect(db.get("SELECT COUNT(*) AS n FROM keyword_stats")).toEqual({ n: 4 });
    // "운전 연수"(100)는 "운전연수"(30000)에 합쳐진다
    expect(topics[0]?.volume).toBe(30100);
    expect(summary.warnings[0]).toMatch(/데이터랩/);
  });

  it("지역 주제는 운전면허PLUS(regional 채널)에만 만든다", async () => {
    const db = new Database(":memory:");
    const { deps: d } = deps(db);
    d.seeds = [{ ...d.seeds[0]!, channelId: "drivingplus-community", sectionCode: "drive_story" }];
    const summary = await collectKeywords(d);
    expect(summary.sections[0]).toMatchObject({ regionalDropped: 0, topics: 3 });
    const topics = listTopics(db, { channelId: "drivingplus-community" });
    // 점수순: 검색 수는 적어도 광고 경쟁이 낮은 지역 주제가 비용 주제보다 앞선다
    expect(topics.map((t) => t.primaryKeyword)).toEqual([
      "운전연수",
      "강남운전연수",
      "운전연수비용",
    ]);
    expect(topics.find((t) => t.primaryKeyword === "강남운전연수")).toMatchObject({
      region: "서울특별시 강남구",
      articleType: "training",
      volume: 2000,
      competition: "낮음",
    });
  });

  it("예전 수집이 드라이빙존 채널에 만든 지역 후보는 다음 수집 때 지운다", async () => {
    const db = new Database(":memory:");
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO topics (primary_keyword, channel_id, section_code, created_at, updated_at, topic_key, region)
       VALUES ('강남운전연수', 'dztraining-blog', 'blog_training', ?, ?, '강남운전연수', '서울특별시 강남구')`,
      [now, now],
    );
    await collectKeywords(deps(db).deps);
    expect(listTopics(db).map((t) => t.primaryKeyword)).not.toContain("강남운전연수");
  });

  it("다시 수집해도 주제가 중복되지 않고, 운영자가 건너뛴 상태는 유지한다", async () => {
    const db = new Database(":memory:");
    await collectKeywords(deps(db).deps);
    const first = listTopics(db)[0]!;
    setTopicStatus(db, first.id, "skipped", "이미 다룸");
    await collectKeywords(deps(db).deps);
    expect(listTopics(db)).toHaveLength(2);
    expect(listTopics(db, { status: "skipped" })[0]).toMatchObject({
      id: first.id,
      note: "이미 다룸",
    });
  });

  it("같은 주제를 쓴 글은 같은 브랜드 채널만 감점한다 (운전면허PLUS와 드라이빙존은 별개)", async () => {
    const db = new Database(":memory:");
    const score = async () => {
      await collectKeywords(deps(db).deps);
      return listTopics(db, { channelId: "dztraining-blog" }).find(
        (t) => t.primaryKeyword === "운전연수",
      )!.score;
    };
    const writeArticle = (channelId: string, sectionCode: string) => {
      const now = new Date().toISOString();
      const topicId = db.run(
        `INSERT INTO topics (primary_keyword, channel_id, section_code, created_at, updated_at, topic_key)
         VALUES ('운전연수', ?, ?, ?, ?, '운전연수')`,
        [channelId, sectionCode, now, now],
      ).lastInsertRowid;
      db.run(
        `INSERT INTO articles (topic_id, channel_id, section_code, title, body, format, created_at, updated_at)
         VALUES (?, ?, ?, 't', 'b', 'markdown', ?, ?)`,
        [topicId, channelId, sectionCode, now, now],
      );
    };

    const base = await score();
    writeArticle("drivingplus-community", "drive_story");
    expect(await score()).toBe(base);
    writeArticle("drivingzone-cafe", "cafe");
    expect(await score()).toBeLessThan(base);
  });

  it("한 섹션이 실패해도 나머지는 진행한다", async () => {
    const db = new Database(":memory:");
    const { deps: d } = deps(db);
    d.seeds = [
      {
        channelId: "drivingzone-cafe",
        sectionCode: "cafe",
        seeds: ["실패"],
        include: [],
        exclude: [],
      },
      ...d.seeds,
    ];
    const orig = d.searchad.relatedKeywords;
    d.searchad.relatedKeywords = async (hints) => {
      if (hints[0] === "실패") throw new Error("API 오류");
      return orig(hints);
    };
    const summary = await collectKeywords(d);
    expect(summary.sections.map((s) => s.error ?? "ok")).toEqual(["API 오류", "ok"]);
    expect(listTopics(db)).toHaveLength(2);
  });

  it("추세는 상위 묶음만 조회해 점수에 반영하고, 실패하면 경고만 남긴다", async () => {
    const db = new Database(":memory:");
    const { deps: d } = deps(db, {
      trends: async (groups: Record<string, string[]>) => {
        expect(Object.keys(groups)).toContain("운전연수");
        return { 운전연수: 1.4 };
      },
    });
    await collectKeywords(d);
    expect(listTopics(db).find((t) => t.primaryKeyword === "운전연수")?.trend).toBe(1.4);

    const db2 = new Database(":memory:");
    const failing = deps(db2, {
      trends: async () => {
        throw new Error("quota");
      },
    }).deps;
    expect((await collectKeywords(failing)).warnings[0]).toMatch(/quota/);
  });
});

describe("주제 API", () => {
  function ctx(): AppContext {
    const db = new Database(":memory:");
    return { db, queue: new JobQueue(db), config: parseConfig({}) } as unknown as AppContext;
  }

  it("수집 요청은 작업 큐에 들어가고, 주제는 조회·상태 변경할 수 있다", async () => {
    const c = ctx();
    const app = createApp(c);
    const res = await app.request("/api/keywords/collect", { method: "POST" });
    expect(res.status).toBe(202);
    expect(c.queue.get(((await res.json()) as { jobId: number }).jobId)?.kind).toBe(
      "collect_keywords",
    );

    await collectKeywords(deps(c.db).deps);
    const list = (await (
      await app.request("/api/topics?channel=dztraining-blog&limit=2")
    ).json()) as {
      id: number;
    }[];
    expect(list).toHaveLength(2);

    const patch = await app.request(`/api/topics/${list[0]!.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "skipped" }),
      headers: { "content-type": "application/json" },
    });
    expect(patch.status).toBe(200);
    expect((await app.request("/api/topics?status=bogus")).status).toBe(400);
  });
});
