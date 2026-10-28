import type { ChannelDef } from "../channels.ts";
import {
  distanceKm,
  inRegion,
  normalizeAddress,
  type RegionPoint,
  regionCenter,
  regionSidos,
} from "../keywords/regions.ts";

// 지역 글을 이 채널에서 어떻게 쓸지 정한다. 수집(주제 만들기)과 근거 자료(지점 고르기)가 같은 규칙을 쓴다.
//   local    그 지역 자료로 쓰는 지역 글 (운전면허PLUS 전 지역, 연수 블로그 지점(직영·가맹) 지역)
//   nearby   직영점은 없지만 가까운 직영점이 있는 지역 → "실차연수 전 준비"(pre_road) 글
//   skip     이 채널이 쓰지 않는 지역
//   national 지역 없는 글

export type RegionPlan = "national" | "local" | "nearby" | "skip";

/** 실차연수 전 준비 글이 쓰는 글 유형. 키워드가 아니라 지역 판정으로 정한다. */
export const NEARBY_REGION_TYPE = "pre_road" as const;

/** 드라이빙존 지점 중 지역 판정에 쓰는 값. type: direct(직영) / chain(가맹) */
export interface StorePoint {
  name: string;
  type: string;
  address: string;
  lat: number | null;
  lng: number | null;
}

/** 지역 판정에 쓰는 원천 자료. 지점은 직영·가맹 모두, 학원은 운전학원(전문·일반)만(drivingAcademies). */
export interface RegionalData {
  stores: StorePoint[];
  academies: { address: string }[];
  regionPoints: RegionPoint[];
}

/** 지역 글에 "이 지역 운전학원"으로 쓰는 학원 유형. 실내연습장·시험장 코스는 뺀다. */
const DRIVING_ACADEMY_TYPES = new Set(["academy", "exam_academy"]);

export const drivingAcademies = <T extends { type: string }>(academies: T[]): T[] =>
  academies.filter((a) => DRIVING_ACADEMY_TYPES.has(a.type));

/**
 * 이 채널이 이 지역 글을 어떻게 쓰는가. 직영점 지역만 쓰는 채널인데 자료가 없으면(지점 조회 실패)
 * undefined — 판정을 미룬다.
 */
export function planRegion(
  channel: ChannelDef,
  region: string,
  data?: RegionalData,
): RegionPlan | undefined {
  if (!region) return "national";
  if (channel.regional === "all") return "local";
  if (channel.regional === "none") return "skip";
  if (!data) return undefined;
  // 그 지역에 지점이 있으면 가맹점이어도 지점 안내 글을 쓴다(2026-10-28 결정).
  if (data.stores.some((s) => inRegion(s.address, region))) return "local";
  if (!channel.nearbyRegions) return "skip";
  if (!data.academies.some((a) => inRegion(a.address, region))) return "skip";
  return nearbyDirectStores(channel, region, data).length ? "nearby" : "skip";
}

/**
 * 지역 밖의 가까운 직영점(가까운 순). 지역 중심에서 maxKm 이내이거나, sameSido 면 같은 시도의 직영점.
 * 가맹점은 먼 지역까지 안내하지 않는다(그 지역에 있을 때만 지점 안내 글에 쓴다).
 * km 은 지역 중심에서 지점까지 직선거리(좌표가 없으면 undefined).
 */
export function nearbyDirectStores<S extends StorePoint>(
  channel: ChannelDef,
  region: string,
  data: { stores: S[]; regionPoints: RegionPoint[] },
): { store: S; km: number | undefined }[] {
  const rule = channel.nearbyRegions;
  if (!rule) return [];
  const center = regionCenter(data.regionPoints, region);
  const sidos = regionSidos(region);
  return data.stores
    .filter((s) => s.type === "direct" && !inRegion(s.address, region))
    .map((store) => ({
      store,
      km:
        center && store.lat !== null && store.lng !== null
          ? distanceKm(center, { lat: store.lat, lng: store.lng })
          : undefined,
    }))
    .filter(
      ({ store, km }) =>
        (km !== undefined && km <= rule.maxKm) ||
        (rule.sameSido && sidos.some((d) => normalizeAddress(store.address).startsWith(d))),
    )
    .sort((a, b) => (a.km ?? Number.POSITIVE_INFINITY) - (b.km ?? Number.POSITIVE_INFINITY));
}

/**
 * 주제 목록에 보여 줄 지역 지점 표시. 운영자가 직영점 지역인지 가맹점 지역인지 보고 고르게 한다.
 *   local  → "직영 강남역점·강남면허시험장점 · 가맹 홍대역점"
 *   nearby → "가까운 직영 잠실학원사거리점(약 10km)"
 */
export function regionStoresLabel(
  channel: ChannelDef,
  region: string,
  plan: RegionPlan | undefined,
  data?: RegionalData,
): string {
  if (!data || !region || channel.regional !== "direct-stores") return "";
  if (plan === "local") {
    const here = data.stores.filter((s) => inRegion(s.address, region));
    const names = (type: string) =>
      here
        .filter((s) => s.type === type)
        .map((s) => s.name)
        .join("·");
    return [
      names("direct") && `직영 ${names("direct")}`,
      names("chain") && `가맹 ${names("chain")}`,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (plan === "nearby") {
    const [near] = nearbyDirectStores(channel, region, data);
    if (!near) return "";
    return `가까운 직영 ${near.store.name}${near.km === undefined ? "" : `(약 ${Math.round(near.km)}km)`}`;
  }
  return "";
}
