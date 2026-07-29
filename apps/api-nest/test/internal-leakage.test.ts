import { describe, expect, it } from "vitest";
import { normalizeGeneratedMarkdown, removeInternalLeakage } from "../src/worker.service.js";

// 정규화 단계의 내부 누출 제거(removeInternalLeakage)는 '자기 공개 도메인 내부링크'를 지우면 안 된다.
// (P3 내부링크가 살아남아 발행되려면 필수. 내부 API host·브랜드명은 계속 제거되어야 한다.)

describe("removeInternalLeakage 자기 도메인 예외", () => {
  const ownLink = "본문 시작\n\n자세한 내용은 [의왕시 총정리](https://app.drivingplus.me/community/의왕시-운전면허학원)를 참고하세요.\n\n본문 끝";

  it("siteHost 없으면 자기 도메인 링크 줄도 제거한다(기존 동작)", () => {
    const out = removeInternalLeakage(ownLink);
    expect(out).not.toContain("drivingplus");
    expect(out).not.toContain("community/의왕시");
  });

  it("siteHost 를 주면 자기 공개 도메인 내부링크 줄은 보존한다", () => {
    const out = removeInternalLeakage(ownLink, "app.drivingplus.me");
    expect(out).toContain("https://app.drivingplus.me/community/의왕시-운전면허학원");
    expect(out).toContain("의왕시 총정리");
  });

  it("siteHost 를 줘도 내부 API host 줄은 계속 제거한다", () => {
    const md = "정상 문단\n\n내부 https://api-dev.drivingplus.me/get-all-academy 호출\n\n다음 문단";
    const out = removeInternalLeakage(md, "app.drivingplus.me");
    expect(out).not.toContain("api-dev.drivingplus.me");
    expect(out).toContain("정상 문단");
    expect(out).toContain("다음 문단");
  });

  it("siteHost 를 줘도 산문 속 DrivingPlus 브랜드 줄은 계속 제거한다", () => {
    const md = "정상 문단\n\nDrivingPlus 자료를 근거로 한다\n\n다음 문단";
    const out = removeInternalLeakage(md, "app.drivingplus.me");
    expect(out).not.toContain("DrivingPlus");
    expect(out).toContain("정상 문단");
  });

  it("수강생 리뷰의 공개 출처 표기는 보존한다", () => {
    const md = "정상 문단\n\n> 좋은 설명이었습니다. — 출처: 운전면허PLUS 실제 수강생 리뷰 · 평점: 5/5\n\n다음 문단";
    const out = removeInternalLeakage(md, "app.drivingplus.me");
    expect(out).toContain("출처: 운전면허PLUS 실제 수강생 리뷰 · 평점: 5/5");
  });

  // 입력 묶음 표현("보충자료")은 내부 자료 언어다. "긍정"을 필수 접두어로 두면 모델이 그 단어만
  // 빼고 써도 그대로 통과했다(평가 산출물에서 실제 관측). 접두어 없이도 제거되어야 한다.
  it.each([
    ["긍정 접두어 있음", "긍정 수강생 리뷰 보충자료에는 친절한 상담이 언급됐습니다"],
    ["긍정 접두어 없음", "수강생 리뷰 보충자료에는 친절한 상담이 언급됐습니다"],
    ["블로그 리뷰글", "블로그 리뷰글 보충자료를 참고했습니다"],
  ])("리뷰 보충자료 줄은 제거한다(%s)", (_label, leaked) => {
    const out = removeInternalLeakage(`정상 문단\n\n${leaked}\n\n다음 문단`, "app.drivingplus.me");
    expect(out).not.toContain("보충자료");
    expect(out).toContain("정상 문단");
    expect(out).toContain("다음 문단");
  });

  it("보충자료가 아닌 정상 리뷰 서술은 보존한다", () => {
    const md = "정상 문단\n\n수강생 리뷰를 한 건 인용했습니다\n\n다음 문단";
    expect(removeInternalLeakage(md, "app.drivingplus.me")).toContain("수강생 리뷰를 한 건 인용했습니다");
  });
});

// 인접 헤딩 보강은 정보량 0인 문장을 넣으므로 최소 범위에서만 동작해야 한다.
// `## 큰 주제` → `### 개별 항목` 은 정상 구조인데 여기에도 채우는 바람에 모든 글에
// 제목을 되풀이하는 문장이 하나씩 실렸다("후보별로 확인할 차이에서 확인할 내용을…").
describe("ensureHeadingBodies 범위", () => {
  const fill = (md: string) => normalizeGeneratedMarkdown(md, {}, "app.drivingplus.me");

  it("H2 다음 H3(상위→하위)는 채우지 않는다", () => {
    const out = fill("# 제목\n\n## 후보별로 확인할 차이\n\n### 가나다학원\n\n본문입니다.\n");
    expect(out).not.toContain("확인할 내용을 아래에 이어서");
    expect(out).not.toContain("관련 정보는 아래 내용을 참고하세요");
  });

  it("같은 깊이가 연달아 나오면(H3→H3) 실제로 내용이 빠진 것이라 채운다", () => {
    const out = fill("# 제목\n\n### 가나다학원\n\n### 라마바학원\n\n본문입니다.\n");
    expect(out).toMatch(/확인할 내용을 아래에 이어서|관련 정보는 아래 내용을 참고하세요/);
  });

  it("H2 다음 H2 도 채운다", () => {
    const out = fill("# 제목\n\n## 첫 섹션\n\n## 둘째 섹션\n\n본문입니다.\n");
    expect(out).toMatch(/확인할 내용을 아래에 이어서|관련 정보는 아래 내용을 참고하세요/);
  });
});
