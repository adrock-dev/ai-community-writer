import type { AppConfig } from "../config.ts";
import type { Database } from "../db/database.ts";
import { cached, getData } from "../sources/http.ts";

// 키워드 속 지역명 찾기. "강남운전면허학원"과 "운전면허학원"은 다른 주제(지역 글)로 나눠야 하고,
// drivingplus 커뮤니티는 지역별 노출 대상 지정에도 쓴다.
// 지역 목록은 api.drive 공개 API `GET /v1/zipcode/search-seo?level=2`(시군구)에서 받는다.

export interface RegionEntry {
  /** 키워드에서 찾을 이름 (예: 강남, 강남구, 서귀포) */
  alias: string;
  /** 정식 지역명 (예: 서울특별시 강남구). 같은 별칭이 여러 곳이면 모두. */
  regions: string[];
}

const SIDO_SHORT: Record<string, string> = {
  서울특별시: "서울",
  부산광역시: "부산",
  대구광역시: "대구",
  인천광역시: "인천",
  광주광역시: "광주",
  대전광역시: "대전",
  울산광역시: "울산",
  세종특별자치시: "세종",
  경기도: "경기",
  강원특별자치도: "강원",
  충청북도: "충북",
  충청남도: "충남",
  전북특별자치도: "전북",
  전라남도: "전남",
  경상북도: "경북",
  경상남도: "경남",
  제주특별자치도: "제주",
};

/** 운전 분야에서 일반 단어로 더 많이 쓰여 지역으로 보면 안 되는 별칭. */
const STOP_ALIASES = new Set(["연수", "장수", "완주", "중구", "동구", "서구", "남구", "북구"]);

function aliasesOf(name: string): string[] {
  const out = [name];
  const short = name.replace(/(특별자치시|특별자치도|특별시|광역시|시|군|구)$/, "");
  if (short !== name) out.push(short);
  // 일산동구 → 일산, 해운대구 → 해운대
  const m = /^(.{2,})(동|서|남|북)구$/.exec(name);
  if (m?.[1]) out.push(m[1]);
  return out;
}

/** "서울특별시 강남구", "충청북도 청주시 흥덕구" 같은 지역명 목록으로 별칭 사전을 만든다. */
export function buildRegionIndex(regionNames: string[]): RegionEntry[] {
  const map = new Map<string, Set<string>>();
  const add = (alias: string, region: string) => {
    if (alias.length < 2 || STOP_ALIASES.has(alias)) return;
    if (!map.has(alias)) map.set(alias, new Set());
    map.get(alias)!.add(region);
  };
  for (const full of regionNames) {
    const parts = full.trim().split(/\s+/);
    const sido = parts[0] ?? "";
    add(sido, sido);
    const short = SIDO_SHORT[sido];
    if (short) add(short, sido);
    for (const part of parts.slice(1)) for (const a of aliasesOf(part)) add(a, full);
  }
  // 긴 별칭부터 맞춰야 "서귀포"가 "서귀"보다, "강남구"가 "강남"보다 먼저 잡힌다.
  return [...map.entries()]
    .map(([alias, regions]) => ({ alias, regions: [...regions] }))
    .sort((a, b) => b.alias.length - a.alias.length);
}

export interface RegionMatch {
  alias: string;
  regions: string[];
}

/** 비교용 지역 키. 같은 곳을 가리키는 별칭(강남, 강남구)은 같은 키가 된다. */
export const regionKey = (m: RegionMatch | undefined) => (m ? m.regions.join("|") : "");

/**
 * 사람이 읽을 지역 이름. 같은 별칭이 여러 곳이면 공통 상위 지역(전주 → 전북특별자치도 전주시),
 * 공통 부분이 없으면 모두 나열한다(광주 → 광주광역시 / 경기도 광주시).
 */
export function regionLabel(key: string): string {
  const regions = key.split("|").filter(Boolean);
  if (regions.length <= 1) return regions[0] ?? "";
  const split = regions.map((r) => r.split(" "));
  const common: string[] = [];
  for (let i = 0; i < split[0]!.length; i++) {
    const word = split[0]![i];
    if (split.every((parts) => parts[i] === word)) common.push(word!);
    else break;
  }
  return common.length >= 2 ? common.join(" ") : regions.join(" / ");
}

/**
 * 키워드에서 지역 별칭을 찾는다. 시군구가 시도보다 우선하고("서울강남…" → 강남),
 * 그다음 앞쪽에 있는 것, 그다음 긴 것을 고른다.
 */
export function detectRegion(keyword: string, index: RegionEntry[]): RegionMatch | undefined {
  const k = keyword.replace(/\s+/g, "");
  let best: { entry: RegionEntry; pos: number; local: boolean } | undefined;
  for (const entry of index) {
    const pos = k.indexOf(entry.alias);
    if (pos < 0) continue;
    const local = entry.regions.some((r) => r.includes(" "));
    const better =
      !best ||
      (local && !best.local) ||
      (local === best.local &&
        (pos < best.pos || (pos === best.pos && entry.alias.length > best.entry.alias.length)));
    if (better) best = { entry, pos, local };
  }
  return best && { alias: best.entry.alias, regions: best.entry.regions };
}

export async function loadRegionIndex(
  db: Database,
  sources: AppConfig["sources"],
): Promise<RegionEntry[]> {
  const url = `${sources.drivingplusApi}/v1/zipcode/search-seo?level=2`;
  const { value } = await cached(
    db,
    `drivingplus:regions:${sources.drivingplusApi}`,
    7 * 86_400_000,
    async () => {
      const rows = await getData<{ region?: string }[]>(url, sources.timeoutSec);
      return rows.map((r) => String(r.region ?? "")).filter(Boolean);
    },
  );
  return buildRegionIndex(value);
}
