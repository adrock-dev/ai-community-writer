import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bigrams, clusterKeywords, jaccard, secondaryKeywords } from "../src/keywords/cluster.ts";
import { fetchTrends, loadDatalabCredentials, trendRatio } from "../src/keywords/datalab.ts";
import { buildRegionIndex, detectRegion, regionKey, regionLabel } from "../src/keywords/regions.ts";
import {
  parseEnvFile,
  SearchadClient,
  signature,
  toCount,
  toKeywordStat,
} from "../src/keywords/searchad.ts";
import {
  loadKeywordFilter,
  loadSeeds,
  parseSeedFile,
  passesFilter,
} from "../src/keywords/seeds.ts";
import { inferArticleType } from "../src/topics/intent.ts";

describe("searchad", () => {
  it("인증 파일을 읽는다 (export·따옴표·주석·CRLF·BOM)", () => {
    expect(
      parseEnvFile('\uFEFF# 주석\r\nexport NAVER_AD_API_KEY="k1"\r\nNAVER_AD_CUSTOMER_ID=123\r\n'),
    ).toEqual({ NAVER_AD_API_KEY: "k1", NAVER_AD_CUSTOMER_ID: "123" });
  });

  it("서명은 timestamp.method.uri의 HMAC-SHA256 base64", () => {
    expect(signature("secret", "1700000000000", "GET", "/keywordstool")).toBe(
      "A6Gzu+sW9C2ovLsH+T+rFrie81KwHy1xrodUFQERKf4=",
    );
  });

  it("'< 10'은 5로, 합계를 계산한다", () => {
    expect(toCount("< 10")).toBe(5);
    expect(
      toKeywordStat({
        relKeyword: "운전연수",
        monthlyPcQcCnt: 1200,
        monthlyMobileQcCnt: "< 10",
        compIdx: "높음",
      }),
    ).toEqual({ keyword: "운전연수", pc: 1200, mobile: 5, total: 1205, competition: "높음" });
  });

  it("힌트 공백을 빼고 보내며 429는 재시도한다", async () => {
    const urls: string[] = [];
    let calls = 0;
    const fakeFetch = (async (url: string) => {
      urls.push(url);
      calls++;
      if (calls === 1) return new Response("slow down", { status: 429 });
      return Response.json({
        keywordList: [{ relKeyword: "장롱면허", monthlyPcQcCnt: 10, monthlyMobileQcCnt: 20 }],
      });
    }) as unknown as typeof fetch;
    const client = new SearchadClient(
      { apiKey: "a", secretKey: "s", customerId: "c" },
      { fetch: fakeFetch, delayMs: 0 },
    );
    const origTimeout = globalThis.setTimeout;
    // 재시도 대기(2초)를 건너뛴다
    globalThis.setTimeout = ((fn: () => void) => origTimeout(fn, 0)) as typeof setTimeout;
    try {
      const stats = await client.relatedKeywords(["장롱 면허", "운전 연수"]);
      expect(stats[0]?.total).toBe(30);
    } finally {
      globalThis.setTimeout = origTimeout;
    }
    expect(calls).toBe(2);
    expect(decodeURIComponent(urls[0]!)).toContain("hintKeywords=장롱면허,운전연수");
  });

  it("4xx(429 제외)는 재시도하지 않는다", async () => {
    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      return new Response("bad", { status: 400 });
    }) as unknown as typeof fetch;
    const client = new SearchadClient(
      { apiKey: "a", secretKey: "s", customerId: "c" },
      { fetch: fakeFetch },
    );
    await expect(client.relatedKeywords(["x"])).rejects.toThrow(/400/);
    expect(calls).toBe(1);
  });
});

describe("seeds", () => {
  it("섹션별 시드·포함어·제외어를 읽는다 (소제목 없으면 시드)", () => {
    const parsed = parseSeedFile(
      "# 제목\n## a\n- 시드1\n### 포함어\n- 학원\n### 제외어\n- 연수\n## b\n- 시드2\n",
    );
    expect(parsed.get("a")).toEqual({ seeds: ["시드1"], include: ["학원"], exclude: ["연수"] });
    expect(parsed.get("b")).toEqual({ seeds: ["시드2"], include: [], exclude: [] });
    expect(() => parseSeedFile("## a\n### 기타\n")).toThrow(/시드\/포함어\/제외어/);
  });

  it("채널에 없는 섹션은 오류", () => {
    const dir = mkdtempSync(join(tmpdir(), "seeds-"));
    writeFileSync(join(dir, "dztraining-blog.md"), "## blog\n- 운전연수\n");
    expect(() => loadSeeds(dir)).toThrow(/채널에 없는 섹션 blog/);
  });

  it("저장소 시드 파일이 모든 채널에 대해 읽힌다", () => {
    const seeds = loadSeeds();
    expect(new Set(seeds.map((s) => s.channelId)).size).toBe(4);
    const filter = loadKeywordFilter();
    expect(filter.include).toContain("운전");
    expect(filter.exclude).toContain("대리운전");
  });

  it("제외어가 우선하고, 포함어가 있으면 하나는 있어야 한다", () => {
    const f = { include: ["운전", "면허"], exclude: ["대리운전"] };
    expect(passesFilter("운전 연수", f)).toBe(true);
    expect(passesFilter("대리 운전 요금", f)).toBe(false);
    expect(passesFilter("자동차보험", f)).toBe(false);
    expect(passesFilter("아무거나", { include: [], exclude: [] })).toBe(true);
  });
});

describe("regions", () => {
  const index = buildRegionIndex([
    "서울특별시 강남구",
    "인천광역시 연수구",
    "광주광역시 광산구",
    "경기도 광주시",
    "경기도 고양시 일산동구",
    "전북특별자치도 전주시 덕진구",
    "전북특별자치도 전주시 완산구",
    "제주특별자치도 서귀포시",
  ]);

  it("시군구 별칭을 찾고, 시군구가 시도보다 우선한다", () => {
    expect(detectRegion("강남운전면허학원", index)?.regions).toEqual(["서울특별시 강남구"]);
    expect(detectRegion("서울 강남 운전학원", index)?.alias).toBe("강남");
    expect(detectRegion("서울운전연수", index)?.regions).toEqual(["서울특별시"]);
    expect(detectRegion("서귀포운전학원", index)?.alias).toBe("서귀포");
    expect(detectRegion("일산운전연수", index)?.regions).toEqual(["경기도 고양시 일산동구"]);
  });

  it("'연수'는 지역(인천 연수구)으로 보지 않는다", () => {
    expect(detectRegion("운전연수", index)).toBeUndefined();
  });

  it("같은 곳의 다른 별칭은 같은 키, 여러 곳이면 공통 상위 지역으로 표시한다", () => {
    expect(regionKey(detectRegion("강남구운전학원", index))).toBe(
      regionKey(detectRegion("강남운전학원", index)),
    );
    expect(regionLabel(regionKey(detectRegion("전주운전면허학원", index)))).toBe(
      "전북특별자치도 전주시",
    );
    expect(regionLabel(regionKey(detectRegion("광주운전면허시험장", index)))).toBe(
      "광주광역시 / 경기도 광주시",
    );
  });
});

describe("clusterKeywords", () => {
  const k = (keyword: string, total: number, region = "", regionAlias = "") => ({
    keyword,
    total,
    pc: 0,
    mobile: total,
    competition: "",
    region,
    regionAlias,
    intent: inferArticleType(keyword),
  });

  it("띄어쓰기만 다른 키워드는 검색 수를 합치고, 보조 키워드에는 한 번만 둔다", () => {
    const clusters = clusterKeywords([
      k("운전면허 비용", 100),
      k("운전면허비용", 300),
      k("운전면허 따는 비용", 50),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.head.keyword).toBe("운전면허비용");
    expect(clusters[0]?.volume).toBe(450);
    expect(secondaryKeywords(clusters[0]!)).toEqual(["운전면허 따는 비용"]);
  });

  it("지역이 다르면 묶지 않고, 지역명을 뺀 나머지로 비교한다", () => {
    const clusters = clusterKeywords([
      k("운전면허학원", 1000),
      k("강남운전면허학원", 200, "서울특별시 강남구", "강남"),
      k("강남구운전면허학원", 50, "서울특별시 강남구", "강남구"),
    ]);
    expect(clusters.map((c) => [c.head.keyword, c.members.length])).toEqual([
      ["운전면허학원", 1],
      ["강남운전면허학원", 2],
    ]);
  });

  it("의도가 다른 키워드는 나눈다", () => {
    expect(clusterKeywords([k("운전면허학원", 100), k("운전연수", 90)])).toHaveLength(2);
    // 글자는 비슷해도 유형(연수 / 비용)이 다르면 따로
    expect(clusterKeywords([k("운전연수", 100), k("운전연수비용", 50)])).toHaveLength(2);
    expect(jaccard(bigrams("운전면허학원"), bigrams("운전학원"))).toBeLessThan(0.5);
  });
});

describe("inferArticleType", () => {
  it.each([
    ["운전면허합격후기", "review"],
    ["운전면허학원비용", "cost"],
    ["운전학원추천", "recommend"],
    ["부산남부면허시험장", "test_center"],
    ["운전면허적성검사", "license_admin"],
    ["면허취소재취득", "license_admin"],
    ["강남운전면허학원", "academy"],
    ["운전면허따는법", "howto"],
    ["기능시험코스", "tips"],
    ["도로주행연수", "training"],
    ["운전면허필기시험", "exam"],
    ["1종보통면허", "license_type"],
    ["운전면허", "guide"],
  ])("%s → %s", (keyword, type) => {
    expect(inferArticleType(keyword)).toBe(type);
  });
});

describe("datalab", () => {
  it("키는 설정값 → 인증 파일 순으로 찾고, 둘 중 하나라도 없으면 쓰지 않는다", () => {
    const naver = { datalabClientId: "", datalabClientSecret: "", searchadEnvFile: "x" };
    const file = { NAVER_DATALAB_CLIENT_ID: "fid", NAVER_DATALAB_CLIENT_SECRET: "fsecret" };
    expect(loadDatalabCredentials(naver, () => file)).toEqual({
      clientId: "fid",
      clientSecret: "fsecret",
    });
    expect(loadDatalabCredentials({ ...naver, datalabClientId: "cid" }, () => file)?.clientId).toBe(
      "cid",
    );
    expect(
      loadDatalabCredentials(naver, () => ({ NAVER_DATALAB_CLIENT_ID: "only-id" })),
    ).toBeUndefined();
  });

  it("최근 4주 평균 / 이전 8주 평균", () => {
    expect(trendRatio([...Array(8).fill(50), ...Array(4).fill(75)])).toBe(1.5);
    expect(trendRatio([1, 2, 3])).toBeUndefined();
  });

  it("5그룹씩 나눠 요청한다", async () => {
    const bodies: any[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      return Response.json({
        results: body.keywordGroups.map((g: any) => ({
          title: g.groupName,
          data: Array.from({ length: 12 }, (_, i) => ({ ratio: i < 8 ? 10 : 20 })),
        })),
      });
    }) as unknown as typeof fetch;
    const groups = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`k${i}`, [`k${i}`]]));
    const trends = await fetchTrends({ clientId: "a", clientSecret: "b" }, groups, {
      fetch: fakeFetch,
    });
    expect(bodies.map((b) => b.keywordGroups.length)).toEqual([5, 2]);
    expect(trends.k6).toBe(2);
  });
});
