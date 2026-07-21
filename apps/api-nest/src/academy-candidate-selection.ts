import { ACADEMY_MIN_FOR_BEST, ACADEMY_MIN_GUARANTEE_MAX_KM, ACADEMY_NEARBY_MAX_KM } from "./constants.js";

type Row = Record<string, any>;

export type AcademySelectionDb = {
  listAcademies(domain: string, opts: { region?: string; academy_types?: string[]; limit?: number }): Row[];
  getSeoRegion(domain: string, region: string): Row | undefined;
};

export type CandidateRetrievalSource = "stored_region_like" | "supplement" | "far_guarantee";

export type AcademySelectionTraceCandidate = {
  academyId: string;
  academyName: string;
  storedRegion: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  straightLineDistanceKm: number | null;
  retrievalSource: CandidateRetrievalSource;
  inclusionReason: "region_like_query" | "stored_region_exact" | "address_contains_target" | "same_administrative_prefix" | "within_nearby_radius" | "within_far_guarantee";
  retrievalRank: number;
};

export type AcademySelectionTrace = {
  targetRegion: string;
  configuredMinimum: number;
  candidatePoolLimit: number;
  nearbyRadiusKm: number;
  farRadiusKm: number;
  regionLikeCandidates: AcademySelectionTraceCandidate[];
  supplementCandidates: AcademySelectionTraceCandidate[];
  farCandidates: AcademySelectionTraceCandidate[];
  duplicatesRemoved: Array<{ academyId: string; academyName: string; reason: "already_in_region_like" }>;
  excludedCandidates: Array<{ academyId: string; academyName: string; reason: "not_usable" }>;
  mergedCandidatePool: AcademySelectionTraceCandidate[];
};

export type AcademySelectionResult = { candidates: Row[]; trace: AcademySelectionTrace };

// WorkerService.buildFacts가 기존과 같은 slot-seed 표본을 쓰도록 공유한다.
export function seededCandidateSample<T>(items: T[], count: number, seed: string): T[] {
  if (items.length <= count) return items;
  const indexes = items.map((_, index) => index);
  const random = mulberry32(fnv1a(seed));
  for (let index = indexes.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    const current = indexes[index]!;
    indexes[index] = indexes[other]!;
    indexes[other] = current;
  }
  return indexes.slice(0, count).sort((left, right) => left - right).map((index) => items[index]!);
}

/**
 * WorkerService의 기존 지역 후보 선택 규칙을 한 곳에서 실행한다.
 * trace는 관찰용이며 후보 선택 조건, 정렬, 상수, 반환 Row를 바꾸지 않는다.
 */
export function selectAcademiesForRegion(
  db: AcademySelectionDb,
  domain: string,
  region: string,
  limit: number,
  academyTypes: string[] = [],
  minRequired: number = ACADEMY_MIN_FOR_BEST,
): AcademySelectionResult {
  const emptyTrace = (): AcademySelectionTrace => ({
    targetRegion: region,
    configuredMinimum: minRequired,
    candidatePoolLimit: limit,
    nearbyRadiusKm: ACADEMY_NEARBY_MAX_KM,
    farRadiusKm: ACADEMY_MIN_GUARANTEE_MAX_KM,
    regionLikeCandidates: [],
    supplementCandidates: [],
    farCandidates: [],
    duplicatesRemoved: [],
    excludedCandidates: [],
    mergedCandidatePool: [],
  });
  if (!academyTypes.length) return { candidates: [], trace: emptyTrace() };

  const trace = emptyTrace();
  const typeFilter = { academy_types: academyTypes };
  const keyOf = (academy: Row) => String(academy.external_id || academy.id || academy.name);
  const toTraceCandidate = (academy: Row, retrievalSource: CandidateRetrievalSource, inclusionReason: AcademySelectionTraceCandidate["inclusionReason"], retrievalRank: number, distanceKm: number | null = null): AcademySelectionTraceCandidate => ({
    academyId: keyOf(academy),
    academyName: String(academy.name || ""),
    storedRegion: String(academy.region || ""),
    address: String(academy.address || ""),
    latitude: finiteNumber(academy.latitude),
    longitude: finiteNumber(academy.longitude),
    straightLineDistanceKm: distanceKm,
    retrievalSource,
    inclusionReason,
    retrievalRank,
  });
  const markExcluded = (rows: Row[]) => rows.filter((academy) => !isUsableAcademy(academy)).map((academy) => ({
    academyId: keyOf(academy), academyName: String(academy.name || ""), reason: "not_usable" as const,
  }));

  const directRaw = db.listAcademies(domain, { region, ...typeFilter, limit: Math.max(limit * 3, 20) });
  trace.excludedCandidates.push(...markExcluded(directRaw));
  const direct = directRaw.filter(isUsableAcademy);
  if (direct.length >= limit) {
    const candidates = direct.slice(0, limit);
    trace.regionLikeCandidates = candidates.map((academy, index) => toTraceCandidate(academy, "stored_region_like", "region_like_query", index + 1));
    trace.mergedCandidatePool = [...trace.regionLikeCandidates];
    return { candidates, trace };
  }

  const allRaw = db.listAcademies(domain, { ...typeFilter, limit: 5000 });
  const directKeys = new Set(direct.map(keyOf));
  const seenExcluded = new Set(trace.excludedCandidates.map((candidate) => candidate.academyId));
  for (const excluded of markExcluded(allRaw)) if (!seenExcluded.has(excluded.academyId)) trace.excludedCandidates.push(excluded);
  const all = allRaw.filter(isUsableAcademy);
  const targetRegion = db.getSeoRegion(domain, region);
  const targetLat = finiteNumber(targetRegion?.latitude);
  const targetLng = finiteNumber(targetRegion?.longitude);
  const withDist = (row: { academy: Row; distanceKm: number | null }) => row.distanceKm === null
    ? row.academy
    : { ...row.academy, distance_km: Math.round(row.distanceKm * 10) / 10 };
  const scored = all
    .filter((academy) => {
      if (!directKeys.has(keyOf(academy))) return true;
      trace.duplicatesRemoved.push({ academyId: keyOf(academy), academyName: String(academy.name || ""), reason: "already_in_region_like" });
      return false;
    })
    .map((academy) => {
      const address = String(academy.address || "");
      const storedRegion = String(academy.region || "");
      const distanceKm = academyDistanceKm(academy, targetLat, targetLng);
      let score = Number.POSITIVE_INFINITY;
      let inclusionReason: AcademySelectionTraceCandidate["inclusionReason"] = "within_far_guarantee";
      if (storedRegion === region) { score = 0; inclusionReason = "stored_region_exact"; }
      else if (address.includes(region)) { score = 1; inclusionReason = "address_contains_target"; }
      else if (sameAdministrativePrefix(storedRegion, region) || sameAdministrativePrefix(address, region)) { score = 3; inclusionReason = "same_administrative_prefix"; }
      else if (distanceKm !== null && distanceKm <= ACADEMY_NEARBY_MAX_KM) { score = 2; inclusionReason = "within_nearby_radius"; }
      return { academy, score, distanceKm, inclusionReason };
    });
  const supplements = scored
    .filter((row) => Number.isFinite(row.score))
    .sort((left, right) => left.score - right.score
      || (left.distanceKm ?? Number.POSITIVE_INFINITY) - (right.distanceKm ?? Number.POSITIVE_INFINITY)
      || String(left.academy.name).localeCompare(String(right.academy.name), "ko"));
  const selectedSupplements = supplements.slice(0, Math.max(0, limit - direct.length));
  const result = [...direct, ...supplements.map(withDist)].slice(0, limit);

  trace.regionLikeCandidates = direct.map((academy, index) => toTraceCandidate(academy, "stored_region_like", "region_like_query", index + 1));
  trace.supplementCandidates = selectedSupplements.map((row, index) => toTraceCandidate(withDist(row), "supplement", row.inclusionReason, direct.length + index + 1, row.distanceKm));
  if (result.length < minRequired) {
    const usedKeys = new Set(result.map(keyOf));
    const far = scored
      .filter((row) => row.distanceKm !== null && row.distanceKm <= ACADEMY_MIN_GUARANTEE_MAX_KM && !usedKeys.has(keyOf(row.academy)))
      .sort((left, right) => (left.distanceKm ?? Number.POSITIVE_INFINITY) - (right.distanceKm ?? Number.POSITIVE_INFINITY))
      .slice(0, minRequired - result.length);
    const farRows = far.map(withDist);
    result.push(...farRows);
    trace.farCandidates = far.map((row, index) => toTraceCandidate(withDist(row), "far_guarantee", "within_far_guarantee", result.length - farRows.length + index + 1, row.distanceKm));
  }
  trace.mergedCandidatePool = [
    ...trace.regionLikeCandidates,
    ...trace.supplementCandidates,
    ...trace.farCandidates,
  ];
  return { candidates: result, trace };
}

function isUsableAcademy(row: Row): boolean {
  const name = String(row.name || "").trim();
  if (!name || /^(?:test|테스트|sample|dummy|asdf|qwer|123|없음|null|undefined)/i.test(name)) return false;
  if (/(?:테스트|샘플|더미|dummy|sample|placeholder)/i.test(name)) return false;
  const usableFields = ["address", "price", "shuttle", "hours", "pass_rate", "phone", "vphone", "review", "seo_description", "seo_keywords", "thumb_url", "photos"];
  return usableFields.some((key) => String(row[key] || "").trim().length >= 8);
}

function academyDistanceKm(row: Row, targetLat: number | null, targetLng: number | null): number | null {
  const lat = finiteNumber(row.latitude);
  const lng = finiteNumber(row.longitude);
  if (targetLat === null || targetLng === null || lat === null || lng === null) return null;
  return haversineKm(targetLat, targetLng, lat, lng);
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radiusKm = 6371;
  const dLat = degreesToRadians(lat2 - lat1);
  const dLng = degreesToRadians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(degreesToRadians(lat1)) * Math.cos(degreesToRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function degreesToRadians(value: number): number { return value * Math.PI / 180; }

function sameAdministrativePrefix(left: string, right: string): boolean {
  const leftTokens = administrativeTokens(left);
  const rightTokens = administrativeTokens(right);
  if (!leftTokens.length || !rightTokens.length || leftTokens[0] !== rightTokens[0]) return false;
  return Boolean((leftTokens[1] && rightTokens[1] && leftTokens[1] === rightTokens[1])
    || (leftTokens[2] && rightTokens[2] && leftTokens[2] === rightTokens[2]));
}

function administrativeTokens(value: string): string[] {
  return String(value || "").split(/\s+/).filter((token) => /(?:특별시|광역시|특별자치시|특별자치도|도|시|군|구)$/u.test(token));
}

function fnv1a(value: string): number {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function mulberry32(value: number): () => number {
  return function next(): number {
    value = (value + 0x6D2B79F5) | 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
