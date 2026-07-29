import { describe, expect, it } from "vitest";
import { SCHEMA_FIELDS } from "../src/academy-research-web.js";
import { RESEARCH_FIELDS } from "../src/academy-research-db.service.js";
import { SCALAR_KEYS } from "../src/academy-research.service.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// 관리자 쪽 라벨 목록은 `@/lib/api` 별칭을 끌고 와 여기서 import 할 수 없다. 목록만 읽는다.
function adminLabelKeys(): string[] {
  const file = readFileSync(resolve(import.meta.dirname, "../../admin-next/lib/academy-research.ts"), "utf8");
  const block = file.split("RESEARCH_FIELD_LABELS")[1] ?? "";
  return [...block.slice(0, block.indexOf("];")).matchAll(/\{\s*key:\s*"([^"]+)"/g)].map((m) => m[1]!);
}

// 조사 필드 하나를 늘리려면 여섯 군데를 손으로 고쳐야 한다 — 프롬프트 스키마, DB 컬럼,
// 수정 화이트리스트, 저장 키 목록, 화면 라벨, (글에 실을 것이면) 글 필드 목록.
// transit_access·parking_note 를 넣을 때 실제로 여섯 곳을 다 짚어야 했다. 한 곳이라도
// 빠지면 값이 조용히 사라진다 — 프롬프트는 묻는데 저장이 안 되거나, 저장은 됐는데
// 화면에 안 뜨거나. 어느 쪽도 실행해 보기 전에는 드러나지 않는다.
describe("조사 필드 목록 정합", () => {
  const schemaKeys = SCHEMA_FIELDS.map((f) => f.key);

  it("프롬프트가 묻는 필드는 전부 저장된다", () => {
    const missing = schemaKeys.filter((key) => !(SCALAR_KEYS as string[]).includes(key));
    expect(missing, `저장 키 목록(SCALAR_KEYS)에 없음: ${missing.join(", ")}`).toEqual([]);
  });

  it("저장하는 필드는 전부 DB 화이트리스트에 있다", () => {
    const missing = (SCALAR_KEYS as string[]).filter((key) => !RESEARCH_FIELDS.has(key));
    expect(missing, `DB 화이트리스트에 없음: ${missing.join(", ")}`).toEqual([]);
  });

  it("DB 화이트리스트에 프롬프트가 안 묻는 필드가 남아 있지 않다", () => {
    const stale = [...RESEARCH_FIELDS].filter((key) => !schemaKeys.includes(key));
    expect(stale, `프롬프트에서 사라진 필드: ${stale.join(", ")}`).toEqual([]);
  });

  it("저장하는 필드는 전부 화면 라벨이 있다", () => {
    const labeled = new Set(adminLabelKeys());
    expect(labeled.size, "라벨 목록을 못 읽었다 — 파싱 규칙이 코드와 어긋났다").toBeGreaterThan(20);
    const missing = (SCALAR_KEYS as string[]).filter((key) => !labeled.has(key));
    expect(missing, `화면 라벨이 없음(값이 있어도 안 보인다): ${missing.join(", ")}`).toEqual([]);
  });
});
