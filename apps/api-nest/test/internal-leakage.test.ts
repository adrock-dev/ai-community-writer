import { describe, expect, it } from "vitest";
import { removeInternalLeakage } from "../src/worker.service.js";

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
});
