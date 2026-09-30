import { describe, expect, it } from "vitest";
import type { AppContext } from "../src/app.ts";
import { parseConfig } from "../src/config.ts";
import { Database } from "../src/db/database.ts";
import { buildRegionIndex } from "../src/keywords/regions.ts";
import type { KeywordStat } from "../src/keywords/searchad.ts";
import { JobQueue } from "../src/queue/queue.ts";
import { createApp } from "../src/server.ts";
import { fingerprint, sameTopicArticles, saveFingerprint } from "../src/similarity/fingerprint.ts";
import { collectKeywords } from "../src/topics/planner.ts";
import {
  addManualTopics,
  copyTopic,
  lookupKeywordVolume,
  parseTarget,
  topicTargets,
} from "../src/topics/reuse.ts";
import { getTopic } from "../src/topics/store.ts";

const stat = (keyword: string, total: number, competition = "중간"): KeywordStat => ({
  keyword,
  pc: 0,
  mobile: total,
  total,
  competition,
});

function insertTopic(
  db: Database,
  over: { keyword: string; channel: string; section: string; region?: string },
) {
  const now = new Date().toISOString();
  return db.run(
    `INSERT INTO topics (primary_keyword, secondary_keywords, channel_id, section_code, article_type, score,
       status, created_at, updated_at, topic_key, region, volume, competition)
     VALUES (?, '["보조"]', ?, ?, 'cost', 3, 'written', ?, ?, ?, ?, 5000, '낮음')`,
    [
      over.keyword,
      over.channel,
      over.section,
      now,
      now,
      over.keyword.replace(/\s+/g, ""),
      over.region ?? "",
    ],
  ).lastInsertRowid;
}

describe("주제 복사", () => {
  it("다른 채널에 같은 키워드의 후보를 만들고, 다시 복사하면 있던 주제를 돌려준다", () => {
    const db = new Database(":memory:");
    const id = insertTopic(db, {
      keyword: "운전면허학원비용",
      channel: "drivingplus-community",
      section: "drive_story",
    });
    const first = copyTopic(db, id, { channelId: "drivingzone-blog", sectionCode: "blog" });
    expect(first.created).toBe(true);
    expect(first.topic).toMatchObject({
      primaryKeyword: "운전면허학원비용",
      secondaryKeywords: ["보조"],
      channelId: "drivingzone-blog",
      articleType: "cost",
      status: "candidate",
      origin: "copied",
      volume: 5000,
    });
    const again = copyTopic(db, id, { channelId: "drivingzone-blog", sectionCode: "blog" });
    expect(again).toMatchObject({ created: false, topic: { id: first.topic.id } });
  });

  it("지역 주제는 지역 글을 쓰는 채널로만, 같은 칸으로는 복사하지 않는다", () => {
    const db = new Database(":memory:");
    const id = insertTopic(db, {
      keyword: "강남운전학원",
      channel: "drivingplus-community",
      section: "drive_story",
      region: "서울특별시 강남구",
    });
    expect(() =>
      copyTopic(db, id, { channelId: "dztraining-blog", sectionCode: "blog_training" }),
    ).toThrow("지역 글을 쓰지 않습니다");
    expect(() =>
      copyTopic(db, id, { channelId: "drivingplus-community", sectionCode: "drive_story" }),
    ).toThrow("같은 채널·섹션");
    expect(
      copyTopic(db, id, { channelId: "drivingplus-community", sectionCode: "license_tips" })
        .created,
    ).toBe(true);
  });

  it("화면의 채널/섹션 값은 정의된 것만 받는다", () => {
    expect(parseTarget("drivingzone-blog/blog")).toEqual({
      channelId: "drivingzone-blog",
      sectionCode: "blog",
    });
    expect(parseTarget("drivingzone-blog/drive_story")).toBeUndefined();
    expect(topicTargets().map((t) => t.label)).toContain("운전면허PLUS 커뮤니티 · 운전이야기");
  });
});

describe("주제 직접 추가", () => {
  const targets = [
    { channelId: "drivingzone-blog", sectionCode: "blog" },
    { channelId: "dztraining-blog", sectionCode: "blog_training" },
  ];

  it("고른 채널마다 주제를 만들고, 같은 키워드면 글 방향만 바꾼다", () => {
    const db = new Database(":memory:");
    const { topics, created } = addManualTopics(db, {
      primaryKeyword: " 운전면허  시뮬레이터 ",
      secondaryKeywords: ["기능시험 연습", "기능시험연습", "운전면허시뮬레이터", ""],
      articleType: "tips",
      brief: "학원 가기 전 기본 조작 연습",
      targets,
      volume: { total: 800, competition: "낮음" },
    });
    expect(created).toBe(2);
    expect(topics[0]).toMatchObject({
      primaryKeyword: "운전면허 시뮬레이터",
      secondaryKeywords: ["기능시험연습"],
      articleType: "tips",
      origin: "manual",
      brief: "학원 가기 전 기본 조작 연습",
      region: "",
      volume: 800,
    });
    expect(topics[0]!.score).toBeGreaterThan(0);

    const again = addManualTopics(db, {
      primaryKeyword: "운전면허시뮬레이터",
      secondaryKeywords: [],
      brief: "T자 코스 반복 연습",
      targets: targets.slice(0, 1),
      volume: { total: 0, competition: "" },
    });
    expect(again.created).toBe(0);
    expect(again.topics[0]).toMatchObject({ id: topics[0]!.id, brief: "T자 코스 반복 연습" });
  });

  it("유형을 고르지 않으면 대표 키워드로 판정하고, 키워드·채널이 없으면 막는다", () => {
    const db = new Database(":memory:");
    const { topics } = addManualTopics(db, {
      primaryKeyword: "운전면허학원비용",
      secondaryKeywords: [],
      brief: "",
      targets,
      volume: { total: 0, competition: "" },
    });
    expect(topics[0]!.articleType).toBe("cost");
    const base = { secondaryKeywords: [], brief: "", volume: { total: 0, competition: "" } };
    expect(() => addManualTopics(db, { ...base, primaryKeyword: " ", targets })).toThrow(
      "대표 키워드",
    );
    expect(() => addManualTopics(db, { ...base, primaryKeyword: "x", targets: [] })).toThrow(
      "채널",
    );
  });

  it("키워드 수집이 같은 키워드를 찾아도 운영자가 고른 유형·출처·글 방향은 유지한다", async () => {
    const db = new Database(":memory:");
    addManualTopics(db, {
      primaryKeyword: "운전연수",
      secondaryKeywords: [],
      articleType: "tips",
      brief: "방향",
      targets: [targets[1]!],
      volume: { total: 0, competition: "" },
    });
    await collectKeywords({
      db,
      keywords: parseConfig({}).keywords,
      searchad: { relatedKeywords: async () => [stat("운전연수", 30000)] },
      regions: buildRegionIndex([]),
      seeds: [
        {
          channelId: "dztraining-blog",
          sectionCode: "blog_training",
          seeds: ["운전연수"],
          include: [],
          exclude: [],
        },
      ],
      filter: { include: [], exclude: [] },
    });
    const topic = getTopic(db, 1)!;
    expect(topic).toMatchObject({
      articleType: "tips",
      origin: "manual",
      brief: "방향",
      volume: 30000,
    });
  });
});

describe("검색 수 조회", () => {
  it("최근 수집 기록을 띄어쓰기 변형까지 더하고, 없으면 API로 조회한다", async () => {
    const db = new Database(":memory:");
    for (const [k, day, total] of [
      ["운전 연수", "2026-09-01", 1],
      ["운전연수", "2026-09-28", 300],
      ["운전 연수", "2026-09-28", 20],
    ] as const) {
      db.run(
        "INSERT INTO keyword_stats (keyword, collected_on, pc, mobile, total, competition) VALUES (?, ?, 0, ?, ?, '중간')",
        [k, day, total, total],
      );
    }
    expect(await lookupKeywordVolume(db, "운전연수")).toEqual({
      total: 320,
      competition: "중간",
      source: "stored",
    });

    const api = {
      relatedKeywords: async () => [stat("시뮬레이터", 90), stat("운전면허시뮬레이터", 40, "낮음")],
    };
    expect(await lookupKeywordVolume(db, "운전면허 시뮬레이터", api)).toEqual({
      total: 40,
      competition: "낮음",
      source: "api",
    });
    const failing = {
      relatedKeywords: async () => {
        throw new Error("401");
      },
    };
    expect(await lookupKeywordVolume(db, "없는키워드", failing)).toMatchObject({
      total: 0,
      source: "none",
      error: "401",
    });
  });
});

describe("같은 주제의 다른 채널 글", () => {
  it("대표 키워드가 같은 다른 채널 글을 피할 패턴으로 돌려준다(반려·같은 채널 제외)", () => {
    const db = new Database(":memory:");
    const topicA = insertTopic(db, {
      keyword: "운전면허비용",
      channel: "drivingzone-blog",
      section: "blog",
    });
    const topicB = insertTopic(db, {
      keyword: "운전면허비용",
      channel: "drivingplus-community",
      section: "drive_story",
    });
    const now = new Date().toISOString();
    const article = (topicId: number, channelId: string, title: string, status: string) => {
      const id = db.run(
        `INSERT INTO articles (topic_id, channel_id, section_code, article_type, title, body, format, status, created_at, updated_at)
         VALUES (?, ?, 's', 'cost', ?, '## 소제목\n본문', 'markdown', ?, ?, ?)`,
        [topicId, channelId, title, status, now, now],
      ).lastInsertRowid;
      saveFingerprint(db, id, fingerprint("## 소제목\n본문"));
    };
    article(topicA, "drivingzone-blog", "블로그 글", "review");
    article(topicB, "drivingplus-community", "커뮤니티 글", "approved");
    article(topicB, "drivingplus-community", "반려 글", "rejected");
    expect(sameTopicArticles(db, "운전면허비용", "dztraining-blog").map((a) => a.title)).toEqual([
      "커뮤니티 글",
      "블로그 글",
    ]);
    expect(sameTopicArticles(db, "운전면허비용", "drivingzone-blog").map((a) => a.title)).toEqual([
      "커뮤니티 글",
    ]);
  });
});

describe("주제 화면", () => {
  function ctx(): AppContext {
    const db = new Database(":memory:");
    const config = parseConfig({ naver: { searchadEnvFile: "./없는-인증-파일.env" } });
    return { db, queue: new JobQueue(db), config } as unknown as AppContext;
  }
  const form = (fields: [string, string][]) => {
    const body = new URLSearchParams(fields);
    return {
      method: "POST",
      body,
      headers: { "content-type": "application/x-www-form-urlencoded" },
    };
  };

  it("직접 추가는 고른 채널마다 주제를 만들고, 요청하면 생성을 예약한다", async () => {
    const c = ctx();
    const app = createApp(c);
    // 수집 기록이 있으면 검색광고 API를 부르지 않는다
    c.db.run(
      "INSERT INTO keyword_stats (keyword, collected_on, pc, mobile, total, competition) VALUES ('운전면허시뮬레이터', '2026-09-28', 0, 70, 70, '낮음')",
    );
    const res = await app.request(
      "/topics/manual",
      form([
        ["primaryKeyword", "운전면허시뮬레이터"],
        ["secondaryKeywords", "기능시험 연습, T자 코스"],
        ["articleType", "tips"],
        ["brief", "학원 가기 전 연습"],
        ["target", "drivingzone-blog/blog"],
        ["target", "dztraining-blog/blog_training"],
        ["queue", "1"],
      ]),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("done=addedQueued");
    const rows = c.db.all<{ channel_id: string; status: string; volume: number }>(
      "SELECT channel_id, status, volume FROM topics ORDER BY id",
    );
    expect(rows).toEqual([
      { channel_id: "drivingzone-blog", status: "queued", volume: 70 },
      { channel_id: "dztraining-blog", status: "queued", volume: 70 },
    ]);
    expect(c.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM jobs")?.n).toBe(2);

    const page = await (await app.request("/topics?channel=drivingzone-blog&status=")).text();
    expect(page).toContain("직접 추가");
    expect(page).toContain("글 방향: 학원 가기 전 연습");
    expect(page).toContain('action="/topics/1/copy"');
  });

  it("다른 채널로 예약하면 대상 채널에 주제를 만들고, 막힌 복사는 오류로 돌려보낸다", async () => {
    const c = ctx();
    const app = createApp(c);
    const id = insertTopic(c.db, {
      keyword: "강남운전학원",
      channel: "drivingplus-community",
      section: "drive_story",
      region: "서울특별시 강남구",
    });
    const blocked = await app.request(
      `/topics/${id}/copy`,
      form([["target", "drivingzone-blog/blog"]]),
    );
    expect(
      new URL(blocked.headers.get("location") ?? "", "http://local").searchParams.get("error"),
    ).toContain("지역 글을 쓰지 않습니다");

    const ok = await app.request(
      `/topics/${id}/copy`,
      form([["target", "drivingplus-community/license_tips"]]),
    );
    expect(ok.headers.get("location")).toContain("done=copied");
    expect(
      c.db.get<{ status: string; origin: string }>(
        "SELECT status, origin FROM topics WHERE section_code = 'license_tips'",
      ),
    ).toEqual({ status: "queued", origin: "copied" });
  });
});
