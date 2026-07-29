import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// DbService 는 생성자에서 SEO_DB_PATH 를 읽으므로 import 전에 임시 DB 를 지정한다(골든 러너와 같은 방식).
process.env.SEO_DB_PATH = join(mkdtempSync(join(tmpdir(), "entity-slot-")), "test.db");
const { DbService } = await import("../src/db.service.js");
const { SlotService } = await import("../src/slot.service.js");

const DOMAIN = "entity-test";
let db: InstanceType<typeof DbService>;
let slots: InstanceType<typeof SlotService>;

beforeAll(() => {
  db = new DbService();
  db.init();
  db.createDomain({ domain: DOMAIN, display_name: DOMAIN, vertical: "driving", templates_enabled: JSON.stringify(["T11", "T14"]) });
  slots = new SlotService(db);
  slots.applyPreset(DOMAIN, "driving");
  db.upsertAcademies(DOMAIN, [
    // 시험장 2곳 — 한 곳은 슬롯 지역 축에 없는 지역이라 region 기반이면 안 나오던 자리다.
    { external_id: "x-exam-1", name: "가 운전면허시험장", region: "강원특별자치도 강릉시", address: "강원 강릉 1", academy_type: "license_test_course", phone: "033-1" },
    { external_id: "x-exam-2", name: "나 운전면허시험장", region: "강원특별자치도 태백시", address: "강원 태백 2", academy_type: "license_test_course", phone: "033-2" },
    // 같은 지역 학원 3곳 — region 기반이면 세 슬롯이 같은 학원을 골라 제목까지 같아지던 경우다.
    { external_id: "x-ac-1", name: "가자동차운전전문학원", region: "강원특별자치도 강릉시", address: "강원 강릉 11", academy_type: "exam_academy", phone: "033-11" },
    { external_id: "x-ac-2", name: "나자동차운전전문학원", region: "강원특별자치도 강릉시", address: "강원 강릉 12", academy_type: "exam_academy", phone: "033-12" },
    { external_id: "x-ac-3", name: "다자동차운전전문학원", region: "강원특별자치도 강릉시", address: "강원 강릉 13", academy_type: "exam_academy", phone: "033-13" },
  ]);
  slots.generateSlotsForDomain(DOMAIN, { templates: ["T11", "T14"], maxPerTemplate: 40 });
});

const rowsOf = (templateId: string) =>
  db.all("SELECT * FROM slots WHERE domain=? AND template_id=? ORDER BY entity_id", [DOMAIN, templateId]) as Record<string, any>[];

describe("단독 소개형은 시설 1곳당 슬롯 하나를 만든다", () => {
  it("시험장 수만큼만 슬롯이 생긴다(지역 조합으로 부풀지 않는다)", () => {
    const rows = rowsOf("T11");
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.entity_id).sort()).toEqual(["x-exam-1", "x-exam-2"]);
  });

  it("같은 지역 학원 3곳이 각각 다른 슬롯을 받는다 — 중복 글의 원인이던 자리", () => {
    const rows = rowsOf("T14");
    expect(rows.length).toBe(3);
    expect(new Set(rows.map((r) => r.entity_id)).size).toBe(3);
  });

  it("region 이 그 시설의 실제 소재지다 — 제목 규칙이 여기에 기댄다", () => {
    const exam = rowsOf("T11");
    expect(exam.find((r) => r.entity_id === "x-exam-2")?.region).toBe("강원특별자치도 태백시");
    // primary_keyword 도 실제 소재지로 만들어져야 "동해시 시험장인데 강릉" 같은 어긋남이 안 생긴다.
    expect(exam.find((r) => r.entity_id === "x-exam-2")?.primary_keyword).toContain("태백시");
  });

  it("재생성해도 같은 슬롯이다(slot_id 는 시설 id 기반)", () => {
    const before = rowsOf("T11").map((r) => r.slot_id).sort();
    slots.generateSlotsForDomain(DOMAIN, { templates: ["T11"], maxPerTemplate: 40 });
    expect(rowsOf("T11").map((r) => r.slot_id).sort()).toEqual(before);
  });
});
