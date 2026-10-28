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
//   local    그 지역 자료로 쓰는 지역 글 (운전면허PLUS 전 지역, 연수 블로그 직영점 지역)
//   nearby   직영점은 없지만 가까운 직영점이 있는 지역 → "실차연수 전 준비"(pre_road) 글
//   skip     이 채널이 쓰지 않는 지역
//   national 지역 없는 글

export type RegionPlan = "national" | "local" | "nearby" | "skip";

/** 실차연수 전 준비 글이 쓰는 글 유형. 키워드가 아니라 지역 판정으로 정한다. */
export const NEARBY_REGION_TYPE = "pre_road" as const;

/** 지역 판정에 쓰는 원천 자료. 학원은 운전학원(전문·일반)만 넘긴다(drivingAcademies). */
export interface RegionalData {
  directStores: { name: string; address: string; lat: number | null; lng: number | null }[];
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
  if (data.directStores.some((s) => inRegion(s.address, region))) return "local";
  if (!channel.nearbyRegions) return "skip";
  if (!data.academies.some((a) => inRegion(a.address, region))) return "skip";
  return nearbyDirectStores(channel, region, data).length ? "nearby" : "skip";
}

/**
 * 지역 밖의 가까운 직영점(가까운 순). 지역 중심에서 maxKm 이내이거나, sameSido 면 같은 시도의 직영점.
 * km 은 지역 중심에서 지점까지 직선거리(좌표가 없으면 undefined).
 */
export function nearbyDirectStores<S extends RegionalData["directStores"][number]>(
  channel: ChannelDef,
  region: string,
  data: { directStores: S[]; regionPoints: RegionPoint[] },
): { store: S; km: number | undefined }[] {
  const rule = channel.nearbyRegions;
  if (!rule) return [];
  const center = regionCenter(data.regionPoints, region);
  const sidos = regionSidos(region);
  return data.directStores
    .filter((s) => !inRegion(s.address, region))
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
