import { describe, expect, it } from "vitest";
import { findChannel } from "../src/channels.ts";
import { distanceKm, regionCenter } from "../src/keywords/regions.ts";
import { limitNearbyClusters } from "../src/topics/planner.ts";
import {
  nearbyDirectStores,
  planRegion,
  type RegionalData,
  regionStoresLabel,
} from "../src/topics/regional.ts";

const training = findChannel("dztraining-blog")!;
const plus = findChannel("drivingplus-community")!;
const cafe = findChannel("drivingzone-cafe")!;

const data: RegionalData = {
  stores: [
    {
      name: "강남역점",
      type: "direct",
      address: "서울특별시 강남구 강남대로78길 24",
      lat: 37.5,
      lng: 127.03,
    },
    {
      name: "부산대점",
      type: "direct",
      address: "부산광역시 금정구 부산대학로 57",
      lat: 35.23,
      lng: 129.08,
    },
    {
      name: "광주상무점",
      type: "chain",
      address: "광주광역시 서구 상무중앙로 43",
      lat: 35.15,
      lng: 126.85,
    },
  ],
  academies: [
    { address: "서울특별시 서초구 과천대로 904-6" },
    { address: "부산광역시 기장군 1" },
    { address: "인천광역시 남동구 1" },
    { address: "대구광역시 수성구 1" },
    { address: "광주광역시 남구 1" },
  ],
  regionPoints: [
    { region: "서울특별시 강남구", lat: 37.5, lng: 127.05 },
    { region: "서울특별시 서초구", lat: 37.48, lng: 127.03 },
    { region: "부산광역시 금정구", lat: 35.24, lng: 129.09 },
    { region: "부산광역시 기장군", lat: 35.24, lng: 129.22 },
    { region: "인천광역시 남동구", lat: 37.45, lng: 126.73 },
    { region: "대구광역시 수성구", lat: 35.86, lng: 128.63 },
    { region: "광주광역시 서구", lat: 35.15, lng: 126.89 },
    { region: "광주광역시 남구", lat: 35.13, lng: 126.9 },
    { region: "충청북도 괴산군", lat: Number.NaN, lng: Number.NaN },
  ],
};

describe("지역 좌표", () => {
  it("직선거리를 km로 계산하고, 시도 키는 시군구 좌표의 평균을 쓴다", () => {
    // 서울시청 ↔ 부산시청 약 325km
    expect(
      Math.round(distanceKm({ lat: 37.5663, lng: 126.9779 }, { lat: 35.1798, lng: 129.075 })),
    ).toBe(325);
    expect(regionCenter(data.regionPoints, "부산광역시")).toEqual({ lat: 35.24, lng: 129.155 });
    expect(regionCenter(data.regionPoints, "충청북도 괴산군")).toBeUndefined();
  });
});

describe("planRegion", () => {
  it("채널의 지역 범위에 따라 지역 글 방식을 정한다", () => {
    expect(planRegion(training, "", data)).toBe("national");
    expect(planRegion(plus, "대구광역시 수성구")).toBe("local");
    expect(planRegion(cafe, "서울특별시 강남구", data)).toBe("skip");
    // 직영점이 있는 지역
    expect(planRegion(training, "서울특별시 강남구", data)).toBe("local");
    expect(planRegion(training, "부산광역시", data)).toBe("local");
    // 직영점 3km 안
    expect(planRegion(training, "서울특별시 서초구", data)).toBe("nearby");
    // 부산대점과 약 13km
    expect(planRegion(training, "부산광역시 기장군", data)).toBe("nearby");
    // 강남역점과 약 28km지만 같은 시도도 아니다
    expect(planRegion(training, "인천광역시 남동구", data)).toBe("skip");
    expect(planRegion(training, "대구광역시 수성구", data)).toBe("skip");
    // 가맹점만 있는 지역은 지점 안내 글, 그 옆 지역은 가맹점이 가까워도 가까운 직영점이 아니라 뺀다
    expect(planRegion(training, "광주광역시 서구", data)).toBe("local");
    expect(planRegion(training, "광주광역시 남구", data)).toBe("skip");
    // 학원이 없는 지역
    expect(planRegion(training, "충청북도 괴산군", data)).toBe("skip");
    // 자료가 없으면 판정을 미룬다
    expect(planRegion(training, "서울특별시 서초구")).toBeUndefined();
  });

  it("같은 시도면 25km 밖이어도 가까운 직영점으로 본다", () => {
    const far = {
      stores: [
        {
          name: "용인면허시험장점",
          type: "direct",
          address: "경기도 용인시 기흥구 1",
          lat: 37.27,
          lng: 127.11,
        },
      ],
      regionPoints: [{ region: "경기도 여주시", lat: 37.3, lng: 127.64 }],
    };
    const [hit] = nearbyDirectStores(training, "경기도 여주시", far);
    expect(hit?.store.name).toBe("용인면허시험장점");
    expect(Math.round(hit?.km ?? 0)).toBe(47);
    expect(
      nearbyDirectStores(
        { ...training, nearbyRegions: { maxKm: 25, sameSido: false, maxTopics: 20 } },
        "경기도 여주시",
        far,
      ),
    ).toEqual([]);
  });
});

describe("regionStoresLabel", () => {
  it("지점 지역은 직영·가맹 지점을, 가까운 직영점 지역은 지점과 거리를 보여 준다", () => {
    const label = (region: string) =>
      regionStoresLabel(training, region, planRegion(training, region, data), data);
    expect(label("서울특별시 강남구")).toBe("직영 강남역점");
    expect(label("광주광역시 서구")).toBe("가맹 광주상무점");
    expect(label("서울특별시 서초구")).toBe("가까운 직영 강남역점(약 2km)");
    expect(label("대구광역시 수성구")).toBe("");
    expect(regionStoresLabel(plus, "서울특별시 강남구", "local", data)).toBe("");
  });
});

describe("limitNearbyClusters", () => {
  const cluster = (keyword: string, region: string, intent: string, volume: number) => {
    const head = {
      keyword,
      pc: 0,
      mobile: volume,
      total: volume,
      competition: "중간",
      region,
      regionAlias: "",
      intent,
    } as never;
    return { head, members: [head], region, volume };
  };

  it("실차연수 전 준비 주제는 지역마다 합치고 상위 maxTopics 지역만 남긴다", () => {
    const out = limitNearbyClusters(
      [
        cluster("운전연수", "", "training", 9000),
        cluster("서초장롱면허연수", "서초", "pre_road", 500),
        cluster("서초운전연수", "서초", "pre_road", 3000),
        cluster("파주운전연수", "파주", "pre_road", 800),
        cluster("기장운전연수", "기장", "pre_road", 100),
      ],
      { ...training, nearbyRegions: { maxKm: 25, sameSido: true, maxTopics: 2 } },
    );
    expect(out.map((c) => [c.head.keyword, c.volume, c.members.length])).toEqual([
      ["운전연수", 9000, 1],
      ["서초운전연수", 3500, 2],
      ["파주운전연수", 800, 1],
    ]);
  });
});
