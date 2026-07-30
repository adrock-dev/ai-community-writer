import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 후보 생성이 대량에서 죽지 않는지 확인한다.
 *
 * `rows.push(...distributed)` 처럼 배열을 스프레드로 넘기면 원소가 **인자 목록으로 펼쳐져**
 * 콜스택 한계(이 Node 에서 실측 12만~12.5만 사이)를 넘는 순간 `RangeError` 로 즉시 죽었다.
 * 부하로 느려지다 실패하는 게 아니라 임계값에서 크래시라 관리자에게는 원인 불명의 500 으로 보인다.
 * `MAX_SLOTS_PER_TEMPLATE`(기본 10,000)를 올릴 때 가장 먼저 터지던 자리다 —
 * 상한 자체는 환경변수라 코드 수정 없이 올라갈 수 있으므로 가드를 코드 쪽에 둔다.
 *
 * 실측 비용(2026-07-30): 상한 10만이 651ms·heap 56MB 로 통과했고 30만에서 크래시했다.
 * 여기서는 임계값 바로 위만 넘겨 본다.
 */

const OVER_SPREAD_LIMIT = 130_000;

let db: import("../src/db.service.js").DbService;
let slots: import("../src/slot.service.js").SlotService;
let tmp: string;
const DOMAIN = "scale";

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "slot-scale-"));
  process.env.SEO_DB_PATH = join(tmp, "admin.db");
  // 상한은 환경변수로 열려 있다 — 가드는 그 상태를 재현해야 의미가 있다.
  process.env.SEO_MAX_SLOTS_PER_TEMPLATE = String(OVER_SPREAD_LIMIT);
  const { DbService } = await import("../src/db.service.js");
  const { SlotService } = await import("../src/slot.service.js");
  db = new DbService();
  db.init();
  db.createDomain({ domain: DOMAIN, display_name: DOMAIN, vertical: "driving", templates_enabled: JSON.stringify(["T16"]) });
  slots = new SlotService(db);
  slots.applyPreset(DOMAIN, "driving");
  // 상한을 채울 만큼 지역을 늘린다(지역 × 키워드 × 축 조합이 후보 수를 만든다).
  db.bulkReplaceAxis(DOMAIN, "region", Array.from({ length: 4000 }, (_, i) => ({ value: `가상도 ${String(i).padStart(4, "0")}시`, weight: 5 })));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.SEO_MAX_SLOTS_PER_TEMPLATE;
});

describe("후보 생성 대량 처리", () => {
  it("스프레드 한계를 넘는 개수도 크래시 없이 만든다", () => {
    // 회귀 시 여기서 RangeError: Maximum call stack size exceeded 로 죽는다.
    const summary = slots.generateSlotsForDomain(DOMAIN, { templates: ["T16"], maxPerTemplate: OVER_SPREAD_LIMIT });
    expect(Number(summary.T16)).toBeGreaterThan(124_000);

    // 저장된 수는 만든 수보다 아주 조금 적을 수 있다 — slot_id 가 sha1 앞 8자리(32비트)라
    // 대량에서 생일 문제로 충돌하고, 충돌한 둘은 같은 id 로 합쳐진다. 기댓값은 n²/2³³ 이라
    // 상한 10,000 에서는 0.01건(사실상 없음), 13만 건에서 약 2건이다. 상한을 크게 올릴 때만
    // 의미가 생기는 손실이라 지금은 허용하되, 조용히 커지지 않도록 여기서 크기를 붙잡아 둔다.
    const stored = Number(db.get("SELECT COUNT(*) AS n FROM slots WHERE domain=?", [DOMAIN])?.n ?? 0);
    const lost = Number(summary.T16) - stored;
    expect(lost).toBeLessThan(10);
  }, 30_000);
});
