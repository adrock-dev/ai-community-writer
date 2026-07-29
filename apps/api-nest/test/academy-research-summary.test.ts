import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AcademyResearchDbService } from "../src/academy-research-db.service.js";

/*
  도메인 화면의 「심층조사 현황」 배지가 읽는 요약이다.

  이 숫자는 운영자가 「조사값 신뢰 기준」을 켤지 판단하는 근거라, 조사 DB 전체가 아니라
  **이 도메인 글에 닿는 것**만 세야 한다. 예전에는 그러지 않아 두 가지가 어긋났다.

  - 「조사 완료 377곳(99%)」 — 원천 교차검증 항목만 채워진 62곳까지 세서 실제(315곳)보다 후했다.
  - 「검토 필요 11건」 — 전부 글에 안 나가는 homepage_url 이었고, 같은 허용 목록을 쓰는
    자료관리 검토 대기 화면은 0건이라 배지를 눌러 가면 빈 화면이었다.
*/
describe("AcademyResearchDbService summarizeByExternalIds", () => {
  let tmp: string;
  let db: AcademyResearchDbService;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "research-summary-"));
    process.env.ACADEMY_RESEARCH_DB_PATH = join(tmp, "research.db");
    db = new AcademyResearchDbService();
    db.init();
  });

  afterEach(() => {
    delete process.env.ACADEMY_RESEARCH_DB_PATH;
    rmSync(tmp, { recursive: true, force: true });
  });

  const seed = (externalId: string, name = externalId) => db.upsertBase({ external_id: externalId, name, address: "서울 강남구 1" });
  const research = (externalId: string, values: Record<string, unknown>) =>
    db.upsertResearch(externalId, values, { engine: "codex", method: "test" });

  it("글에 실릴 수 있는 값이 있는 학원만 article_ready 로 센다", () => {
    seed("a");
    seed("b");
    // 교차검증용 항목만 채워진 학원. 조사는 끝났지만 글에는 한 글자도 실리지 않는다.
    research("a", { name_researched: "OO운전전문학원", gu: "강남구" });
    research("b", { night_class: "평일 야간반 운영" });

    const summary = db.summarizeByExternalIds(["a", "b"]);

    expect(summary.researched).toBe(2);
    expect(summary.article_ready).toBe(1);
  });

  it("시도했지만 값이 없는 자리를 근거 없음·실패·미시도로 나눈다", () => {
    seed("saved");
    seed("no-src");
    seed("failed");
    seed("never");
    research("saved", { night_class: "야간반 있음" });
    db.recordResearchAttempt("no-src", "no_sources");
    db.recordResearchAttempt("failed", "failed", "CLI 오류");

    const summary = db.summarizeByExternalIds(["saved", "no-src", "failed", "never"]);

    expect(summary.matched).toBe(4);
    expect(summary.researched).toBe(1);
    expect(summary.no_sources).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.unattempted).toBe(1);
  });

  it("검토·승인은 글에 실릴 수 있는 항목만 센다", () => {
    seed("a");
    // homepage_url 은 글에 나가지 않는다 — 승인해도 이 도메인 글에 닿지 않으므로 세지 않는다.
    db.setFieldMeta("a", "homepage_url", { status: "needs_review" });
    db.setFieldMeta("a", "pass_rate", { status: "verified" });
    db.setFieldMeta("a", "night_class", { status: "needs_review" });
    db.setFieldMeta("a", "facilities", { status: "verified" });

    const summary = db.summarizeByExternalIds(["a"]);

    expect(summary.needs_review).toBe(1);
    expect(summary.verified).toBe(1);
  });

  it("내려간 학원(active=0)의 검토·승인은 세지 않는다", () => {
    seed("gone");
    seed("kept");
    db.setFieldMeta("gone", "night_class", { status: "needs_review" });
    // 원천 목록에서 내려간 학원은 다음 동기화에서 active=0 이 된다(삭제하지 않고 보관).
    db.setActiveByExternalIds(["kept"]);

    const summary = db.summarizeByExternalIds(["gone"]);

    expect(summary.needs_review).toBe(0);
  });

  it("빈 목록은 0으로 채운 요약을 돌려준다", () => {
    const summary = db.summarizeByExternalIds([]);
    expect(summary).toMatchObject({ matched: 0, researched: 0, article_ready: 0, no_sources: 0, failed: 0, unattempted: 0, needs_review: 0, verified: 0 });
  });
});
