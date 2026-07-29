import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getArchetype } from "../src/archetypes.js";

/**
 * 블로그리뷰가 생성 프롬프트에 들어가지 않는지 잠근다.
 *
 * 왜 빼기로 했나(2026-07-27 실측): 원천은 네이버 블로그 검색으로 학원명을 느슨하게 매칭해
 * 오배정이 섞인다. 539건 중 55건은 학원 고유명이 글 어디에도 없었고, 같은 글 18건이 이름이
 * 비슷한 학원 2~3곳에 중복 배정됐다(중앙/천안중앙/북부중앙 등). 개별 건의 진위를 판별할
 * 방법이 없다. "내부 참고용" 으로만 넣어도 그 안의 표현(예: 블로그 제목의 "빠른합격")이
 * 위험 패턴 필터를 우회해 모델에 닿았고, "본문 서술 안 함" 을 강제하는 게이트도 없다.
 *
 * 저장은 그대로 두되(학원 상세 화면 참고용) 프롬프트 경로만 끊는 것이 이 테스트의 범위다.
 */

type Db = import("../src/db.service.js").DbService;
type Worker = import("../src/worker.service.js").WorkerService;

let db: Db;
let WorkerService: typeof import("../src/worker.service.js").WorkerService;
const domain = "blog-facts.test";
const region = "테스트시";

const BLOG_REVIEWS = [
  {
    title: "가온 자동차운전전문학원 빠른합격 원한다면",
    content: "강사님이 친절하고 꼼꼼하게 설명해 주셨습니다. 셔틀 동선도 좋았어요.",
    link: "https://blog.example.test/1",
    postdate: "20260102",
    images: [],
  },
];

beforeAll(async () => {
  process.env.SEO_DB_PATH = join(mkdtempSync(join(tmpdir(), "blog-facts-")), "admin.db");
  const dbModule = await import("../src/db.service.js");
  WorkerService = (await import("../src/worker.service.js")).WorkerService;
  db = new dbModule.DbService();
  db.init();
  db.createDomain({ domain, display_name: "blog facts", vertical: "driving" });
  db.run("INSERT INTO seo_regions (domain, level, region, latitude, longitude, source_name) VALUES (?, ?, ?, ?, ?, ?)", [domain, 2, region, 37, 127, "fixture"]);
  // 비교형 아키타입은 후보가 최소 2곳이어야 성립한다. 1곳만 넣으면 facts 가 비어
  // "블로그리뷰가 없다" 는 검사들이 전부 공허하게 통과한다.
  db.upsertAcademies(domain, [
    {
      external_id: "id-blog-facts-1",
      region,
      name: "가온 자동차운전전문학원",
      address: `${region} 중심로 1`,
      latitude: 37.01,
      longitude: 127,
      academy_type: "academy",
      phone: "031-000-0000",
      vphone: "0507-0000-0000",
      review_json: [{ point: 5, content: "장내기능 코스가 넓어 연습하기 좋았습니다.", author: "익명", date: "2026-01-02" }],
      blog_reviews: BLOG_REVIEWS,
    },
    {
      external_id: "id-blog-facts-2",
      region,
      name: "나루 자동차운전전문학원",
      address: `${region} 중심로 2`,
      latitude: 37.02,
      longitude: 127,
      academy_type: "academy",
      phone: "031-000-0001",
      vphone: "0507-0000-0001",
    },
  ]);
});

function factText(): string {
  const worker = new WorkerService(db, {} as never) as Worker;
  return (worker as any).buildFacts(domain, {
    slot_id: `T01_${domain}`,
    region,
    primary_keyword: `${region} 운전면허학원`,
  }, {}, ["exam_academy", "academy"], getArchetype("local")).text;
}

describe("블로그리뷰는 생성 프롬프트에 넣지 않는다", () => {
  it("저장은 되어 있고 학원이 후보로 잡힌다(전제 확인)", () => {
    const row = db.listAcademies(domain).find((a) => String(a.name).startsWith("가온"))!;
    expect(JSON.parse(String(row.blog_reviews || "[]"))).toHaveLength(1);
    // 후보가 0곳이면 아래 "없다" 검사들이 전부 공허하게 통과한다.
    expect(factText()).toContain("가온 자동차운전전문학원");
  });

  it("facts 에 블로그 보충자료 줄이 없다", () => {
    expect(factText()).not.toContain("블로그 리뷰글 보충자료");
    expect(factText()).not.toContain("보충자료");
  });

  it("블로그 글 제목·링크가 facts 로 새지 않는다", () => {
    const facts = factText();
    expect(facts).not.toContain("blog.example.test");
    // 블로그 제목의 위험 표현이 프롬프트에 닿던 경로를 막았는지 확인한다.
    expect(facts).not.toContain("빠른합격");
  });

  it("자체 수강생 리뷰는 그대로 facts 에 남는다", () => {
    expect(factText()).toContain("장내기능 코스가 넓어");
  });
});
