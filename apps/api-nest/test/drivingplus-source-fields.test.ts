import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeAcademy } from "../src/drivingplus-api.service.js";

/**
 * 원천(DrivingPlus) 응답 필드가 조용히 버려지지 않는지 잠그는 테스트.
 *
 * 파이프라인이 두 번 좁혀진다: normalizeAcademy 가 모르는 필드를 떨어뜨리고,
 * upsertDrivingplusAcademies 가 컬럼/extra 에 담지 않은 값을 떨어뜨린다.
 * 한쪽만 고치면 "가져오는데 저장은 안 되는" 상태가 되므로 양쪽을 함께 확인한다.
 *
 * dev endpoint 에서 실제로 관측한 전체 필드 집합을 표본으로 쓴다(운영 endpoint 는 부분집합).
 */

// dev endpoint 응답 1건의 형태(값은 축약, 키는 실제 관측 그대로).
const SOURCE_ROW = {
  id: 4242,
  title: "테스트자동차운전전문학원",
  seoTitle: "테스트학원 | 지역 운전면허학원",
  seoKeywords: "테스트학원, 지역운전학원",
  seoDescription: "테스트학원 소개 요약",
  seoContent: "테스트자동차운전전문학원은 지역에 위치한 운전면허학원입니다. 장내기능과 도로주행 코스를 운영합니다.",
  roadAddress: "경기도 수원시 영통구 테스트로 1",
  phone: "031-000-0000",
  vphone: "0507-0000-0000",
  roadLatitude: 37.25,
  roadLongitude: 127.05,
  thumbSavePath: "https://example.test/thumb.jpg",
  type: "academy",
  photos: ["https://example.test/1.jpg"],
  reviews: [{ id: 1, point: 5, author: "익명", date: "2026-01-02", content: "강사님이 친절하게 설명해 주셔서 편하게 배웠습니다.", images: [], numLike: 2 }],
  licenseTypes: [{ code: "type1_normal_auto", label: "1종 보통 자동" }],
  educationPerformance: {
    year: 2026, quarter: 1, capacity: 80, graduates: 481, injuryAccidents: 2, accidentRate: 0.0042,
    fees: { type1Manual: 712000, type1Auto: 824000, type2Auto: 712000, vatIncluded: false, examFeeIncluded: true },
  },
  priceObservations: [{
    source: "naver_place", sourceUrl: "https://m.place.naver.com/place/17025735/price",
    licenseType: "1종 보통", courseType: "license_acquisition", gearType: null, applicantType: null,
    priceUnit: "course", priceKind: "fixed", amount: 627000, amountMax: null, amountVatIncluded: 627000,
    vatIncluded: true, vatFlagSource: "declared", examFeeIncluded: false,
    rawLabel: "1종보통 신규(검정료 미포함)", confidence: "high", collectedAt: "2026-07-14T06:03:58.000Z",
  }],
  shuttleBuses: [{
    title: "수원 전지역", runDirection: "학원출발", content: "예약 시 운행", footContent: "* 일요일 미운행",
    phone: "031-000-0001", backgroundColor: "fa9e25", times: [{ time: "07:00", runDirection: "학원출발" }],
  }],
  shuttleBusUrl: "https://example.test/shuttle",
  shuttleBusDetail: "집 앞으로 셔틀이 찾아갑니다",
  shuttleBusImageUrl: "https://example.test/shuttle.jpg",
  operateHour: {
    monOpenTime: "06:00", monCloseTime: "22:00", monIsHoliday: false,
    tueOpenTime: "06:00", tueCloseTime: "22:00", tueIsHoliday: false,
    wedOpenTime: "06:00", wedCloseTime: "22:00", wedIsHoliday: false,
    thuOpenTime: "06:00", thuCloseTime: "22:00", thuIsHoliday: false,
    friOpenTime: "06:00", friCloseTime: "22:00", friIsHoliday: false,
    satOpenTime: "06:00", satCloseTime: "22:00", satIsHoliday: false,
    sunOpenTime: "06:00", sunCloseTime: "22:00", sunIsHoliday: false,
    holidayOpenTime: "10:00", holidayCloseTime: "15:00", notice: "연중무휴",
  },
  roadCourses: [{ title: "도로주행A", subtitle: "", content: "A코스 설명", imageUrl: "https://example.test/course.jpg", youtubeVideoId: "abc123", difficulty: null }],
};

describe("normalizeAcademy 필드 보존", () => {
  it("원천 응답의 최상위 키를 하나도 버리지 않는다", () => {
    const normalized = normalizeAcademy(SOURCE_ROW);
    expect(normalized).toBeTruthy();
    // 원천 키 → 내부 키 매핑(이름이 바뀌는 것만 명시).
    const renamed: Record<string, keyof NonNullable<typeof normalized>> = {};
    for (const key of Object.keys(SOURCE_ROW)) {
      const target = renamed[key] ?? (key as keyof NonNullable<typeof normalized>);
      expect(normalized, `원천 필드 ${key} 가 유실됐다`).toHaveProperty(target);
    }
  });

  it("중첩 구조의 신규 필드(shuttleBuses.backgroundColor, roadCourses.difficulty, reviews.numLike)를 유지한다", () => {
    const normalized = normalizeAcademy(SOURCE_ROW)!;
    expect(normalized.shuttleBuses?.[0]?.backgroundColor).toBe("fa9e25");
    expect(normalized.roadCourses?.[0]).toHaveProperty("difficulty");
    expect(normalized.reviews?.[0]?.numLike).toBe(2);
    expect(normalized.reviews?.[0]?.images).toEqual([]);
  });
});

describe("upsertDrivingplusAcademies 저장 범위", () => {
  let db: import("../src/db.service.js").DbService;
  let tmp: string;
  const domain = "source-fields.test";

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), "source-fields-"));
    process.env.SEO_DB_PATH = join(tmp, "test.db");
    const { DbService } = await import("../src/db.service.js");
    db = new DbService();
    db.init();
    db.createDomain({ domain, display_name: "source fields", vertical: "driving" });
  });

  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  function stored() {
    const normalized = normalizeAcademy(SOURCE_ROW)!;
    db.upsertDrivingplusAcademies(domain, [{
      ...normalized,
      reviewStats: { totalCount: 261, averagePoint: 4.6, sourceCount: 5 },
      blogReviewStats: { searchTotalCount: 1297, sourceCount: 5 },
    }] as never);
    const row = db.get("SELECT * FROM academies WHERE domain=? AND external_id=?", [domain, "4242"])!;
    return { row, extra: JSON.parse(String(row.extra || "{}")) };
  }

  it("원천 소개 본문을 seo_content 컬럼에 보관한다", () => {
    const { row } = stored();
    expect(String(row.seo_content)).toContain("장내기능과 도로주행");
  });

  it("셔틀 안내 필드와 리뷰 집계를 extra 에 보관한다", () => {
    const { extra } = stored();
    expect(extra.shuttle_bus_url).toBe("https://example.test/shuttle");
    expect(extra.shuttle_bus_detail).toBe("집 앞으로 셔틀이 찾아갑니다");
    expect(extra.shuttle_bus_image_url).toBe("https://example.test/shuttle.jpg");
    expect(extra.review_stats).toMatchObject({ totalCount: 261, averagePoint: 4.6 });
    expect(extra.blog_review_stats).toMatchObject({ searchTotalCount: 1297 });
  });

  it("가격 관측치를 원문 그대로(수집 출처 URL 포함) 보관한다", () => {
    const { extra } = stored();
    expect(extra.price_observations[0]).toMatchObject({
      source: "naver_place",
      sourceUrl: "https://m.place.naver.com/place/17025735/price",
      amount: 627000,
    });
  });

  it("normalizeAcademy 가 넘긴 필드는 컬럼이나 extra 중 한 곳에는 남는다", () => {
    const { row, extra } = stored();
    const normalized = normalizeAcademy(SOURCE_ROW)!;
    // 내부 키 → 저장 위치(컬럼명 또는 extra 키).
    const placement: Record<string, string> = {
      id: "external_id", title: "name", seoTitle: "seo_title", seoKeywords: "seo_keywords",
      seoDescription: "seo_description", seoContent: "seo_content", roadAddress: "address",
      phone: "phone", vphone: "vphone", roadLatitude: "latitude", roadLongitude: "longitude",
      thumbSavePath: "thumb_url", type: "academy_type", photos: "photos", reviews: "review_json",
      licenseTypes: "extra.license_types", educationPerformance: "extra.education_performance",
      priceObservations: "extra.price_observations", shuttleBuses: "extra.shuttle_buses",
      shuttleBusUrl: "extra.shuttle_bus_url", shuttleBusDetail: "extra.shuttle_bus_detail",
      shuttleBusImageUrl: "extra.shuttle_bus_image_url", operateHour: "extra.operate_hour",
      roadCourses: "extra.road_courses",
    };
    for (const key of Object.keys(normalized)) {
      const target = placement[key];
      expect(target, `내부 필드 ${key} 의 저장 위치가 정의되지 않았다`).toBeTruthy();
      const value = target!.startsWith("extra.") ? extra[target!.slice(6)] : row[target!];
      expect(value, `내부 필드 ${key} 가 저장되지 않았다`).not.toBeUndefined();
      expect(value, `내부 필드 ${key} 가 비어 있다`).not.toBeNull();
    }
  });
});
