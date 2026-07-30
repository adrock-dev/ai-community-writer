import { describe, expect, it } from "vitest";
import { formatShuttleFact, hasShuttleDetail, SHUTTLE_NO_DETAIL_FACT, type RegionDirectoryEntry } from "../src/drivingplus-shuttle-facts.js";

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

describe("사전의 복합 토큰(구를 둔 일반시)", () => {
  // db.service.ts 가 region 을 공백으로 쪼개 3번째 조각부터 이어 붙이므로
  // "충청남도 천안시 서북구 두정동" → submunicipal "서북구 두정동" 이 된다.
  // 정류장명에는 "두정동"만 적히므로 복합형 그대로 대조하면 영원히 안 걸린다.
  const 천안두정: RegionDirectoryEntry = { region: "충청남도 천안시 서북구 두정동", sido: "충청남도", sigungu: "천안시", submunicipal: "서북구 두정동" };
  const 천안원성: RegionDirectoryEntry = { region: "충청남도 천안시 동남구 원성동", sido: "충청남도", sigungu: "천안시", submunicipal: "동남구 원성동" };

  it("복합 토큰의 동 이름으로 매칭한다", () => {
    const text = formatShuttleFact(
      [bus({ title: "1호차", times: [{ time: "", runDirection: "두정동" }, { time: "5분", runDirection: "원성동" }] })],
      [천안두정, 천안원성],
    );
    expect(text).toContain("운행 지역(자료 기준) 천안시(두정동·원성동)");
  });

  it("표기에도 구 접두사를 남기지 않는다", () => {
    const text = formatShuttleFact([bus({ title: "1호차", times: [{ time: "", runDirection: "두정동 우체국" }] })], [천안두정]);
    expect(text).not.toContain("서북구");
  });

  it("구 이름만 있는 행은 그대로 쓴다", () => {
    const 동남구: RegionDirectoryEntry = { region: "충청남도 천안시 동남구", sido: "충청남도", sigungu: "천안시", submunicipal: "동남구" };
    const text = formatShuttleFact([bus({ title: "1호차", times: [{ time: "", runDirection: "동남구 방면" }] })], [동남구]);
    expect(text).toContain("천안시(동남구)");
  });

  it("더 긴 지명의 꼬리를 잘라 읽지 않는다", () => {
    // 실제 오탐: "오산 방면(세교동·청호동)" 한 줄이 수원시 교동(세교동)과
    // 용인시 호동(청호동)으로 잡혔다. 앞에 한글이 붙으면 지명의 시작이 아니다.
    const 수원교동: RegionDirectoryEntry = { region: "경기도 수원시 팔달구 교동", sido: "경기도", sigungu: "수원시", submunicipal: "팔달구 교동" };
    const text = formatShuttleFact([bus({ title: "3호차", runDirection: "오산 방면(세교동·청호동)" })], [수원교동]);
    expect(text).not.toContain("수원시");
  });

  it("지명 뒤에 말이 이어붙는 것은 정상 매칭이다", () => {
    // 강릉 교동은 정류장 안내에 "교동시가지"로만 등장한다. 뒤를 막으면 이 매칭이 사라진다.
    const 강릉교동: RegionDirectoryEntry = { region: "강원특별자치도 강릉시 교동", sido: "강원특별자치도", sigungu: "강릉시", submunicipal: "교동" };
    const text = formatShuttleFact([bus({ title: "1호차", times: [{ time: "", runDirection: "교동시가지" }] })], [강릉교동]);
    expect(text).toContain("강릉시(교동)");
  });
});

describe("운행 지역과 경유지를 함께 내지 않는다", () => {
  // 실제 발행 사고: "원주시 개운동·단계동·단구동·명륜동 등을 운행 지역으로 안내하고,
  // 명륜동·개운동·구곡택지·봉산동 등을 경유지로 제시하고" — 운행 지역이 정류장 텍스트에서
  // 파생되므로 둘을 함께 내면 같은 사실이 두 번 실린다.
  const 원주 = (submunicipal: string): RegionDirectoryEntry =>
    ({ region: `강원특별자치도 원주시 ${submunicipal}`, sido: "강원특별자치도", sigungu: "원주시", submunicipal });

  it("운행 지역이 잡히면 경유지를 넣지 않는다", () => {
    const text = formatShuttleFact(
      [bus({ title: "1호차", times: [{ time: "", runDirection: "명륜동" }, { time: "5분", runDirection: "개운동" }] })],
      [원주("명륜동"), 원주("개운동")],
    );
    expect(text).toContain("운행 지역(자료 기준) 원주시(명륜동·개운동)");
    expect(text).not.toContain("경유지");
  });

  it("노선명으로만 지역이 잡힌 경우에도 경유지를 넣지 않는다", () => {
    const text = formatShuttleFact([bus({ title: "안산 전지역", times: [{ time: "", runDirection: "고잔역" }] })], []);
    expect(text).toContain("운행 지역(자료 기준) 안산 전지역");
    expect(text).not.toContain("경유지");
  });

  it("운행 지역이 비면 경유지가 셔틀 정보를 대신한다", () => {
    // 반경 25km 밖에서 태워 오는 원거리 픽업은 사전 대조가 구조적으로 닿지 못한다.
    const text = formatShuttleFact([bus({ title: "1호차", times: [
      { time: "", runDirection: "삼성역(무역센터)1번출구" }, { time: "10분", runDirection: "잠실새내역1번출구" },
    ] })], []);
    expect(text).toContain("경유지 삼성역(무역센터)1번출구, 잠실새내역1번출구 등");
  });
});

describe("경유지는 생활권·랜드마크·지역 정보여야 한다", () => {
  const stops = (...names: string[]) =>
    formatShuttleFact([bus({ title: "1호차", times: names.map((runDirection) => ({ time: "", runDirection })) })], []);

  it("시각표·번호·라틴 약어는 지점이 아니다", () => {
    // 원천 정류장 필드에 실제로 섞여 있던 값들이다.
    for (const junk of ["06:50 09:40 12:40 15:40", "3", "2", "BYC", "NC", "3지구", "6단지", "4출구)"]) {
      expect(stops(junk, "마석역")).not.toContain(junk);
    }
  });

  it("학원 출발지 표기는 경유지가 아니다", () => {
    for (const origin of ["성문학원 출발", "부산대성학원출발"]) {
      expect(stops(origin, "마석역")).not.toContain(origin);
    }
  });

  it("두 글자 지명과 번호가 붙은 실제 지점은 남긴다", () => {
    expect(stops("학동")).toContain("학동");
    expect(stops("3호선 대화역 6번출구")).toContain("3호선 대화역 6번출구");
    expect(stops("구곡택지")).toContain("구곡택지");
  });

  it("쓸 만한 지점이 하나도 없으면 경유지 자체를 내지 않는다", () => {
    expect(stops("06:50 09:40", "BYC", "3")).toBe("셔틀 운행(세부 정보는 자료에 없음)");
  });
});

describe("프롬프트에 넣을 값인지 판정", () => {
  // "셔틀이 있다"는 내부 신호일 뿐이라 값 자리에 들어가면
  // `- **셔틀 운행 지역:** 셔틀 운행` 같은 빈 불릿이 실린다(실측 6곳).
  it("지역·경유지·이용 조건이 없는 값은 내용이 없다고 본다", () => {
    expect(hasShuttleDetail(SHUTTLE_NO_DETAIL_FACT)).toBe(false);
    expect(hasShuttleDetail(formatShuttleFact([bus({ title: "1호차" })], []))).toBe(false);
  });

  it("빈 값도 내용이 없다고 본다", () => {
    for (const empty of [null, undefined, "", "   "]) expect(hasShuttleDetail(empty)).toBe(false);
  });

  it("운행 지역·경유지·이용 조건 중 하나라도 있으면 내용이 있다고 본다", () => {
    const 목포시: RegionDirectoryEntry = { region: "전라남도 목포시", sido: "전라남도", sigungu: "목포시", submunicipal: null };
    expect(hasShuttleDetail(formatShuttleFact([bus({ title: "목포 전지역" })], [목포시]))).toBe(true);
    expect(hasShuttleDetail(formatShuttleFact([bus({ title: "1호차", times: [{ time: "", runDirection: "마석역" }] })], []))).toBe(true);
    expect(hasShuttleDetail(formatShuttleFact([bus({ title: "1호차", content: "이용 1시간 전에 미리 연락 주세요" })], []))).toBe(true);
  });
});

describe("운영 라벨 배제", () => {
  it("차량번호·일반 라벨은 지역으로 쓰지 않는다", () => {
    for (const label of ["1호차", "3호차", "셔틀버스", "셔틀노선", "노선", "버스문의", "기타"]) {
      const text = formatShuttleFact([bus({ title: label })], []);
      expect(text).toBe("셔틀 운행(세부 정보는 자료에 없음)");
    }
  });

  it("앞에 다른 글자가 붙은 운영 라벨도 지역으로 쓰지 않는다", () => {
    // 실측: "학원셔틀"·"토요일"·"GTX-A 킨텍스"가 운행 지역으로 실려
    // 글에 `- **셔틀 운행 지역:** 학원셔틀` 로 나갔다(3곳).
    for (const label of ["학원셔틀", "토요일", "GTX-A 킨텍스"]) {
      expect(formatShuttleFact([bus({ title: label })], [])).toBe("셔틀 운행(세부 정보는 자료에 없음)");
    }
  });

  it("학원이 적은 운행 범위 표기는 그대로 인정한다", () => {
    for (const label of ["광주 전지역", "옥계방면", "시내방면", "안산시 일대"]) {
      expect(formatShuttleFact([bus({ title: label })], [])).toContain(label);
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

  it("출발지 표기는 경유지 목록에 넣지 않는다", () => {
    const text = formatShuttleFact([bus({ title: "1호차", times: [{ time: "", runDirection: "학원출발" }, { time: "7분", runDirection: "마석역" }] })], []);
    expect(text).toContain("경유지 마석역 등");
    expect(text).not.toContain("학원출발");
  });

  it("경유지 총 개수는 내보내지 않는다", () => {
    // 개수를 주면 학원끼리 수강료·과정이 비슷한 지역에서 모델이 그걸 강점으로 집는다.
    const text = formatShuttleFact([bus({ title: "1호차", times: [
      { time: "", runDirection: "마석역" }, { time: "", runDirection: "평내호평역" },
      { time: "", runDirection: "금곡역" }, { time: "", runDirection: "도농역" }, { time: "", runDirection: "구리역" },
    ] })], []);
    expect(text).toContain("등");
    expect(text).not.toMatch(/\d+\s*곳/u);
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
