import { describe, expect, it } from "vitest";
import { formatShuttleFact, type RegionDirectoryEntry } from "../src/drivingplus-shuttle-facts.js";

// 표본은 실제 DrivingPlus dev 응답에서 가져왔다.
// 독자가 알고 싶은 것은 "어느 지역으로 셔틀이 오는가"이고, 노선 수나 내부 라벨이 아니다.

const bus = (over: Partial<Parameters<typeof formatShuttleFact>[0] extends (infer T)[] | null | undefined ? T : never> = {}) => ({
  title: null, runDirection: null, content: null, footContent: null, phone: null, times: [], ...over,
});

const 인천서구: RegionDirectoryEntry = { region: "인천광역시 서구 경서동", sido: "인천광역시", sigungu: "서구", submunicipal: "경서동" };
const 인천동구: RegionDirectoryEntry = { region: "인천광역시 동구 송림동", sido: "인천광역시", sigungu: "동구", submunicipal: "송림동" };
const 목포시: RegionDirectoryEntry = { region: "전라남도 목포시", sido: "전라남도", sigungu: "목포시", submunicipal: null };
const 강남구: RegionDirectoryEntry = { region: "서울특별시 강남구", sido: "서울특별시", sigungu: "강남구", submunicipal: null };

describe("운행 지역 판별", () => {
  it("정류장명에 등장한 읍·면·동을 사전과 대조해 시·군·구로 묶는다", () => {
    const text = formatShuttleFact(
      [bus({ title: "1호차", times: [{ time: "", runDirection: "경서동 태평@" }, { time: "7분", runDirection: "송림동 하이마트" }] })],
      [인천서구, 인천동구],
    );
    expect(text).toContain("운행 지역(자료 기준) 서구(경서동), 동구(송림동)");
  });

  it("학원이 안내문에 적은 지역 표기를 그대로 인정한다", () => {
    const text = formatShuttleFact([bus({ title: "목포 전지역" })], [목포시]);
    expect(text).toContain("목포시");
  });

  it("지명이 상호에 우연히 들어간 경우를 지역으로 착각하지 않는다", () => {
    // 실제 오탐 사례: 인천 서구 학원의 "강남시장(DC마트앞)" 이 서울 강남구로 잡혔다.
    const text = formatShuttleFact([bus({ title: "1호차", times: [{ time: "", runDirection: "강남시장(DC마트앞)" }] })], [강남구]);
    expect(text).not.toContain("강남구");
  });

  it("사전이 비어 있으면 지역 매칭을 건너뛰고 나머지는 그대로 낸다", () => {
    const text = formatShuttleFact([bus({ title: "1호차", times: [{ time: "", runDirection: "마석역" }] })], []);
    expect(text).toContain("마석역");
    expect(text).not.toContain("운행 지역");
  });
});

describe("운영 라벨 배제", () => {
  it("차량번호·일반 라벨은 지역으로 쓰지 않는다", () => {
    for (const label of ["1호차", "3호차", "셔틀버스", "셔틀노선", "노선", "버스문의", "기타"]) {
      const text = formatShuttleFact([bus({ title: label })], []);
      expect(text).toBe("셔틀 운행(세부 정보는 자료에 없음)");
    }
  });

  it("노선 수를 앞세우지 않는다(모델이 그것만 쓰던 원인)", () => {
    const many = ["1호차", "2호차", "3호차", "4호차"].map((title) => bus({ title }));
    expect(formatShuttleFact(many, [])).not.toMatch(/노선\s*\d+개/u);
  });
});

describe("예약·이용 조건", () => {
  it("안내문의 예약 조건을 노출한다", () => {
    const text = formatShuttleFact([bus({ title: "1호차", content: "셔틀은 픽업 방식으로 이용 하시기 1~3시간 전에 전화를 주셔야합니다" })], []);
    expect(text).toContain("이용 조건");
    expect(text).toContain("1~3시간 전");
  });

  it("홍보 문구는 싣지 않는다", () => {
    // "집 앞까지 모시러" 는 커버리지 단정이기도 하다.
    const text = formatShuttleFact([bus({ title: "1호차", content: "원하시는 곳 말씀만 해주시면 편안하게 집 앞까지 모시러 갑니다. 전화 예약" })], []);
    expect(text).not.toContain("모시");
    expect(text).not.toContain("편안");
  });
});

describe("전화번호", () => {
  it("셔틀 연락처(실번호)를 노출하지 않는다", () => {
    // 390개 노선 중 389개가 실번호다. 공개 연락처는 학원 안심번호 하나로 통일한다.
    const text = formatShuttleFact([bus({ title: "목포 전지역", phone: "061-277-1002" })], [목포시]);
    expect(text).not.toContain("061-277-1002");
  });

  it("안내문 본문에 섞인 실번호도 제거한다", () => {
    const text = formatShuttleFact([bus({ title: "1호차", content: "미리 연락주시면 됩니다. 학원문의 : 032-446-1199" })], []);
    expect(text).not.toContain("032-446-1199");
  });
});

describe("경계", () => {
  it("셔틀 자료가 없으면 null 이다", () => {
    expect(formatShuttleFact([], [])).toBeNull();
    expect(formatShuttleFact(null, [])).toBeNull();
  });

  it("출발지 표기는 경유지로 세지 않는다", () => {
    const text = formatShuttleFact([bus({ title: "1호차", times: [{ time: "", runDirection: "학원출발" }, { time: "7분", runDirection: "마석역" }] })], []);
    expect(text).toContain("마석역 등 1곳");
  });

  it("facts 필드 경계를 깨는 슬래시가 남지 않는다", () => {
    const text = formatShuttleFact([bus({ title: "공휴일/일요일 노선", times: [{ time: "", runDirection: "구리역" }] })], []);
    expect(text).not.toContain("/");
  });
});

describe("시·군·구만 확인된 경우 동을 지어내지 않는다", () => {
  // 실제 버그: "구리 · 수택 · 다산 방면" 한 줄로 구리시의 갈매동·교문동·사노동·아천동까지
  // '확인된 것처럼' 나열됐다. 본문에 등장한 것은 "수택" 하나뿐이었다.
  const 구리시 = (submunicipal: string | null): RegionDirectoryEntry =>
    ({ region: `경기도 구리시${submunicipal ? " " + submunicipal : ""}`, sido: "경기도", sigungu: "구리시", submunicipal });

  it("시·군·구 단위로만 걸리면 이름만 적고 괄호를 열지 않는다", () => {
    const text = formatShuttleFact(
      [bus({ title: "1호차", runDirection: "구리 · 수택 · 다산 방면" })],
      [구리시(null), 구리시("갈매동"), 구리시("교문동"), 구리시("사노동")],
    );
    expect(text).toContain("구리시");
    expect(text).not.toContain("갈매동");
    expect(text).not.toContain("교문동");
    expect(text).not.toContain("사노동");
  });

  it("본문에 직접 등장한 동만 괄호에 넣는다", () => {
    const text = formatShuttleFact(
      [bus({ title: "1호차", runDirection: "구리 방면", times: [{ time: "", runDirection: "수택동 정류장" }] })],
      [구리시(null), 구리시("수택동"), 구리시("갈매동")],
    );
    expect(text).toContain("구리시(수택동)");
    expect(text).not.toContain("갈매동");
  });
});
