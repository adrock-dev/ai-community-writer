import { describe, expect, it } from "vitest";
import { isAheadOfLink, parseUtcTimestamp } from "../src/link-freshness.js";

/*
  「원천 자료가 마지막 연결보다 새로운가」 판정. 화면 세 곳(원천 데이터 탭·심층조사 카드·셸
  배너)이 같은 답을 써야 해서 서버 한 곳으로 모았다. 여기서 잠그는 것은 두 함정이다.

  1) 두 DB 의 시각 형식이 다르다 — admin.db 는 nowSql("2026-07-29 01:41:04"),
     조사 DB 는 nowIso("2026-07-29T01:41:04.128Z"). 문자열로 비교하면 공백(0x20) < "T"(0x54)
     라 연결 시각이 언제나 작게 나와 안내가 영영 꺼지지 않는다.
  2) synced_at 은 초 단위라 밀리초가 잘린다. 같은 초에 연결했는데 변경 쪽에 .276 이 붙어
     있으면 반영이 끝났는데도 안내가 남는다.
*/
describe("parseUtcTimestamp", () => {
  it("두 DB 의 형식을 같은 시각으로 읽는다", () => {
    expect(parseUtcTimestamp("2026-07-29 01:41:04")).toBe(parseUtcTimestamp("2026-07-29T01:41:04.000Z"));
  });

  it("시간대 표기가 없으면 UTC 로 읽는다", () => {
    expect(parseUtcTimestamp("2026-07-29T01:41:04")).toBe(Date.parse("2026-07-29T01:41:04Z"));
  });

  it("빈 값과 해석 불가는 null", () => {
    expect(parseUtcTimestamp(null)).toBeNull();
    expect(parseUtcTimestamp("")).toBeNull();
    expect(parseUtcTimestamp("  ")).toBeNull();
    expect(parseUtcTimestamp("어제")).toBeNull();
  });
});

describe("isAheadOfLink", () => {
  it("형식이 달라도 순서를 바르게 본다(문자열 비교였다면 뒤집힌다)", () => {
    // 변경(ISO) 이 연결(SQL) 보다 1분 앞선 상황 — 반영은 끝났다.
    expect(isAheadOfLink("2026-07-29T01:40:00.000Z", "2026-07-29 01:41:04")).toBe(false);
    // 반대로 변경이 나중이면 대기다.
    expect(isAheadOfLink("2026-07-29T01:42:00.000Z", "2026-07-29 01:41:04")).toBe(true);
  });

  it("같은 초 안의 밀리초 차이는 반영된 것으로 본다", () => {
    expect(isAheadOfLink("2026-07-29T01:41:04.276Z", "2026-07-29 01:41:04")).toBe(false);
  });

  it("1초를 넘겨 바뀌었으면 대기로 본다", () => {
    expect(isAheadOfLink("2026-07-29T01:41:05.500Z", "2026-07-29 01:41:04")).toBe(true);
  });

  it("바뀐 적이 없으면 대기가 아니다", () => {
    expect(isAheadOfLink(null, "2026-07-29 01:41:04")).toBe(false);
  });

  it("한 번도 연결한 적 없으면 대기로 보지 않는다", () => {
    // 반영할 대상 자체가 없다. 그 상황은 「연결된 학원이 없습니다」 안내가 따로 맡으므로,
    // 여기서도 세우면 같은 버튼을 가리키는 안내가 한 화면에 둘 선다.
    expect(isAheadOfLink("2026-07-29T01:41:04.000Z", null)).toBe(false);
  });
});
