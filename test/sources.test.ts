import { describe, expect, it } from "vitest";
import { Database } from "../src/db/database.ts";
import { normalizeAcademy } from "../src/sources/drivingplus.ts";
import { normalizeStore } from "../src/sources/drivingzone.ts";
import { cached } from "../src/sources/http.ts";

describe("normalizeAcademy", () => {
  const raw = {
    id: 2,
    title: "예시자동차운전학원",
    type: "exam_academy",
    seoContent: "우리가 쓴 홍보 문구",
    roadAddress: "제주특별자치도 서귀포시 예시로 21",
    phone: "064-000-0000",
    vphone: "0507-0000-0000",
    roadLatitude: 33.2,
    roadLongitude: 126.2,
    licenseTypes: [{ code: "type1_normal_auto", label: "1종 보통 자동" }],
    priceObservations: [
      {
        amount: 627000,
        confidence: "high",
        rawLabel: "1종보통 신규",
        licenseType: "1종 보통",
        courseType: "license_acquisition",
        vatIncluded: true,
        examFeeIncluded: false,
        source: "homepage",
        collectedAt: "2026-07-14T06:03:58.000Z",
      },
      { amount: 1, confidence: "low", rawLabel: "불확실" },
    ],
    educationPerformance: {
      year: 2026,
      quarter: 2,
      fees: {
        type1Manual: 712000,
        type1Auto: null,
        type2Auto: 712000,
        vatIncluded: false,
        examFeeIncluded: true,
      },
      capacity: 140,
      graduates: 498,
    },
    operateHour: {
      monOpenTime: "06:00",
      monCloseTime: "22:00",
      monIsHoliday: false,
      sunIsHoliday: true,
      notice: "명절 휴무",
    },
    shuttleBuses: [{ title: "서귀포", runDirection: "시내 방면", content: "전화 문의" }],
    reviews: [{ point: 5, content: "친절해요", date: "2025-08-29" }, { content: "  " }],
    photos: ["https://file.example/1.jpg"],
    roadCourses: [{ title: "도로주행A" }],
  };

  it("근거로 쓸 필드만 정규화하고 홍보 문구·낮은 신뢰도 가격은 뺀다", () => {
    const a = normalizeAcademy(raw)!;
    expect(a).toMatchObject({
      id: 2,
      name: "예시자동차운전학원",
      phone: "0507-0000-0000",
      licenseTypes: ["1종 보통 자동"],
      hours: ["월 06:00~22:00", "일 휴무"],
      hoursNotice: "명절 휴무",
      officialFees: { period: "2026년 2분기", type1Manual: 712000, type1Auto: null },
      roadCourses: ["도로주행A"],
    });
    expect(a.prices).toHaveLength(1);
    expect(a.reviews).toEqual([{ point: 5, content: "친절해요", date: "2025-08-29" }]);
    expect(JSON.stringify(a)).not.toContain("홍보 문구");
  });

  it("id나 이름이 없으면 버린다", () => {
    expect(normalizeAcademy({ id: 1 })).toBeUndefined();
  });
});

describe("normalizeStore", () => {
  const raw = {
    id: 70,
    name: "예시점",
    type: "direct",
    status: "enable",
    roadAddress: "서울특별시 강남구 예시로 26, 2층",
    summaryAddress: "예시역 1번 출구에서 422m",
    phoneNumber: "1644-0000",
    naverUrl: "https%3A%2F%2Fmap.naver.com%2Fp%2Fentry%2Fplace%2F1",
    passRate: "0.00",
    averageDurationDays: "3.5",
    ownerName: "홍길동",
    smsReceivers: "010-1111-2222",
    businessRegistrationNumber: "000-00-00000",
    email: "owner@example.com",
    keywordTags: "직영점,일요일 오픈",
    weeklyHours: [{ dayOfWeek: "MON", openTime: "09:00:00", closeTime: "21:00:00" }],
    instructors: [
      {
        name: "김강사",
        position: "과장",
        intro: "차근차근",
        licenses: "1종 보통\n1종 대형",
        isExaminerCertified: 1,
      },
    ],
    reviews: [
      {
        reviewText: "좋았어요",
        isLicense: 1,
        isTraining: 0,
        createdAt: "2025-06-17T08:37:07.000Z",
      },
    ],
    photoPaths: ["https://file.example/a.jpg"],
  };

  it("비공개 정보(대표자·SMS 번호·사업자번호·이메일·강사 이름)를 옮기지 않는다", () => {
    const json = JSON.stringify(normalizeStore(raw));
    for (const secret of [
      "홍길동",
      "010-1111-2222",
      "000-00-00000",
      "owner@example.com",
      "김강사",
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it("0인 통계는 미집계(null)로, URL은 디코딩한다", () => {
    const s = normalizeStore(raw)!;
    expect(s.passRate).toBeNull();
    expect(s.averageDurationDays).toBe(3.5);
    expect(s.naverUrl).toBe("https://map.naver.com/p/entry/place/1");
    expect(s.hours).toEqual(["월 09:00~21:00"]);
    expect(s.keywordTags).toEqual(["직영점", "일요일 오픈"]);
    expect(s.instructors[0]).toEqual({
      position: "과장",
      intro: "차근차근",
      licenses: ["1종 보통", "1종 대형"],
      certifications: ["기능검정원"],
    });
  });

  it("비활성 지점은 버린다", () => {
    expect(normalizeStore({ ...raw, status: "disable" })).toBeUndefined();
  });
});

describe("cached", () => {
  it("TTL 안에서는 다시 받지 않고, 갱신 실패 시 오래된 캐시를 돌려준다", async () => {
    const db = new Database(":memory:");
    const t0 = new Date("2026-09-28T00:00:00Z");
    let loads = 0;
    const load = async () => ++loads;
    expect((await cached(db, "k", 60_000, load, t0)).value).toBe(1);
    expect((await cached(db, "k", 60_000, load, new Date(t0.getTime() + 30_000))).value).toBe(1);
    const stale = await cached(
      db,
      "k",
      60_000,
      async () => {
        throw new Error("timeout");
      },
      new Date(t0.getTime() + 120_000),
    );
    expect(stale).toMatchObject({ value: 1, staleReason: "timeout" });
    expect(loads).toBe(1);
  });
});
