import { describe, expect, it } from "vitest";
import { parseResearchJson } from "../src/academy-research-llm.js";

describe("parseResearchJson", () => {
  it("근거가 없는 unknown 계열 자리표시를 null로 정규화한다", () => {
    expect(parseResearchJson(JSON.stringify({
      shuttle_available: "unknown",
      facilities: "N/A",
      night_class: "na",
      scale: "확인된 값",
    }))).toMatchObject({
      shuttle_available: null,
      facilities: null,
      night_class: null,
      scale: "확인된 값",
    });
  });
});
