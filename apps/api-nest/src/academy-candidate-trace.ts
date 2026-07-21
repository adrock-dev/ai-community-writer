import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ACADEMY_MAX_CANDIDATES, ACADEMY_MIN_FOR_BEST, ACADEMY_USED_PER_POST } from "./constants.js";
import { DbService } from "./db.service.js";
import { seededCandidateSample, selectAcademiesForRegion, type AcademySelectionTraceCandidate } from "./academy-candidate-selection.js";

export type ReadonlyCandidateTraceInput = {
  dbPath: string;
  domain: string;
  targetRegion: string;
  slotSeed?: string;
  academyTypes?: string[];
};

export type ReadonlyCandidateTrace = {
  targetRegion: string;
  configuredMinimum: number;
  candidatePoolLimit: number;
  bodyCandidateLimit: number;
  nearbyRadiusKm: number;
  farRadiusKm: number;
  regionLikeCandidates: AcademySelectionTraceCandidate[];
  supplementCandidates: AcademySelectionTraceCandidate[];
  farCandidates: AcademySelectionTraceCandidate[];
  duplicatesRemoved: Array<{ academyId: string; academyName: string; reason: "already_in_region_like" }>;
  excludedCandidates: Array<{ academyId: string; academyName: string; reason: "not_usable" }>;
  mergedCandidatePool: AcademySelectionTraceCandidate[];
  finalBodyCandidates: AcademySelectionTraceCandidate[];
};

/** Opens an existing SQLite database in read-only mode and never calls DbService.init(). */
export async function runReadonlyCandidateTrace(input: ReadonlyCandidateTraceInput): Promise<ReadonlyCandidateTrace> {
  const dbPath = resolve(input.dbPath);
  if (!existsSync(dbPath)) throw new Error(`database does not exist: ${dbPath}`);
  const sqlite = await import("node:sqlite" as string) as any;
  const readonly = new sqlite.DatabaseSync(dbPath, { readOnly: true });
  try {
    const db = new DbService();
    (db as any).db = readonly;
    const selection = selectAcademiesForRegion(
      db,
      input.domain,
      input.targetRegion,
      ACADEMY_MAX_CANDIDATES,
      input.academyTypes ?? ["exam_academy", "academy"],
      ACADEMY_MIN_FOR_BEST,
    );
    const traceById = new Map(selection.trace.mergedCandidatePool.map((candidate) => [candidate.academyId, candidate]));
    const finalBodyCandidates = seededCandidateSample(
      selection.candidates,
      Math.min(ACADEMY_MAX_CANDIDATES, ACADEMY_USED_PER_POST),
      input.slotSeed ?? `${input.targetRegion}|readonly-trace`,
    ).map((candidate) => traceById.get(String(candidate.external_id || candidate.id || candidate.name)))
      .filter((candidate): candidate is AcademySelectionTraceCandidate => Boolean(candidate));
    return { ...selection.trace, bodyCandidateLimit: ACADEMY_USED_PER_POST, finalBodyCandidates };
  } finally {
    readonly.close();
  }
}
