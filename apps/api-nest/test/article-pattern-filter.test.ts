import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isRiskyArticlePattern } from "../src/worker.service.js";

// P4: 원본 21,275개 글 패턴을 프롬프트에 주입하기 전, 위험 제목/헤딩(합격 단정·기간 단정)을 걸러낸다.
// 런타임 위험 게이트(hasRiskyDurationClaim)가 놓치는 '100%·초단기·빠른/단기 합격·N일 최단기 취득'까지
// 예방 단계에서 차단하는 게 목적이다.

describe("원본 패턴 위험 필터(P4)", () => {
  const RISKY_EXAMPLES = [
    "서울 성동구 운전면허학원 BEST 3곳: 수강료, 셔틀, 단기 합격 완벽 비교!",
    "대구 중구 삼덕동 운전면허학원 빠른 합격 핵심 4곳 추천",
    "수원 장안구 운전면허, 초보도 3일 만에 합격! 친절 강사 노하우 대공개",
    "부산진구 운전면허학원 TOP 2, 초단기 합격 필승 전략 공개",
    "운전면허 장내기능 ‘공식 함정’ 완벽 탈출, 초보도 한 번에 100% 합격하는 실전 비법",
    "구미 옥계동 운전면허학원 3곳 완벽 비교: 초보도 단기 합격 보장!",
    "안산운전면허학원, 3일 최단기 취득 강사 친절 만족 자동차학원",
  ];
  const SAFE_EXAMPLES = [
    "경기도 안성시 운전면허학원 BEST 5곳 비교",
    "평택 운전면허학원 수강료·셔틀·과정 총정리",
    "운전면허 필기시험 접수 방법과 준비물 안내",
    "H2:{학원명} > H2:{학원명} > H2:{학원명} > H2:{학원명} > H2:{학원명}",
  ];

  for (const example of RISKY_EXAMPLES) {
    it(`위험 제목을 걸러낸다: ${example.slice(0, 24)}…`, () => {
      expect(isRiskyArticlePattern({ example_title: example })).toBe(true);
    });
  }

  for (const example of SAFE_EXAMPLES) {
    it(`안전한 제목/헤딩은 통과시킨다: ${example.slice(0, 24)}…`, () => {
      expect(isRiskyArticlePattern({ example_title: example })).toBe(false);
    });
  }

  it("pattern(플레이스홀더) 필드도 함께 검사한다", () => {
    expect(isRiskyArticlePattern({ pattern: "{지역} {운전면허학원} {N}곳: 초보도 단기 합격 보장" })).toBe(true);
  });

  it("실제 주입 소스 파일에는 위험 패턴이 남지 않도록 전량 필터된다", () => {
    // originalArticlePatternGuide 가 읽는 실제 파일 — 필터 후 위험 패턴이 하나도 통과하면 안 된다.
    const file = resolve(import.meta.dirname, "../../../data/content_research/summaries/summary_all_article_patterns.json");
    const summary = JSON.parse(readFileSync(file, "utf8"));
    const titles = (summary.top_title_patterns || []).filter((p: any) => !isRiskyArticlePattern(p));
    const headings = (summary.top_heading_patterns || []).filter((p: any) => !isRiskyArticlePattern(p));
    // 필터 후 남은 것 중 위험 문구가 없어야 하고, limit(제목 4·헤딩 3) 이상은 확보돼야 한다.
    expect(titles.some(isRiskyArticlePattern)).toBe(false);
    expect(headings.some(isRiskyArticlePattern)).toBe(false);
    expect(titles.length).toBeGreaterThanOrEqual(4);
    expect(headings.length).toBeGreaterThanOrEqual(3);
  });
});
