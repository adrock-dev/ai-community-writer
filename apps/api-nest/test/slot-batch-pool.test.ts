import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 「글 작성」 배치 선별의 후보 풀 회귀 가드.
 *
 * `selectSlotsForBatch` 는 planned 슬롯을 읽어 유형별 라운드로빈으로 작성 대상을 고른다. 그런데
 * 풀을 도메인 전체에서 priority_score 순으로 한 번에 자르면, 후보가 많고 우선순위가 높은 유형
 * 하나가 풀을 통째로 차지해 **다른 유형이 라운드로빈에 아예 등장하지 못한다.** 에러도 경고도 없다.
 *
 * 실측(2026-07-30 운영 DB): T16 planned 9,991건(priority 48)이 상한 10,000을 채워
 * T14 57건 전량(19.6)과 T11 15건(20)이 작성 대상에서 영구 제외돼 있었다. 지금은 풀을
 * 글유형별로(PARTITION BY template_id) 잡는다.
 */

let db: import("../src/db.service.js").DbService;
let tmp: string;

const DOMAIN = "pool";
// 운영 재현: 우선순위가 높고 후보가 풀 상한을 넘는 유형 + 우선순위가 낮고 후보가 적은 유형들.
const CROWDING = { template: "T16", count: 10_050, priority: 48 };
const STARVED = [
  { template: "T14", count: 57, priority: 19.6 },
  { template: "T11", count: 24, priority: 20 },
];

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "slot-pool-"));
  process.env.SEO_DB_PATH = join(tmp, "admin.db");
  const { DbService } = await import("../src/db.service.js");
  db = new DbService();
  db.init();
  db.createDomain({ domain: DOMAIN, display_name: DOMAIN, vertical: "driving", templates_enabled: JSON.stringify(["T16", "T14", "T11"]) });

  const rows = [];
  for (const { template, count, priority } of [CROWDING, ...STARVED]) {
    for (let i = 0; i < count; i++) {
      rows.push({
        slot_id: `${template}-${i}`, domain: DOMAIN, template_id: template,
        // 지역·키워드가 슬롯마다 달라야 한다 — 선별이 같은 주제를 중복 제거하기 때문.
        primary_keyword: `${template} 키워드`, region: `${template} 지역 ${i}`,
        persona: null, intent: null, modifier_1: null, modifier_2: null, entity_id: null, priority_score: priority,
      });
    }
  }
  db.bulkUpsertSlots(rows);
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("배치 선별 후보 풀", () => {
  it("우선순위가 높은 유형이 풀을 넘겨도 다른 유형이 작성 대상에 들어온다", () => {
    const picked = db.selectSlotsForBatch(DOMAIN, { limit: 30 });
    const templates = new Set(picked.map((row) => String(row.template_id)));
    // 회귀 시 T16 이 풀 10,000 건을 혼자 채워 templates 가 {T16} 하나가 된다.
    for (const { template } of STARVED) expect(templates).toContain(template);
  });

  it("후보가 적은 유형은 가진 만큼 전부 선별 대상이 된다", () => {
    for (const { template, count } of STARVED) {
      const picked = db.selectSlotsForBatch(DOMAIN, { template, limit: 500 });
      expect(picked.length).toBe(count);
    }
  });

  it("글유형을 지정하면 그 유형만 나온다 — 필터 동작은 그대로", () => {
    const picked = db.selectSlotsForBatch(DOMAIN, { template: CROWDING.template, limit: 10 });
    expect(picked.length).toBe(10);
    expect(new Set(picked.map((row) => String(row.template_id)))).toEqual(new Set([CROWDING.template]));
  });

  /**
   * 자동 선별 규칙 통일(개수만 다르고 규칙은 하나)의 회귀 가드.
   *
   * 예전에는 「현재 검색 N개」가 글유형 라운드로빈, 「전국 골고루」가 지역 라운드로빈 + 필터 무시로
   * 규칙이 갈렸다. 각각 한쪽으로 치우쳤다 — 지역 라운드로빈만 쓰면 후보가 적은 유형이 0건이 되고,
   * 글유형 라운드로빈만 쓰면 특수 유형이 후보 비율을 훨씬 넘겨 뽑힌다(실측 2026-07-30).
   * 지금은 개수와 무관하게 ①유형 최소 1건 ②지역 골고루 ③같은 주제 1건이다.
   */
  describe("규칙 통일 — 개수만 달라진다", () => {
    for (const limit of [10, 30, 100]) {
      it(`${limit}개를 뽑아도 지역이 겹치지 않는다`, () => {
        const picked = db.selectSlotsForBatch(DOMAIN, { limit });
        expect(picked.length).toBe(limit);
        // 이 픽스처는 슬롯마다 지역이 달라 지역 수가 후보 수보다 많다 — 겹치면 지역 분산이 깨진 것이다.
        expect(new Set(picked.map((row) => String(row.region))).size).toBe(limit);
      });

      it(`${limit}개를 뽑아도 같은 지역+키워드 주제는 한 번만 나온다`, () => {
        const picked = db.selectSlotsForBatch(DOMAIN, { limit });
        const topics = new Set(picked.map((row) => `${row.region}::${row.primary_keyword}`));
        expect(topics.size).toBe(picked.length);
      });

      it(`${limit}개를 뽑으면 굶는 글유형이 없다`, () => {
        const templates = new Set(db.selectSlotsForBatch(DOMAIN, { limit }).map((row) => String(row.template_id)));
        for (const { template } of STARVED) expect(templates).toContain(template);
        expect(templates).toContain(CROWDING.template);
      });
    }

    it("후보가 적은 유형이 개수를 독점하지 않는다 — 대부분은 후보가 많은 유형이다", () => {
      const picked = db.selectSlotsForBatch(DOMAIN, { limit: 100 });
      const crowding = picked.filter((row) => String(row.template_id) === CROWDING.template).length;
      // 유형 라운드로빈이던 시절에는 여기가 39건이었다(특수 유형이 61%). 지금은 최소 보장 1건씩만 준다.
      expect(crowding).toBe(100 - STARVED.length);
    });
  });
});
