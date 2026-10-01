import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AppContext } from "../src/app.ts";
import { getArticle } from "../src/articles/store.ts";
import { findChannel, findSection } from "../src/channels.ts";
import { parseConfig } from "../src/config.ts";
import { Database } from "../src/db/database.ts";
import { type ImageStyle, imagePrompt, pickImageStyle } from "../src/images/generator.ts";
import { saveImageStyles } from "../src/images/style.ts";
import { LlmUnavailableError } from "../src/llm/client.ts";
import { bodyChars, extractAmounts, qualityIssues } from "../src/quality/gate.ts";
import { JobQueue } from "../src/queue/queue.ts";
import { createApp } from "../src/server.ts";
import {
  avoidList,
  findSimilar,
  fingerprint,
  introOf,
  minhash,
  saveFingerprint,
  signatureSimilarity,
} from "../src/similarity/fingerprint.ts";
import type { Academy } from "../src/sources/drivingplus.ts";
import type { Store } from "../src/sources/drivingzone.ts";
import { getTopic, type Topic } from "../src/topics/store.ts";
import {
  academyFacts,
  drivingzoneFacts,
  inRegion,
  isMeaningfulReview,
} from "../src/writer/facts.ts";
import { generateArticle } from "../src/writer/generate.ts";
import { parseDraft } from "../src/writer/output.ts";
import { composePrompt, promptFiles } from "../src/writer/prompt.ts";

const plus = findChannel("drivingplus-community")!;
const cafe = findChannel("drivingzone-cafe")!;

/** 채널 품질 기준을 통과하는 본문을 만든다. */
function goodBody(
  keyword: string,
  opts: { h2?: number; faq?: boolean; table?: boolean; paras?: number; images?: boolean } = {},
) {
  const { h2 = 4, faq = true, table = true, paras = 4, images = true } = opts;
  const para = (i: number, j: number) =>
    `상담을 받기 전에 일정과 비용 조건을 먼저 정리해 두면 비교가 쉬워요. 곳마다 교육 시간과 포함 항목이 달라서 등록 전에 꼭 물어보세요. 처음이라면 집이나 직장에서 가까운 곳부터 차례로 알아보는 편이 부담이 적어요. (${i}-${j})`;
  // 이미지는 서로 다른 섹션(1번째, 3번째)에 한 장씩
  const imageFor = (i: number) =>
    images && (i === 0 || i === 2) ? [`![${keyword} 사진](img${i === 0 ? 1 : 2})`] : [];
  const sections = Array.from({ length: h2 }, (_, i) =>
    [
      `## ${keyword} 궁금증 ${i + 1}`,
      para(i, 0),
      ...imageFor(i),
      ...Array.from({ length: paras - 1 }, (_, j) => para(i, j + 1)),
    ].join("\n\n"),
  );
  return [
    `# ${keyword} 고르는 법과 확인할 점 총정리`,
    `${keyword}은 거리·비용·교육 시간을 함께 비교해 고르는 것이 가장 확실해요. 이 글에서 기준을 정리했어요.`,
    ...sections,
    table ? "| 기준 | 확인할 점 |\n| --- | --- |\n| 거리 | 셔틀 여부 |" : "",
    faq
      ? "## 자주 묻는 질문\n\n### Q. 언제 시작하나요?\n답변입니다.\n\n### Q. 얼마나 걸리나요?\n답변입니다.\n\n### Q. 무엇을 챙기나요?\n답변입니다."
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

const draftOf = (body: string, title = "운전학원 고르는 법과 확인할 점 총정리 가이드") => ({
  title,
  summary:
    "운전학원을 고를 때 거리, 비용, 교육 시간, 셔틀까지 한 번에 비교하는 기준과 등록 전에 꼭 확인할 점을 정리했어요. 처음 알아보는 분께 추천해요.",
  keywords: ["운전학원"],
  body,
});

const gate = (overrides: object = {}) => ({
  channel: plus,
  primaryKeyword: "운전학원",
  articleType: "academy",
  corpus: "공시 수강료 2종 보통(자동) 71만 2천원 (부가세 별도)",
  candidates: [],
  imageIds: ["img1", "img2"],
  ...overrides,
});

describe("parseDraft", () => {
  it("구분자 형식을 읽고, 코드 블록 감싸기와 H1 누락을 보정한다", () => {
    const out =
      "```\n<<<TITLE>>>\n제목입니다\n<<<SUMMARY>>>\n설명\n<<<KEYWORDS>>>\n가, 나\n<<<BODY>>>\n본문 첫 줄\n<<<END>>>\n```";
    expect(parseDraft(out)).toEqual({
      title: "제목입니다",
      summary: "설명",
      keywords: ["가", "나"],
      body: "# 제목입니다\n\n본문 첫 줄",
    });
    expect(parseDraft("구분자 없는 출력")).toBeUndefined();
  });
});

describe("extractAmounts", () => {
  it("여러 한국어 금액 표기를 원 단위로 읽는다", () => {
    const got = extractAmounts(
      "627,000원, 62만 7천 원, 62만 7,500원, 25만원, 약 30만 원대, 25만~45만 원, 3천원, 7,500원, 2026년",
    ).map((a) => [a.value, a.approx]);
    expect(got).toEqual([
      [627000, false],
      [627000, false],
      [627500, false],
      [250000, false],
      [300000, true],
      [250000, true],
      [450000, false],
      [3000, false],
      [7500, false],
    ]);
  });
});

describe("qualityIssues", () => {
  it("기준을 채운 글은 통과한다", () => {
    expect(qualityIssues(draftOf(goodBody("운전학원")), gate())).toEqual([]);
  });

  it("원시 HTML 서식 태그를 잡고, 색 강조 표시는 글자 수에 세지 않는다", () => {
    const withTag = `${goodBody("운전학원")}\n\n<span style="color:red">중요</span>`;
    expect(qualityIssues(draftOf(withTag), gate()).join("\n")).toMatch(
      /HTML 태그\(<span style="color:red">\)를 빼세요/,
    );
    const body = goodBody("운전학원");
    const marked = body.replace("가장 확실해요", "==가장 확실해요==");
    expect(bodyChars(marked)).toBe(bodyChars(body));
    expect(qualityIssues(draftOf(marked), gate())).toEqual([]);
  });

  it("링크는 허용된 자사 주소만, 2개까지 통과한다", () => {
    const pricing = "https://www.drivingzone.co.kr/pricing";
    const branch = "https://www.drivingzone.co.kr/branch";
    const faq = "https://www.drivingzone.co.kr/support/faq";
    const withLink = (...urls: string[]) =>
      `${goodBody("운전학원")}\n\n${urls.map((u, i) => `[자세히 보기 ${i}](${u})`).join(" ")}`;
    // 허용 목록이 없으면(링크를 주지 않은 글) 자사 주소도 뺀다
    expect(qualityIssues(draftOf(withLink(pricing)), gate()).join("\n")).toMatch(
      /링크 주소를 빼세요/,
    );
    const allowed = gate({ allowedLinks: [pricing, branch, faq] });
    expect(qualityIssues(draftOf(withLink(pricing, branch)), allowed)).toEqual([]);
    expect(
      qualityIssues(
        draftOf(withLink(pricing, "https://www.drivingzone.co.kr/event")),
        allowed,
      ).join("\n"),
    ).toMatch(/링크 주소를 빼세요: https:\/\/www\.drivingzone\.co\.kr\/event/);
    expect(qualityIssues(draftOf(withLink(pricing, branch, faq)), allowed).join("\n")).toMatch(
      /2개까지만/,
    );
  });

  it("매장 사진은 드라이빙존을 다루는 섹션에 1장까지만 둔다", () => {
    const restricted = {
      imageIds: ["img1", "img2", "img3"],
      restrictedImages: [
        { id: "img2", mustMention: ["드라이빙존", "강남역점"] },
        { id: "img3", mustMention: ["드라이빙존", "강남역점"] },
      ],
    };
    // img2 가 들어간 3번째 섹션은 드라이빙존 이야기가 없다
    const misplaced = qualityIssues(draftOf(goodBody("운전학원")), gate(restricted)).join("\n");
    expect(misplaced).toMatch(/매장 사진\(img2\)이 드라이빙존을 다루지 않는 섹션/);

    const placed = goodBody("운전학원").replace(
      "## 운전학원 궁금증 3",
      "## 학원 가기 전, 드라이빙존에서 미리 연습하기",
    );
    expect(qualityIssues(draftOf(placed), gate(restricted))).toEqual([]);

    const twice = placed.replace(
      "![운전학원 사진](img1)",
      "![드라이빙존 강남역점 매장 사진](img3)",
    );
    expect(qualityIssues(draftOf(twice), gate(restricted)).join("\n")).toMatch(
      /매장 사진\(img3, img2\)은 1장만/,
    );
  });

  it("근거 없는 금액·비율, 합격 보장, 내부 용어, 자리표시를 잡는다", () => {
    const body = `${goodBody("운전학원")}\n\n수강료는 65만원(부가세 별도)이고 합격률 95%로 무조건 합격합니다. 제공된 자료 기준입니다. [이미지]`;
    const issues = qualityIssues(draftOf(body), gate()).join("\n");
    expect(issues).toMatch(/근거 자료에 없는 금액.*65만원/);
    expect(issues).toMatch(/근거 자료에 없는 비율.*95%/);
    expect(issues).toMatch(/무조건 합격/);
    expect(issues).toMatch(/내부 용어 "제공된 자료"/);
    expect(issues).toMatch(/자리표시/);
  });

  it("근거 금액은 그대로 또는 '약'을 붙인 10% 이내 어림은 허용한다", () => {
    const body = `${goodBody("운전학원")}\n\n2종 보통은 71만 2천원, 약 70만원대입니다(부가세 별도).`;
    expect(qualityIssues(draftOf(body), gate())).toEqual([]);
  });

  it("금액은 만 단위로 쓰고, 금액이 나온 문단·표에 부가세 표기가 있어야 한다", () => {
    const body = `${goodBody("운전학원")}\n\n2종 보통은 712,000원입니다.\n\n| 과정 | 금액 |\n| --- | --- |\n| 2종 | 71만 2천원 |`;
    const issues = qualityIssues(draftOf(body), gate()).join("\n");
    expect(issues).toMatch(/만 단위로 쓰세요: 712,000원/);
    expect(issues).toMatch(/부가세 포함·별도를 함께 적으세요/);
    // 표 바로 아래 설명에 부가세가 있으면 통과
    const ok = `${goodBody("운전학원")}\n\n| 과정 | 금액 |\n| --- | --- |\n| 2종 | 71만 2천원 |\n\n위 금액은 부가세 별도입니다.`;
    expect(qualityIssues(draftOf(ok), gate())).toEqual([]);
  });

  it("도로교통공단 수수료·과태료만 쓴 문단·표는 부가세 표기를 요구하지 않는다", () => {
    const publicFees =
      "학과시험 수수료는 1만원이다. 도로주행시험 수수료는 3만원이다. 제1종 적성검사 과태료 3만원";
    const ctx = gate({ corpus: `공시 수강료 71만 2천원 (부가세 별도)\n${publicFees}`, publicFees });
    const fees = `${goodBody("운전학원")}\n\n학과시험 수수료는 1만원입니다.\n\n| 시험 | 수수료 |\n| --- | --- |\n| 도로주행 | 3만원 |`;
    expect(qualityIssues(draftOf(fees), ctx)).toEqual([]);
    // 업체 요금이 섞이거나, 공공 요금과 같은 금액이라도 수수료·과태료 문맥이 아니면 그대로 잡는다
    const mixed = `${goodBody("운전학원")}\n\n학원 수강료 71만 2천원에 학과시험 수수료 1만원이 더 듭니다.`;
    expect(qualityIssues(draftOf(mixed), ctx).join("\n")).toMatch(/부가세 포함·별도/);
    const price = `${goodBody("운전학원")}\n\n체험권은 3만원입니다.`;
    expect(qualityIssues(draftOf(price), ctx).join("\n")).toMatch(/부가세 포함·별도/);
    // 공단 안내가 없으면 예외도 없다
    expect(qualityIssues(draftOf(fees), gate({ corpus: ctx.corpus })).join("\n")).toMatch(
      /부가세 포함·별도/,
    );
  });

  it("본문 링크 주소는 빼게 하고 사이트 이름만 허용한다 (이미지 주소는 제외)", () => {
    const withLink = `${goodBody("운전학원")}\n\n자세한 내용은 [학과시험 안내](https://www.safedriving.or.kr/dtGuide/x.do)와 https://example.com/a 를 보세요.`;
    const issues = qualityIssues(draftOf(withLink), gate()).join("\n");
    expect(issues).toMatch(
      /링크 주소를 빼세요: https:\/\/www\.safedriving\.or\.kr\/dtGuide\/x\.do, https:\/\/example\.com\/a/,
    );
    const plain = `${goodBody("운전학원")}\n\n안전운전 통합민원(safedriving.or.kr)에서 확인하세요.`;
    expect(qualityIssues(draftOf(plain), gate())).toEqual([]);
  });

  it("생성 이미지 대체 텍스트에 '생성·삽화'를 쓰지 않는다", () => {
    const body = goodBody("운전학원").replace(
      "![운전학원 사진](img1)",
      "![기능시험 코스 생성 삽화](img1)",
    );
    expect(qualityIssues(draftOf(body), gate()).join("\n")).toMatch(/대체 텍스트에 "생성·삽화·AI"/);
  });

  it("이미지: 2장 이상, 제공된 번호만, 대체 텍스트, 연달아 두지 않기", () => {
    const none = qualityIssues(draftOf(goodBody("운전학원", { images: false })), gate()).join("\n");
    expect(none).toMatch(/이미지를 2장 이상/);
    const bad = `${goodBody("운전학원", { images: false })}\n\n![](img1)\n\n![사진](img9)`;
    const issues = qualityIssues(draftOf(bad), gate()).join("\n");
    expect(issues).toMatch(/없는 이미지 번호입니다: img9/);
    expect(issues).toMatch(/대체 텍스트/);
    expect(issues).toMatch(/연달아/);
  });

  it("구조 문제: 짧음·FAQ·표·첫 문단 키워드·제목 키워드", () => {
    const issues = qualityIssues(
      draftOf("# 제목\n\n짧은 글입니다.", "완전히 다른 제목입니다 여러분"),
      gate(),
    );
    expect(issues.join("\n")).toMatch(/짧습니다/);
    expect(issues.join("\n")).toMatch(/자주 묻는 질문/);
    expect(issues.join("\n")).toMatch(/표를/);
    expect(issues.join("\n")).toMatch(/첫 문단에 대표 키워드/);
    expect(issues.join("\n")).toMatch(/제목에 대표 키워드/);
  });

  it("카페 원고에는 ## 소제목·표를 쓰지 않는다", () => {
    const issues = qualityIssues(
      draftOf(goodBody("운전학원", { h2: 2, paras: 2 })),
      gate({ channel: cafe }),
    );
    expect(issues.join("\n")).toMatch(/카페 원고에는 ## 소제목과 표/);
  });

  it("추천 글에서 실제 후보보다 많은 곳을 주장하면 잡는다", () => {
    const body = `${goodBody("운전학원")}\n\n지역 운전학원 TOP 10을 소개합니다.`;
    const issues = qualityIssues(
      draftOf(body),
      gate({ articleType: "recommend", candidates: ["가", "나", "다"] }),
    );
    expect(issues.join("\n")).toMatch(/실제 후보는 3곳/);
  });
});

describe("유사도", () => {
  it("MinHash: 같은 글은 1, 다른 글은 낮다", () => {
    const a = minhash(
      "운전연수는 장롱면허 운전자가 도로 감각을 되찾는 가장 확실한 방법입니다".repeat(5),
    );
    const b = minhash(
      "필기시험은 문제은행에서 출제되며 학과 교육을 먼저 이수해야 응시할 수 있습니다".repeat(5),
    );
    expect(signatureSimilarity(a, a)).toBe(1);
    expect(signatureSimilarity(a, b)).toBeLessThan(0.2);
  });

  function seed(db: Database, channelId: string, title: string, body: string, type = "academy") {
    const now = new Date().toISOString();
    const id = db.run(
      `INSERT INTO articles (channel_id, section_code, article_type, title, body, format, created_at, updated_at)
       VALUES (?, 's', ?, ?, ?, 'markdown', ?, ?)`,
      [channelId, type, title, body, now, now],
    ).lastInsertRowid;
    saveFingerprint(db, id, fingerprint(body));
    return id;
  }

  it("같은 브랜드는 엄격하게, 다른 브랜드는 거의 같은 글만 막는다", () => {
    const db = new Database(":memory:");
    const body = goodBody("운전학원");
    seed(db, "drivingzone-blog", "운전학원 고르는 법", body);
    const draft = {
      title: "운전학원 고르는 법",
      channelId: "drivingzone-cafe",
      articleType: "academy",
      fp: fingerprint(body),
    };
    expect(findSimilar(db, draft)[0]).toMatchObject({
      sameBrand: true,
      exceeded: ["본문", "제목", "소제목 구성"],
    });

    const other = findSimilar(db, { ...draft, channelId: "drivingplus-community" })[0]!;
    expect(other.sameBrand).toBe(false);
    expect(other.exceeded).toEqual(["본문", "제목"]); // 다른 브랜드는 소제목 구성은 보지 않는다
  });

  it("피할 패턴: 같은 유형의 같은 브랜드 글을 먼저, 다른 브랜드 글도 일부", () => {
    const db = new Database(":memory:");
    seed(db, "drivingzone-blog", "존 글", "# 존 글\n\n도입부 문장\n\n## 소제목 A");
    seed(db, "drivingplus-community", "플러스 글", "# 플러스 글\n\n도입\n\n## B");
    seed(db, "drivingzone-blog", "다른 유형", "# 다른 유형", "cost");
    const avoid = avoidList(db, "dztraining-blog", "academy");
    expect(avoid.map((a) => a.title)).toEqual(["존 글", "플러스 글"]);
    expect(avoid[0]).toMatchObject({ outline: ["소제목 A"], intro: "도입부 문장" });
    expect(introOf("# 제목\n\n## 소제목\n\n- 목록\n\n첫 문단")).toBe("첫 문단");
  });
});

describe("프롬프트", () => {
  it("채널 전용 글 유형 파일이 있으면 그것을, 없으면 공통 유형을 쓴다", () => {
    expect(promptFiles("dztraining-blog", "training").map((f) => f.path)).toEqual([
      "base.md",
      "channels/dztraining-blog.md",
      "channels/dztraining-blog/training.md",
    ]);
    expect(promptFiles("drivingplus-community", "training")[2]?.path).toBe(
      "channels/drivingplus-community/training.md",
    );
    expect(promptFiles("drivingzone-blog", "cost")[2]?.path).toBe("types/cost.md");
    expect(promptFiles("drivingzone-blog", "unknown_type")[2]?.path).toBe("types/guide.md");
  });

  it("주제·유의사항·근거 자료·피할 글·출력 형식을 모두 넣는다", () => {
    const dir = mkdtempSync(join(tmpdir(), "prompts-"));
    mkdirSync(join(dir, "channels"));
    mkdirSync(join(dir, "types"));
    writeFileSync(join(dir, "base.md"), "공통");
    writeFileSync(join(dir, "channels", "dztraining-blog.md"), "채널");
    writeFileSync(join(dir, "types", "guide.md"), "유형");
    const topic = {
      primaryKeyword: "장롱면허",
      secondaryKeywords: ["장롱면허연수"],
      region: "",
      volume: 1234,
      articleType: "training",
      brief: "학원 가기 전\n기본 조작은 드라이빙존에서",
    } as Topic;
    const { prompt } = composePrompt(
      {
        topic,
        channel: findChannel("dztraining-blog")!,
        section: findSection("dztraining-blog", "blog_training")!,
        guides: [{ group: "교육 운영", text: "1일 1회 최대 1시간 30분" }],
        facts: { text: "요금 25만원", candidates: [], images: [], asOf: "", warnings: [] },
        images: [
          { id: "img1", url: "https://x/1.jpg", kind: "photo", subject: "가 학원 사진" },
          { id: "img2", url: "/images/a.png", kind: "generated", subject: "주차 연습 장면" },
        ],
        avoid: [{ title: "예전 글", outline: ["A"], intro: "도입" }],
        links: [{ label: "요금 안내", url: "https://www.dztraining.co.kr/pricing" }],
        today: new Date("2026-09-28T00:00:00Z"),
      },
      dir,
    );
    expect(prompt).toContain("## 본문에 넣을 수 있는 링크");
    expect(prompt).toContain("- 요금 안내: https://www.dztraining.co.kr/pricing");
    for (const part of [
      "공통",
      "채널",
      "유형",
      "장롱면허 (최근 30일 네이버 검색 약 1,234회)",
      "- 글 방향(운영자 지정): 학원 가기 전 기본 조작은 드라이빙존에서",
      "[교육 운영]",
      "1시간 30분",
      "요금 25만원",
      "예전 글",
      "img1: 가 학원 사진 (실제 사진",
      "img2: 삽화 — 주차 연습 장면 (생성 이미지",
      "<<<BODY>>>",
    ]) {
      expect(prompt).toContain(part);
    }
  });
});

describe("근거 자료", () => {
  const academy = (over: Partial<Academy>): Academy => ({
    id: 1,
    name: "가나운전학원",
    type: "exam_academy",
    address: "서울특별시 강남구 테헤란로 1",
    lat: null,
    lng: null,
    phone: "",
    naverPlaceUrl: "",
    licenseTypes: ["2종 보통 자동"],
    prices: [],
    officialFees: {
      period: "2026년 2분기",
      type1Manual: null,
      type1Auto: null,
      type2Auto: 700000,
      vatIncluded: false,
      examFeeIncluded: true,
    },
    capacity: null,
    graduates: null,
    hours: [],
    hoursNotice: "",
    shuttles: [],
    shuttleSummary: "",
    roadCourses: [],
    reviews: [{ point: 5, content: "친절해요", date: "2026-01-01" }],
    photos: [],
    ...over,
  });
  const topic = (over: Partial<Topic>) =>
    ({ region: "", articleType: "academy", ...over }) as Topic;

  it("지역 학원만 후보로 넣고, 없으면 쓰지 말라고 알린다", () => {
    const list = [
      academy({}),
      academy({ id: 2, name: "다라운전학원", address: "부산광역시 사상구 1" }),
    ];
    const local = academyFacts(list, topic({ region: "서울특별시 강남구" }));
    expect(local.candidates).toEqual(["가나운전학원"]);
    expect(local.text).toContain(
      "공시 수강료(2026년 2분기, 검정료 포함, 부가세 별도): 2종 보통(자동) 70만원",
    );
    expect(academyFacts(list, topic({ region: "대구광역시" })).text).toMatch(
      /확인된 학원 자료가 없습니다/,
    );
  });

  it("시험·시험장 글에는 학원 자료를 넣지 않는다", () => {
    expect(academyFacts([academy({})], topic({ articleType: "exam" })).text).toBe("");
  });

  it("의미 없는 후기(짧거나 자음·모음 나열)는 근거에서 뺀다", () => {
    expect(isMeaningfulReview("ㅈㅂㅈㅂㅈㅂㅈㄴㅈㄴ")).toBe(false);
    expect(isMeaningfulReview("좋아요")).toBe(false);
    expect(isMeaningfulReview("강사님이 친절하게 알려주셔서 한 번에 합격했어요 ㅎㅎ")).toBe(true);
  });

  it("옛 시도명 주소도 현재 지역으로 맞춘다", () => {
    expect(inRegion("전라북도 전주시 덕진구 백제대로 563", "전북특별자치도 전주시 덕진구")).toBe(
      true,
    );
  });

  it("드라이빙존: 지역 주제가 와도 지역으로 좁히지 않고 전체 지점을 준다", () => {
    const store = {
      name: "강남역점",
      type: "direct",
      address: "서울특별시 강남구 1",
      reviews: [],
      hours: [],
      subways: [],
      keywordTags: [],
      machines: {},
      instructors: [],
      locationHint: "",
      photos: ["https://file.example/store.jpg"],
    } as unknown as Store;
    const facts = drivingzoneFacts(
      [store],
      {},
      topic({ region: "대구광역시", articleType: "training" }),
      cafe,
    );
    expect(facts.text).not.toMatch(/이 지역/);
    expect(facts.text).toMatch(/전체 지점 목록:/);
    expect(facts.candidates).toEqual(["강남역점"]);
  });

  it("드라이빙존 매장 사진은 비용·추천 글이 아니면 안내 섹션 전용으로 표시한다", () => {
    const store = {
      id: 1,
      name: "강남역점",
      type: "direct",
      address: "서울특별시 강남구 1",
      reviews: [],
      hours: [],
      subways: [],
      keywordTags: [],
      machines: {},
      instructors: [],
      locationHint: "",
      photos: ["https://file.example/a.jpg", "https://file.example/b.jpg"],
    } as unknown as Store;
    const exam = drivingzoneFacts([store], {}, topic({ articleType: "exam" }), cafe).images;
    expect(exam).toHaveLength(1);
    expect(exam[0]?.sectionMustMention).toEqual(["드라이빙존", "강남역점"]);
    const cost = drivingzoneFacts([store], {}, topic({ articleType: "cost" }), cafe).images;
    expect(cost).toHaveLength(2);
    expect(cost.every((i) => !i.sectionMustMention)).toBe(true);
  });
});

describe("generateArticle", () => {
  function setup() {
    const db = new Database(":memory:");
    const now = new Date().toISOString();
    const topicId = db.run(
      `INSERT INTO topics (primary_keyword, secondary_keywords, channel_id, section_code, article_type, created_at, updated_at, topic_key)
       VALUES ('운전학원', '[]', 'drivingplus-community', 'drive_story', 'academy', ?, ?, '운전학원')`,
      [now, now],
    ).lastInsertRowid;
    return { db, topicId, config: parseConfig({}) };
  }
  const output = (body: string) =>
    `<<<TITLE>>>\n운전학원 고르는 법과 확인할 점 총정리 가이드\n<<<SUMMARY>>>\n${draftOf(body).summary}\n<<<KEYWORDS>>>\n운전학원\n<<<BODY>>>\n${body}\n<<<END>>>`;
  const photo = (n: number) => ({
    id: `img${n}`,
    url: `https://file.example/${n}.jpg`,
    kind: "photo" as const,
    subject: `학원 ${n} 사진`,
  });
  const facts = {
    text: "공시 수강료 71만 2천원 (부가세 별도)",
    candidates: [],
    images: [photo(1), photo(2)],
    asOf: "2026-09-28",
    warnings: [],
  };

  it("문제가 있으면 고칠 점을 알려 다시 쓰게 하고, 통과하면 검수 대기로 저장한다", async () => {
    const { db, topicId, config } = setup();
    const prompts: string[] = [];
    const replies = [output(goodBody("운전학원", { faq: false })), output(goodBody("운전학원"))];
    const llm = {
      generate: async (prompt: string) => {
        prompts.push(prompt);
        return { text: replies.shift()!, provider: "codex" as const, model: "m", durationMs: 1 };
      },
    };
    const result = await generateArticle({ db, config, llm, facts, factCheck: false }, topicId);
    expect(result).toMatchObject({ status: "review", attempts: 2, issues: [] });
    expect(prompts[1]).toMatch(/고쳐야 할 점[\s\S]*자주 묻는 질문/);
    const article = getArticle(db, result.articleId)!;
    expect(article).toMatchObject({ status: "review", format: "markdown", facts: facts.text });
    // 이미지 번호는 실제 주소로 바뀌고 쓰인 이미지가 기록된다
    expect(article.body).toContain("![운전학원 사진](https://file.example/1.jpg)");
    expect(article.images.map((i) => [i.id, i.alt])).toEqual([
      ["img1", "운전학원 사진"],
      ["img2", "운전학원 사진"],
    ]);
    expect(getTopic(db, topicId)?.status).toBe("written");
    expect(db.get("SELECT COUNT(*) AS n FROM article_fingerprints")).toEqual({ n: 1 });
  });

  it("끝까지 문제가 남으면 draft로 저장하고 문제 목록을 남긴다", async () => {
    const { db, topicId, config } = setup();
    const llm = {
      generate: async () => ({
        text: output("# 운전학원\n\n짧아요"),
        provider: "claude" as const,
        model: "m",
        durationMs: 1,
      }),
    };
    const result = await generateArticle({ db, config, llm, facts, factCheck: false }, topicId);
    expect(result.status).toBe("draft");
    expect(result.attempts).toBe(3);
    expect(getArticle(db, result.articleId)?.qualityIssues.length).toBeGreaterThan(0);
  });

  it("사실 검증에서 근거 없는 서술이 나오면 고쳐 쓰게 한다", async () => {
    const { db, topicId, config } = setup();
    const prompts: string[] = [];
    const replies = [
      output(goodBody("운전학원")),
      '{"unsupported":[{"sentence":"최신 장비를 갖췄어요","reason":"근거 자료에 장비 정보 없음"}]}',
      output(goodBody("운전학원")),
      '{"unsupported":[]}',
    ];
    const llm = {
      generate: async (prompt: string) => {
        prompts.push(prompt);
        return { text: replies.shift()!, provider: "codex" as const, model: "m", durationMs: 1 };
      },
    };
    const result = await generateArticle({ db, config, llm, facts }, topicId);
    expect(result).toMatchObject({ status: "review", attempts: 2 });
    expect(prompts[1]).toMatch(/사실 검증 담당자[\s\S]*공시 수강료 71만 2천원/);
    // 채널 소개(자사 서비스 안내의 근거)도 함께 넘긴다
    expect(prompts[1]).toMatch(/채널 소개[\s\S]*운전면허PLUS는 지역별 운전학원/);
    expect(prompts[2]).toMatch(/근거 없는 서술: "최신 장비를 갖췄어요"/);
  });

  it("실제 사진이 모자라면 삽화를 만들고, 만들지 못하면 draft로 남긴다", async () => {
    const { db, topicId, config } = setup();
    const scenes: string[] = [];
    const styles: string[] = [];
    const images = {
      generate: async (scene: string, base: string, style: ImageStyle) => {
        scenes.push(scene);
        styles.push(style);
        return `${base}.png`;
      },
    };
    const llm = {
      generate: async () => ({
        text: output(goodBody("운전학원")),
        provider: "codex" as const,
        model: "m",
        durationMs: 1,
      }),
    };
    const one = { ...facts, images: [photo(1)] };
    const ok = await generateArticle(
      { db, config, llm, facts: one, images, factCheck: false },
      topicId,
    );
    expect(scenes).toHaveLength(1);
    // 기본 화풍은 사진풍
    expect(styles).toEqual(["photo"]);
    expect(ok.status).toBe("review");
    expect(getArticle(db, ok.articleId)?.images[1]).toMatchObject({ kind: "generated" });
    expect(getArticle(db, ok.articleId)?.images[1]?.url).toMatch(/^\/images\/t\d+-.+-1\.png$/);

    // 안내 섹션 전용 사진은 최소 장수에 세지 않으므로 삽화를 2장 만든다
    scenes.length = 0;
    const storeOnly = {
      ...facts,
      images: [{ ...photo(1), sectionMustMention: ["드라이빙존"] }],
    };
    await generateArticle({ db, config, llm, facts: storeOnly, images, factCheck: false }, topicId);
    expect(scenes).toHaveLength(2);

    const failing = {
      generate: async () => {
        throw new Error("이미지 생성 실패");
      },
    };
    const bad = await generateArticle(
      { db, config, llm, facts: one, images: failing, factCheck: false },
      topicId,
    );
    expect(bad.status).toBe("draft");
    expect(bad.issues.join("\n")).toMatch(/이미지가 1장뿐/);
  });

  it("삽화 화풍은 설정을 따르고, mixed 는 글마다 하나를 골라 한 글 안에서 맞춘다", async () => {
    expect(imagePrompt("도로", "image.png", "illustration")).toMatch(/화풍: [^\n]*일러스트/);
    expect(imagePrompt("도로", "image.png", "photo")).toMatch(/화풍: [^\n]*사진풍/);
    // 화풍과 상관없이 글자·얼굴 금지 조건은 남는다
    expect(imagePrompt("도로", "image.png", "illustration")).toMatch(/조건: 글자·숫자·로고/);
    expect(pickImageStyle("illustration", () => 0)).toBe("illustration");
    expect(pickImageStyle("mixed", () => 0.1)).toBe("photo");
    expect(pickImageStyle("mixed", () => 0.9)).toBe("illustration");

    const { db, topicId } = setup();
    const config = parseConfig({ images: { style: "mixed" } });
    const styles: string[] = [];
    const images = {
      generate: async (_scene: string, base: string, style: ImageStyle) => {
        styles.push(style);
        return `${base}.png`;
      },
    };
    const llm = {
      generate: async () => ({
        text: output(goodBody("운전학원")),
        provider: "codex" as const,
        model: "m",
        durationMs: 1,
      }),
    };
    await generateArticle(
      {
        db,
        config,
        llm,
        facts: { ...facts, images: [] },
        images,
        factCheck: false,
        random: () => 0.9,
      },
      topicId,
    );
    expect(styles).toEqual(["illustration", "illustration"]);

    // 채널별 값이 공통 값보다 우선한다 (주제 채널: drivingplus-community)
    styles.length = 0;
    const byChannel = parseConfig({
      images: { style: "photo", styleByChannel: { "drivingplus-community": "illustration" } },
    });
    await generateArticle(
      {
        db,
        config: byChannel,
        llm,
        facts: { ...facts, images: [] },
        images,
        factCheck: false,
      },
      topicId,
    );
    expect(styles).toEqual(["illustration", "illustration"]);

    // 화면(/settings/images)에서 저장한 값이 config.json 보다 우선한다
    styles.length = 0;
    saveImageStyles(db, { style: "photo", styleByChannel: {} });
    await generateArticle(
      {
        db,
        config: byChannel,
        llm,
        facts: { ...facts, images: [] },
        images,
        factCheck: false,
      },
      topicId,
    );
    expect(styles).toEqual(["photo", "photo"]);
  });

  it("LLM 한도 대기는 주제를 대기 상태로 두고, 다른 오류는 후보로 되돌린다", async () => {
    const { db, topicId, config } = setup();
    const limited = {
      generate: async () => {
        throw new LlmUnavailableError(new Date(), "한도");
      },
    };
    await expect(generateArticle({ db, config, llm: limited, facts }, topicId)).rejects.toThrow();
    expect(getTopic(db, topicId)?.status).toBe("queued");
    const broken = {
      generate: async () => {
        throw new Error("boom");
      },
    };
    await expect(generateArticle({ db, config, llm: broken, facts }, topicId)).rejects.toThrow(
      "boom",
    );
    expect(getTopic(db, topicId)?.status).toBe("candidate");
  });

  it("생성 예약 API는 작업을 넣고, 이미 대기 중이면 거절한다", async () => {
    const { db, topicId } = setup();
    const ctx = { db, queue: new JobQueue(db), config: parseConfig({}) } as unknown as AppContext;
    const app = createApp(ctx);
    const res = await app.request(`/api/topics/${topicId}/generate`, { method: "POST" });
    expect(res.status).toBe(202);
    expect(ctx.queue.get(((await res.json()) as { jobId: number }).jobId)?.payload).toEqual({
      topicId,
    });
    expect((await app.request(`/api/topics/${topicId}/generate`, { method: "POST" })).status).toBe(
      409,
    );
  });
});
