/**
 * Read-only, mode-neutral T01 output evaluator.
 *
 * This module deliberately does not call the runtime quality gate and never
 * requests repair.  It evaluates legacy and data-gated output against the
 * same frozen T01 candidate snapshot so native gate counts are not used as a
 * cross-mode quality score.
 */
import type { T01DataGatedContext } from "./t01-data-gated.js";

export type NeutralSeverity = "hard_failure" | "warning" | "score_penalty";
export type NeutralFailure = {
  ruleId: string;
  severity: NeutralSeverity;
  outputLocation: string;
  quotedEvidence: string;
  candidateId: string | null;
  supportingFact: string | null;
  classification: "true_content_error" | "ambiguous" | "not_applicable";
  explanation: string;
};

const POSITIVE_SHUTTLE = /셔틀(?:버스)?\s*(?:을\s*)?(?:운행|제공|이용\s*가능|있(?:습니다|다)?)/g;
const POSITIVE_PASS_RATE = /합격률\s*(?:이|은)?\s*(?:\d+(?:\.\d+)?%|높|우수|좋)/g;
const SPECIFIC_MONEY = /\d{2,3}\s*만\s*(?:원|뤈|웜)?|\d{3},\d{3}\s*원/g;
const INTERNAL_FACT_LANGUAGE = /긍정 수강생 리뷰 보충자료|긍정 블로그 리뷰글 보충자료|확인된 콘텐츠 재료|작성 범위|소개 가능한 후보 수|후기 필드|내부 데이터|내부 API/;
const ACCESSIBILITY_OVERCLAIM = /(?:직선거리|\d+(?:\.\d+)?\s*km).{0,48}(?:접근성이\s*(?:뛰어나|좋)|통학(?:이)?\s*(?:매우\s*)?편리|이동시간|도로\s*거리)|(?:접근성이\s*(?:뛰어나|좋)|통학(?:이)?\s*(?:매우\s*)?편리).{0,48}(?:직선거리|\d+(?:\.\d+)?\s*km)/;

export function neutralT01QualityIssues(markdown: string, context: T01DataGatedContext): NeutralFailure[] {
  const failures: NeutralFailure[] = [];
  const text = String(markdown || "");
  const table = text.split(/\r?\n/).filter((line) => line.includes("|")).join("\n");

  for (const candidate of context.candidates) {
    if (!text.includes(candidate.academyName)) {
      failures.push(failure("candidate_missing", "hard_failure", text, candidate.academyName, candidate.academyId, candidate.academyName, "후보가 본문에 소개되지 않았습니다."));
    }
    if (context.candidates.length >= 2 && !table.includes(candidate.academyName)) {
      failures.push(failure("comparison_table_candidate_missing", "hard_failure", text, candidate.academyName, candidate.academyId, candidate.academyName, "비교표에서 후보가 누락됐습니다."));
    }
    if (candidate.retrievalSource !== "stored_region_like") {
      const actualRegion = candidate.storedRegion || candidate.address;
      const regionDisclosed = Boolean(actualRegion && text.includes(actualRegion));
      const expansionDisclosed = /(주변|인근|확장 후보|다른 지역|거리 기준|가장 가까운 후보)/.test(text);
      if (!regionDisclosed || !expansionDisclosed) {
        failures.push(failure("non_primary_region_not_disclosed", "hard_failure", text, candidate.academyName, candidate.academyId, actualRegion || null, "거리 보충 후보의 실제 지역 또는 확장 사유가 부족합니다."));
      }
    }
    if (candidate.straightLineDistanceKm !== null) {
      const distance = candidate.straightLineDistanceKm.toFixed(1);
      const distanceMentioned = new RegExp(`${escapeRegExp(distance)}\\s*km|${escapeRegExp(String(candidate.straightLineDistanceKm))}\\s*km`, "i").test(text);
      const distanceSentence = distanceMentioned ? firstDistanceSentence(text, distance) : "";
      if (distanceSentence && ACCESSIBILITY_OVERCLAIM.test(distanceSentence) && !isConfirmationOrNegation(distanceSentence)) {
        failures.push(failure("straight_line_distance_misrepresented", "hard_failure", text, distanceSentence, candidate.academyId, `직선거리 ${distance}km`, "직선거리를 도로거리·이동시간·접근성 단정으로 연결했습니다."));
      }
    }
  }

  const allTuitionMissing = context.candidates.every((candidate) => !candidate.tuition);
  if (allTuitionMissing) for (const match of text.matchAll(SPECIFIC_MONEY)) {
    failures.push(failure("unverified_tuition_claim", "hard_failure", text, match[0], null, "모든 후보의 tuition이 missing", "입력에 없는 구체 수강료 또는 비용을 사용했습니다."));
  }

  const allShuttleMissing = context.candidates.every((candidate) => !candidate.shuttle);
  if (allShuttleMissing) for (const match of text.matchAll(POSITIVE_SHUTTLE)) {
    const sentence = sentenceAt(text, match.index || 0);
    if (!isConfirmationOrNegation(sentence)) {
      failures.push(failure("unverified_shuttle_claim", "hard_failure", text, sentence, null, "모든 후보의 shuttle이 missing", "확인되지 않은 셔틀 운행을 사실처럼 단정했습니다."));
    }
  }

  const allPassRateMissing = context.candidates.every((candidate) => !candidate.passRate);
  if (allPassRateMissing) for (const match of text.matchAll(POSITIVE_PASS_RATE)) {
    const sentence = sentenceAt(text, match.index || 0);
    if (!isConfirmationOrNegation(sentence)) {
      failures.push(failure("unverified_pass_rate_claim", "hard_failure", text, sentence, null, "모든 후보의 passRate가 missing", "확인되지 않은 합격률을 사실처럼 단정했습니다."));
    }
  }

  if (INTERNAL_FACT_LANGUAGE.test(text)) {
    failures.push(failure("internal_fact_language_exposed", "warning", text, INTERNAL_FACT_LANGUAGE.exec(text)?.[0] || "내부 fact label", null, "표현은 생성 입력의 메타 라벨", "입력 데이터의 내부 라벨이 독자용 본문에 노출됐습니다."));
  }
  if ((text.match(/\?/g) || []).length > 6) {
    failures.push(failure("excessive_questions", "warning", text, "?", null, null, "질문형 문장이 6개를 초과합니다."));
  }

  return dedupe(failures);
}

function isConfirmationOrNegation(sentence: string): boolean {
  return /\?|여부|확인|문의|물어보|물어볼|질문|묻기|상담 때|상담 전|없|미확인|제공되지|보장하지|단정할 수 없|뜻하지|아니|변동/.test(sentence);
}

function firstDistanceSentence(text: string, distance: string): string {
  const match = new RegExp(`${escapeRegExp(distance)}\\s*km`, "i").exec(text) || new RegExp(`${escapeRegExp(distance.replace(/\\.0$/, ""))}\\s*km`, "i").exec(text);
  return match ? sentenceAt(text, match.index) : "";
}

function sentenceAt(text: string, index: number): string {
  const start = Math.max(text.lastIndexOf("\n", index), text.lastIndexOf(".", index), text.lastIndexOf("!", index), text.lastIndexOf("?", index)) + 1;
  const ends = [text.indexOf("\n", index), text.indexOf(".", index), text.indexOf("!", index), text.indexOf("?", index)].filter((value) => value >= 0);
  const end = ends.length ? Math.min(...ends) : text.length;
  return text.slice(start, end + 1).replace(/\s+/g, " ").trim();
}

function failure(ruleId: string, severity: NeutralSeverity, text: string, evidence: string, candidateId: string | null, supportingFact: string | null, explanation: string): NeutralFailure {
  const location = lineLocation(text, evidence);
  return { ruleId, severity, outputLocation: location, quotedEvidence: compactEvidence(evidence), candidateId, supportingFact, classification: "true_content_error", explanation };
}

function lineLocation(text: string, evidence: string): string {
  const index = evidence ? text.indexOf(evidence) : -1;
  if (index < 0) return "unknown";
  return `line:${text.slice(0, index).split(/\r?\n/).length}`;
}

function compactEvidence(value: string): string { return value.replace(/\s+/g, " ").trim().slice(0, 240); }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function dedupe(items: NeutralFailure[]): NeutralFailure[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.ruleId}:${item.outputLocation}:${item.quotedEvidence}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
