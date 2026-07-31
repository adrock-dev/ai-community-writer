/**
 * T16 「지역 운전학원 축 기반 비교」 — 축이 글의 내용을 실제로 움직이게 하는 계층.
 *
 * T01 과의 차이는 두 가지다.
 *  1) 후보 선택이 거리 단일 기준이다(지역 문자열 매칭을 거리보다 우선하지 않는다).
 *  2) 슬롯의 축 값이 비교표 열·강조 섹션·필수 응답 섹션·제목 부제를 **결정한다**.
 *     T01 은 축을 프롬프트에 라벨로만 넘겨서 글을 구분하지 못했다.
 *
 * 축별 역할은 겹치지 않게 나눈다(겹치면 축 쏠림이 다시 생긴다):
 *   persona  = 누구를 위한 글인가   → 도입 상황 · 확인 질문 순서 · 마무리 연결
 *   modifier = 무엇으로 비교하는가  → 비교표 열 · 강조 섹션
 *   intent   = 무엇을 알려주는가    → 반드시 답해야 하는 질문(필수 섹션)
 *
 * 모든 축은 **facts 게이팅**을 통과해야 채택된다. 근거가 없으면 글을 막지 않고
 * 근거가 있는 축으로 강등한다 — 축 때문에 생성이 실패하면 안 된다.
 */
import { academyDistinguishingPoints, distinguishingPointsFactLine } from "./academy-distinguishing-points.js";

type Row = Record<string, any>;

export const T16_TEMPLATE_ID = "T16";

/** 후보 학원이 그 근거를 갖고 있는지. 게이팅·열 구성의 단일 판정. */
export type EvidenceKey = "price" | "course" | "academyType" | "hours" | "shuttleArea" | "review" | "region";

const EVIDENCE_TESTS: Record<EvidenceKey, (academy: Row) => boolean> = {
  price: (a) => String(a.price || "").trim().length > 8,
  course: (a) => String(a.extra || "").includes("license_types"),
  academyType: (a) => String(a.academy_type || "").trim().length > 0,
  hours: (a) => String(a.hours || "").trim().length > 8,
  shuttleArea: (a) => /운행\s*지역/u.test(String(a.shuttle || "")),
  review: (a) => String(a.review || "").trim().length > 8,
  region: (a) => String(a.address || a.region || "").trim().length > 0,
};

/** 축을 채택하려면 후보 중 최소 이만큼이 근거를 가져야 한다(비교는 2곳부터 성립). */
export const MIN_EVIDENCE_ACADEMIES = 2;

export function evidenceCount(academies: Row[], key: EvidenceKey): number {
  const test = EVIDENCE_TESTS[key];
  return academies.filter((academy) => test(academy)).length;
}

export function hasEvidence(academies: Row[], key: EvidenceKey): boolean {
  return evidenceCount(academies, key) >= MIN_EVIDENCE_ACADEMIES;
}

// ── modifier: 각 학원 소개에서 무엇을 부각할까 ────────────────────────────────
//
// T16 은 '비교글'이 아니라 각 학원을 소개·안내하는 글이다. "비교"로 프레이밍하면 모델은
// 학원끼리 정렬 비교가 되는 값만 찾게 되고, facts 에서 그게 되는 건 수강료(숫자)뿐이라
// 축과 무관하게 글이 수강료로 수렴했다(실측: 비용무관 축에도 비용어 16회). 그래서 modifier 는
// '비교표 열'이 아니라 '각 학원 소개에서 부각할 관점'을 정한다.

type ModifierSpec = {
  /** 각 학원 소개에서 부각할 관점(그 학원의 확인된 사실 중 이 측면을 살린다). */
  angle: string;
  /** 학원 요약표에 더할 열. 학원명·실제 소재지·운영 과정은 항상 들어가므로 그 밖의 열만. null 이면 없음. */
  summaryColumn: string | null;
  /** 이 축이 성립하려면 필요한 근거. */
  requires: EvidenceKey[];
  /** 강조 섹션 주제(각 학원의 이 측면 특징·장점). */
  focus: string;
  /** 근거가 없을 때 내려앉을 축. */
  fallback: string | null;
};

export const T16_MODIFIERS: Record<string, ModifierSpec> = {
  비용절약: { angle: "수강료 구성과 과정이 예산에 맞는지", summaryColumn: "수강료", requires: ["price"], focus: "각 학원의 수강료 구성과 절약해 볼 만한 점", fallback: "상담전확인" },
  셔틀편리: { angle: "셔틀 운행 지역이 내 동선과 맞는지", summaryColumn: "셔틀 운행 지역", requires: ["shuttleArea"], focus: "각 학원의 셔틀 운행 지역과 이용 방법", fallback: "가까운" },
  야간반: { angle: "야간 시간대에 수강할 수 있는 운영 시간", summaryColumn: "운영 시간", requires: ["hours"], focus: "각 학원의 운영 시간과 퇴근 후 수강 가능성", fallback: "상담전확인" },
  주말반: { angle: "주말에 수강할 수 있는 운영 요일", summaryColumn: "운영 시간", requires: ["hours"], focus: "각 학원의 주말 운영 여부와 수강 방법", fallback: "상담전확인" },
  상담전확인: { angle: "상담 전에 정리해 둘 그 학원의 기본 정보", summaryColumn: null, requires: ["course"], focus: "상담 전에 공통으로 확인할 질문", fallback: null },
  가까운: { angle: "실제 소재지와 생활 동선상의 위치", summaryColumn: null, requires: ["region"], focus: "각 학원의 위치와 생활 동선", fallback: null },
};

// ── intent: 무엇을 알려주는가 ────────────────────────────────────────────────

type IntentSpec = {
  /** 글이 반드시 답해야 하는 질문. 필수 섹션의 주제가 된다. */
  question: string;
  requires: EvidenceKey[];
  fallback: string | null;
  /** 제목 부제 뒷부분. */
  subtitle: string;
};

export const T16_INTENTS: Record<string, IntentSpec> = {
  과정선택: { question: "이 지역에서 딸 수 있는 면허 과정과 그 차이", requires: ["course"], fallback: null, subtitle: "내게 맞는 면허 과정" },
  학원유형: { question: "전문학원과 일반학원의 차이와 고르는 기준", requires: ["academyType"], fallback: "과정선택", subtitle: "전문학원 차이" },
  비용구성: { question: "수강료에 무엇이 포함되고 무엇이 따로인지", requires: ["price"], fallback: "과정선택", subtitle: "수강료 구성" },
  후기확인: { question: "수강생 반응에서 확인할 수 있는 점", requires: ["review"], fallback: "과정선택", subtitle: "생생한 수강생 후기" },
  일정확인: { question: "언제 다닐 수 있는지(운영 요일·시간)", requires: ["hours"], fallback: "과정선택", subtitle: "다닐 수 있는 시간표" },
};

/**
 * 같은 슬롯에 함께 오면 내용이 겹치는 (modifier, intent) 조합.
 * 축이 서로 다른 일을 해야 하는데 둘 다 같은 데이터를 가리키면 한 축이 낭비된다.
 */
export const T16_CONFLICTING_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["비용절약", "비용구성"],
  ["야간반", "일정확인"],
  ["주말반", "일정확인"],
];

export function isConflictingAxisPair(modifier: unknown, intent: unknown): boolean {
  const m = String(modifier || "");
  const i = String(intent || "");
  return T16_CONFLICTING_PAIRS.some(([left, right]) => left === m && right === i);
}

// ── 해석: 슬롯 축 + facts → 실제로 쓸 축 ─────────────────────────────────────

export type T16AxisPlan = {
  modifier: string;
  intent: string;
  /** 각 학원 소개에서 부각할 관점. */
  angle: string;
  /** 학원 요약표에 더할 열(학원명·실제 소재지·운영 과정은 항상 포함). 없으면 빈 배열. */
  summaryColumns: string[];
  /** 강조 섹션 주제(각 학원의 이 측면 특징·장점). */
  focus: string;
  /** 필수 응답 섹션이 답할 질문. */
  question: string;
  /** 제목 부제. */
  subtitle: string;
  /** 근거 부족으로 강등된 축(운영자 진단용). */
  demoted: string[];
};

/** 학원 요약표는 후보가 이 수 이상일 때만 둔다(3곳 이하는 각 학원 소개만으로 충분). */
export const T16_SUMMARY_TABLE_MIN_ACADEMIES = 4;

/** 근거가 있을 때까지 fallback 을 따라 내려간다(순환·미정의 방어). */
function resolveWithFallback<T extends { requires: EvidenceKey[]; fallback: string | null }>(
  table: Record<string, T>, start: string, academies: Row[], demoted: string[],
): { key: string; spec: T } {
  const seen = new Set<string>();
  let key = start;
  for (let hop = 0; hop < 4; hop++) {
    const spec = table[key];
    if (!spec) break;
    if (spec.requires.every((r) => hasEvidence(academies, r))) return { key, spec };
    seen.add(key);
    demoted.push(key);
    if (!spec.fallback || seen.has(spec.fallback)) break;
    key = spec.fallback;
  }
  // 마지막 안전망: 근거 없이도 항상 성립하는 축.
  const safeKey = Object.keys(table).find((k) => table[k]!.requires.length === 0) ?? Object.keys(table)[0]!;
  return { key: safeKey, spec: table[safeKey]! };
}

// 부제 변형: 같은 축이라도 슬롯마다 다른 문구가 나오게 슬롯 시드로 회전시킨다(제목 완전중복·부제 반복 완화).
// slot_id 해시라 결정론적 — 같은 슬롯은 재생성해도 같은 부제(재현성·golden 유지). 각 배열 첫 항목이 기본형.
//
// **어미를 담지 않는다.** 예전에는 "수강료 아끼기부터"·"면허 과정 고르기까지" 처럼 조사를 품고 있어
// 부제 틀이 `A부터 B까지!` 하나로 고정됐다. 어휘는 9가지로 회전해도 리듬이 늘 같아, 후보 1,000개를
// 대량 생성하면 목록·검색결과가 한 패턴으로 보인다. 어간만 두고 어미는 SUBTITLE_TEMPLATES 가 붙인다.
const MODIFIER_SUBTITLE_STEMS: Record<string, string[]> = {
  비용절약: ["수강료 아끼기", "가성비 따지기", "비용 먼저 챙기기"],
  셔틀편리: ["우리 동네 셔틀", "셔틀 되는 곳", "통학 셔틀"],
  야간반: ["야간반 여부", "퇴근 후 수업", "야간 운영"],
  주말반: ["주말 수업", "주말반 여부", "주말 운영"],
  상담전확인: ["상담 전 체크", "상담 전 기본 정보", "상담 준비"],
  가까운: ["가까운 학원", "우리 동네", "가까운 곳"],
};
const INTENT_SUBTITLE_STEMS: Record<string, string[]> = {
  과정선택: ["내게 맞는 면허 과정", "필요한 면허 과정", "면허 과정 고르기"],
  학원유형: ["전문학원 차이", "학원 유형 비교", "전문·일반 차이"],
  비용구성: ["수강료 구성", "무엇이 포함되는지", "수강료 항목"],
  후기확인: ["생생한 수강생 후기", "실제 후기로 골라보기", "수강생 반응"],
  일정확인: ["다닐 수 있는 시간표", "가능한 교육 일정", "운영 시간표"],
};

/**
 * 부제 틀 — 어간(수식어 A · 의도 B)에 어미를 붙여 완성한다.
 *
 * 조사 '와/과'를 쓰는 틀은 넣지 않았다(앞 글자 받침에 따라 갈려 판정 로직이 필요하다).
 * 뒤쪽 둘은 **한 축만** 드러내는 틀이다. 부제에서 빠진 축도 글에는 그대로 전달된다 —
 * t16PromptContract 가 관점(angle)·강조 섹션(focus)·필수 응답(question)을 따로 주입하므로
 * 본문 구성은 유지되고, 약해지는 것은 "제목이 약속한 것을 본문이 지키는" 쪽뿐이다.
 */
const SUBTITLE_TEMPLATES: ReadonlyArray<(modifier: string, intent: string) => string> = [
  (m, i) => `${m}부터 ${i}까지!`,
  (m, i) => `${m}, ${i}까지 한 번에`,
  (m, i) => `${i}, ${m}까지 확인하세요`,
  (m, i) => `${m} · ${i}`,
  (m) => `${m} 먼저 확인!`,
  (_m, i) => `${i} 한눈에`,
];
// FNV-1a 해시로 시드 → 인덱스(결정론적, Math.random 금지 — golden/재현성 보호).
function subtitleVariantIndex(seed: string, n: number): number {
  if (n <= 1) return 0;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h % n;
}
// 틀·수식어·의도를 하나의 조합 공간(nTemplate×nMod×nInt)으로 보고 시드로 기준 칸을 정한 뒤 형제
// 서수만큼 회전한다. eff∈[0,total)이 (틀, 수식어칸, 의도칸)에 일대일 대응하므로, 같은 (지역·축)
// 슬롯이 서로 다른 variantOffset(형제 서수)을 받으면 부제가 반드시 달라진다 → 제목 완전중복 0.
// 틀을 차원에 넣어 조합이 9 → 54가지가 됐다(틀 6 × 수식어 3 × 의도 3).
function pickSubtitle(
  modStems: string[] | undefined,
  modFallback: string,
  intStems: string[] | undefined,
  intFallback: string,
  seed: string,
  offset: number,
): string {
  const mods = modStems && modStems.length ? modStems : [modFallback];
  const ints = intStems && intStems.length ? intStems : [intFallback];
  const perTemplate = mods.length * ints.length;
  const total = SUBTITLE_TEMPLATES.length * perTemplate;
  const base = subtitleVariantIndex(seed, total);
  const eff = (((base + offset) % total) + total) % total;
  const template = SUBTITLE_TEMPLATES[Math.floor(eff / perTemplate)]!;
  const rest = eff % perTemplate;
  return template(mods[Math.floor(rest / ints.length)]!, ints[rest % ints.length]!).replace(/\s+/g, " ").trim();
}

export function buildT16AxisPlan(slot: Row, academies: Row[], opts?: { variantOffset?: number }): T16AxisPlan {
  const demoted: string[] = [];
  const rawModifier = String(slot.modifier_1 || "").trim() || "상담전확인";
  const rawIntent = String(slot.intent || "").trim() || "과정선택";
  const mod = resolveWithFallback(T16_MODIFIERS, rawModifier, academies, demoted);
  const int = resolveWithFallback(T16_INTENTS, rawIntent, academies, demoted);
  // 요약표 추가 열. 학원명·실제 소재지·운영 과정은 항상 들어가므로 걸러내 중복을 막는다.
  // 추가 열이 없는 수식어(상담전확인·가까운)는 카드와 중복되는 얇은 표가 되므로,
  // 수강료 근거가 있으면 '수강료'로 채워 훑어보기 가치를 준다(없으면 얇은 채로 둔다).
  const extraColumn = mod.spec.summaryColumn ?? (hasEvidence(academies, "price") ? "수강료" : null);
  const summaryColumns = [extraColumn]
    .filter((column): column is string => Boolean(column) && !["실제 소재지", "학원명", "운영 과정"].includes(column!));
  // 축별 부제 변형을 슬롯 시드로 회전하고, 같은 (지역·축) 형제 서수(variantOffset)만큼 더 밀어
  // 형제끼리 부제 조합이 겹치지 않게 한다(제목 완전중복 방지).
  const subtitleSeed = String(slot.slot_id ?? slot.id ?? `${slot.region}|${slot.persona}|${rawModifier}|${rawIntent}`);
  return {
    modifier: mod.key,
    intent: int.key,
    angle: mod.spec.angle,
    summaryColumns,
    focus: mod.spec.focus,
    question: int.spec.question,
    // 부제 = 틀 6종 × 수식어 어간 3 × 의도 어간 3 을 슬롯 시드로 회전(제목/부제 반복 완화).
    // 어미는 틀이 붙인다 — 여기서 "!"를 덧붙이지 않는다(틀마다 맺음이 다르다).
    subtitle: pickSubtitle(
      MODIFIER_SUBTITLE_STEMS[mod.key],
      modifierSubtitleStem(mod.key),
      INTENT_SUBTITLE_STEMS[int.key],
      int.spec.subtitle,
      subtitleSeed,
      opts?.variantOffset ?? 0,
    ),
    demoted,
  };
}

// 수식어 어간 폴백 — MODIFIER_SUBTITLE_STEMS 에 없는 키(커스텀 유형 등)일 때 쓴다. 어미는 틀이 붙이므로
// 여기도 어간만 둔다. "비교"라는 낱말은 쓰지 않는다(정량 비교 프레이밍 유발). 미검증 단정(최저가 등) 금지.
function modifierSubtitleStem(modifier: string): string {
  const map: Record<string, string> = {
    비용절약: "수강료 아끼기",
    셔틀편리: "우리 동네 셔틀",
    야간반: "야간반 여부",
    주말반: "주말 수업",
    상담전확인: "상담 전 체크",
    가까운: "가까운 학원",
  };
  return map[modifier] ?? "";
}

// ── 프롬프트 주입 ────────────────────────────────────────────────────────────

/**
 * 축이 정한 것을 프롬프트가 따르도록 명시한다. 구조 지침이 "'각 학원 소개에서 부각할 관점'" 처럼
 * 자리만 만들어 두고 실제 값은 여기서 준다 — 아키타입은 자리를, 축이 값을 채우는 분리.
 *
 * 이 글은 '비교글'이 아니라 각 학원을 소개·안내하는 글이다. 비교 프레이밍을 걷어내야
 * 모델이 정량 비교 가능한 값(수강료)만 찾지 않고 각 학원의 고유한 특징·장점을 살린다.
 */
export function t16PromptContract(plan: T16AxisPlan, slot: Row, academyCount: number): string {
  const persona = String(slot.persona || "").trim();
  const summaryCols = ["학원명", "실제 소재지", "운영 과정", ...plan.summaryColumns];
  return [
    "T16 지침 (이 지침의 이름이나 내부 작업 방식은 글에 쓰지 않는다):",
    "- 이 글의 중심은 각 학원을 하나씩 소개·안내하는 것이다. 학원끼리 우열을 정량 비교하려 애쓰지 말고, 각 학원의 확인된 특징과 장점을 그 학원 소개 안에서 구체적으로 살린다.",
    `- 각 학원 소개에서 부각할 관점: ${plan.angle}. 그 학원의 확인된 사실 중 이 관점에 해당하는 내용을 이야기하되, 자료가 없는 학원은 억지로 지어내지 말고 다른 확인된 특징으로 소개한다.`,
    `- 각 학원의 장점은 확인된 사실(운영 과정·수강료·셔틀 운행 지역·운영 시간·수강생 리뷰·운영 형태)에 근거할 때만 쓴다. 근거 없는 장점·순위·과장은 만들지 않는다.`,
    academyCount >= T16_SUMMARY_TABLE_MIN_ACADEMIES
      ? `- 학원 요약표: 후보가 ${academyCount}곳이라 정보가 많으므로, ${summaryCols.join(" · ")} 열로 한눈에 볼 수 있는 요약표를 하나 둔다. 표는 우열·순위를 매기지 말고 각 학원의 확인된 정보를 모아 훑어보게 돕는 보조 도구로만 쓴다. 단 "이 표는 순위가 아니다" 같은 설명 문장은 본문에 쓰지 말고 표만 깔끔히 둔다. 값이 없는 열·칸은 비우거나 뺀다. 전체 주소·전화번호는 요약표 열로 쓰지 않는다.`
      : `- 학원 요약표: ${summaryCols.join(" · ")} 열의 짧은 요약표를 하나 둔다. 표는 우열·순위를 매기지 말고 각 학원 소개를 보조하는 정보 요약으로만 쓰되, "이 표는 순위가 아니다" 같은 설명 문장은 본문에 쓰지 않는다. 값이 없는 칸은 비운다.`,
    `- 강조 섹션: "${plan.focus}"을 주제로 한 섹션을 하나 둔다. 확인된 자료 범위 안에서만 쓴다.`,
    `- 필수 응답: 이 글은 "${plan.question}"에 답한다. 제공된 자료로 답할 수 있는 만큼만 쓰고, 모자라면 상담에서 확인할 질문으로 남긴다.`,
    // 마무리 계약이 "매듭짓는다"고 열어 놓고 곧바로 "다음 행동으로 가는 기준으로 정리한다"로 방향을
    // 돌리던 문장이다. 그 결과 마무리가 어느 글에나 통하는 절차 안내("먼저 A를 정하고 그다음 B·C를
    // 차례로 확인하세요")로 수렴했다 — 페르소나는 첫 문장에서 한 번 불린 뒤 사라졌다.
    // 매듭의 대상을 '도입에서 실제로 쓴 그 고민 문장'으로 못박는다.
    persona ? `- 독자: 이 글의 독자는 "${persona}"다. 도입에서 그 상황을 구체적으로 그리고, 안내의 순서를 그 상황에 맞춘다. 마무리는 **도입에서 실제로 적은 그 고민 문장을 받아서 닫는다** — 그 걱정이 이 글을 읽고 어떻게 정리됐는지에 답한다(도입의 표현을 그대로 옮겨 적으라는 뜻은 아니다). 어느 글에나 그대로 쓸 수 있는 절차 안내로 닫지 않는다. 학원을 상황별로 하나씩 나열하지도 않는다. 특정 학원 추천이 필요하면 한둘만, 확인된 사실 근거로 하고 자료로 뒷받침되지 않는 추천은 만들지 않는다.` : "",
    // "한 문장으로만"이 범위 고지가 아니라 도입 전체의 상한으로 읽히던 문장이다(도입이 늘 최소 섹션이 된 원인 중 하나).
    // 제한 대상을 '범위를 밝히는 문장'으로 좁힌다.
    "- 후보는 이 지역을 기준으로 다닐 수 있는 범위에서 골랐다. 그 범위를 밝히는 문장은 도입에 한 문장만 두고(도입 전체를 한 문장으로 줄이라는 뜻이 아니다), 이후 섹션에서 반복하지 않는다.",
    "- 실제 소재지가 대상 지역과 다른 학원도 별도 후보군이나 섹션으로 나누지 않는다. 해당 학원 소개에 실제 지역만 사실대로 적는다.",
    "- `13.2km`, `약 Nkm` 같은 거리 수치와 직선거리·도로거리·이동시간·통학 편의·접근성 우위 단정은 쓰지 않는다.",
    "- 대중교통 노선·도보 시간·주차 여부는 확인된 자료가 없으므로 쓰지 않고, 필요하면 상담 확인 질문으로만 남긴다.",
  ].filter(Boolean).join("\n");
}

/**
 * T16 계열 톤: 글유형 방향성 텍스트가 전문가 톤을 지시하면 "expert", 아니면 "conversational"(기본).
 *
 * commonToneGuide 가 방향성으로 격식 수준(종결어미·이모지)을 정하는 것과 **같은 신호**를
 * t16WritingGuide 의 예시·어투에도 전달한다(두 층이 어긋나지 않게). 기본 T16 방향성은 "대화체"라
 * conversational 로 떨어지고, T16 을 복제한 전문가판 커스텀 유형은 방향성에 "전문가 설명 톤"을 넣어
 * expert 가 된다. 톤 자체는 방향성 한 줄로만 갈리고, 콘텐츠·구조 지침은 두 톤이 공유한다.
 */
export function t16ToneFromDirection(direction: string): "conversational" | "expert" {
  return /전문가|설명\s*톤|격식|차분/u.test(String(direction || "")) ? "expert" : "conversational";
}

/**
 * T16 전용 문체 지침 — 각 학원 소개의 스토리텔링·공감·상세도(콘텐츠 층)를 담당한다.
 *
 * buildPrompt 의 기본 문체만 받으면 후보 소개가 "~으로, ~과정을 운영합니다. 실제 소재지는
 * ~이며…" 식 사실 나열 보고서가 된다(실측). Legacy Plus 의 writingGuide(t01-legacy-plus.ts)에
 * 검증된 스토리텔링·공감 요소가 있지만 "다른 지역인데도 후보가 되는 이유" 같은 T01 인근-후보
 * 서사가 섞여 있어 그대로 쓰면 T16 계약(지역군 분리 금지·거리 단정 금지)과 충돌한다.
 * 그래서 그 요소만 추려 T16 맥락으로 다시 쓴다. slot.persona 를 도입 예시에 직접 엮는다.
 *
 * **격식 수준(종결어미·이모지)은 여기서 하드코딩하지 않는다** — commonToneGuide 가 글유형 방향성에
 * 따라 정한다. 이 함수는 방향성이 준 tone 으로 도입 예시·에디터 어투만 갈라, 같은 T16 콘텐츠를
 * 대화체(기본)로도 전문가 톤으로도 쓸 수 있게 한다(전문가판은 T16 복제 커스텀 유형).
 */
export function t16WritingGuide(_slot: Row, tone: "conversational" | "expert" = "conversational"): string {
  const isExpert = tone === "expert";
  const openingExample = isExpert
    ? "예: 무엇부터 확인해야 하는지 그 순서를 짚어 준다."
    : "예: 비용도 챙기고 싶고 일정도 맞아야 해서, 무엇부터 봐야 할지 고민되는 경우가 많죠.";
  const editorToneLine = isExpert
    ? "- 정보를 기계적으로 나열하는 보고서가 아니라, 독자의 판단을 돕는 신뢰감 있는 전문가 설명 톤으로 차분하게 쓴다. 근거를 갖춰 설명하되 필요한 곳에서는 독자의 의문을 짚어 준다. 예: \"이 부분을 먼저 확인하는 것이 좋습니다\", \"기준부터 정리하면 다음과 같습니다\"."
    : "- 정보를 기계적으로 정리하는 보고서가 아니라, 독자의 고민을 이해하고 선택을 돕는 친근한 블로그 에디터의 톤으로 쓴다. 독자에게 말을 거는 표현을 실제로 쓴다. 예: \"이 부분이 궁금하실 텐데요\", \"처음이라면 여기부터 확인해 보세요\", \"가격만 보고 정하기 전에 함께 볼 항목이 있어요\". 독자를 \"여러분\"으로 불러도 되지만 문단마다 반복하지 않는다.";
  return [
    // "짧게 공감한 뒤"가 도입 전체를 축소하는 신호로 작동했다. 공감의 분량 대신 도입이 담을 것을 명세한다.
    `- 도입은 검색어를 그대로 반복하지 말고, 독자가 실제로 처한 상황과 궁금증에서 연다. ${openingExample} 고를 항목이 많아 판단이 쉽지 않다는 점에 공감한 뒤 이 글에서 볼 기준과 후보로 이어 간다. 도입은 세 문단(합쳐 6~8문장)으로 쓰고, 한두 문장으로 끝내지 않는다.`,
    editorToneLine,
    "- 같은 틀을 반복하지 않는다: 후보마다 \"이런 분에게 ~한 곳입니다\" 식 마무리를 되풀이하지 말고(특징만 말하고 끝내도 된다), 사실을 \"확인돼 있어요/안내돼 있어/확인됩니다\"로 문장마다 감싸지 않는다(자료 기준임은 글에서 한 번만 밝힌다).",
    "- 후보 소개는 \"과정을 운영합니다 / 실제 소재지는 ~입니다\" 식으로 사실만 나열하지 않는다. 각 학원에서 실제로 확인된 사실이 그 독자에게 어떤 의미인지 한 문장으로 이어 준다. 모든 후보를 같은 문장 구조로 시작하지 않는다.",
    // ── 카드 산문이 기본 정보 불릿을 되풀이하는 문제 (2026-07-31 실측, 미해결) ─────────────
    //
    // 발행 5편·카드 10개를 대조하니 **불릿이 있는 카드는 100%가 산문에서 같은 값을 되풀이**했다
    // (운영 과정 7/7 · 셔틀 5/5 · 소재지 5/5 · 운영 형태 5/5 · 수강료 9/10). 예외는 주소(1/5)와
    // 전화(0/10)뿐인데, 아래 계약이 **주소만** 명시적으로 막아 뒀기 때문이다. 규칙이 듣긴 한다는
    // 뜻이지만, 막으면 모델은 다른 불릿 항목으로 옮겨갈 뿐이다.
    //
    // 근원은 재료가 겹치는 것이 아니라 **차이가 없는 것**이다. `academy-distinguishing-points`는
    // 동점이면 아무것도 내지 않으므로(`uniqueExtremeIndex`), 후보 25곳 중 12곳(48%)만
    // 「두드러지는 점」을 받았다. 나머지 절반에게 이 계약이 "셔틀·과정·시간·수강료 중 하나를
    // 골라 열라"고 하는데 그 넷이 곧 불릿 항목이다. 겹치지 않으려면 없는 차이를 지어내야 한다.
    //
    // 원천 자료가 부족해서가 아니다(380곳: 수강료 87%·면허 과정 88%·리뷰 88%·조사값 83%,
    // 카드 재료 4종 중 3개 이상 보유 70%). 값은 있는데 후보끼리 **같다** — 한 글의 운영 형태는
    // 1~2가지뿐이라 사실상 공통 사실이다.
    //
    // 그래서 "되풀이하지 마라"를 한 줄 더 얹는 방향은 택하지 않았다. 카드 구조 자체가 모델
    // 재량이라 애초에 안 지켜진다 — 같은 5편 중 **3편은 기본 정보 불릿이 0개**였다(계약은
    // 2~6개를 요구한다). 「운영 형태」도 "모두 같으면 넣지 않는다"가 프롬프트 문장뿐이라
    // (`worker.service.ts`), 5곳 중 4곳이 같은 값인 글에서 5곳 전부에 붙었다.
    // 고치려면 불릿을 코드가 facts에서 만들어 붙여야 하고, 그때 `post-rendering.ts` 와
    // `scripts/qa-posts.mjs` 의 미러도 함께 맞춰야 한다.
    "- 각 후보는 한 문장으로 스치지 말고 최소 3~4문장으로, 그 학원만의 개성이 드러나게 소개한다. 소개는 `### 학원명` 바로 아래에서 시작한다. 순서: ① 이 학원을 소개한다는 신호로 자연스럽게 연다 — 소개 순서를 밝히는 도입어(\"먼저 소개할 곳은\"·\"두 번째로 볼 곳은\"·\"이어서 볼 곳은\"·\"마지막으로 볼 곳은\")를 카드 절반 이상에서 실제로 쓰고, 학원이 자리한 지역(시·군·구·동)을 그 문장에 함께 밝힌다. 다만 네 카드가 모두 똑같은 도입어를 쓰지는 않게 표현을 바꾼다. → ② 그 학원의 `이 학원이 두드러지는 점`을 곧바로 제시한다 — 이 항목은 후보들을 서로 대조해 미리 계산해 둔 사실이므로 그대로 신뢰하고 쓰되, 라벨을 그대로 옮기지 말고(\"두드러지는 점은 ~입니다\" 금지) 자연스러운 문장으로 풀어 쓴다(예: \"네 곳 가운데 유일하게 주말에도 문을 열어요\", \"오전 7시부터 열어 네 곳 중 가장 이릅니다\"). 이 항목이 없는 학원은 그 학원에서 확인된 사실 중 다른 카드가 아직 앞세우지 않은 것(셔틀 운행 지역·운영 과정·운영 시간·수강료)을 하나 골라 연다 — **주소를 앞세우지 말 것**(도로명·번지를 그대로 읽어 주는 문장은 개성이 아니라 불릿의 중복이다. 소재지는 시·군·구·읍·면·동까지만, 그것도 주제 지역과 다를 때 위주로 쓴다). **한 카드가 앞세운 항목은 다른 카드의 첫 강점으로 다시 쓰지 않는다**(첫 강점만 겹치지 않게 하라는 뜻이며, 그 뒤 문장에서는 그 학원의 다른 확인된 사실을 얼마든지 이어 써도 된다 — 카드가 두세 문장으로 얇아지지 않게 한다). 셔틀 운행 지역을 앞세운 카드는 대표 지역 몇 곳을 실제로 나열해 독자가 자기 동네를 찾을 수 있게 쓴다. 수강료를 앞세운 카드는 **자료에 금액이 적힌 과정만** 금액과 함께 쓰고, 금액이 없는 과정을 다른 과정의 금액으로 미루어 \"같은 금액\"이라고 쓰지 않는다(운영 과정 목록에 있다고 해서 그 과정의 수강료가 제공된 것은 아니다). → ③ 그 차이가 어떤 독자에게 어떤 의미인지 이어 준다. **3~4문장을 한 덩어리로 붙이지 말고 ①②에서 한 번 끊고 ③부터 다음 문단으로 쓴다** — 공용 문체 지침의 \"문단 2~3문장\"은 카드 소개에도 그대로 적용된다. 한 문단이 360자를 넘지 않게 하고, 특히 긴 문단이 카드마다 연달아 이어지지 않게 한다(실측: 카드 두 개가 374자·364자로 붙어 발행 뒤 품질 감사에서 걸렸다). 카드 소개 산문에서는 후기 내용을 옮기지 않는다 — 후기는 카드 맨 아래 인용으로만 보여주고, 개성은 확인된 사실의 차이가 만들게 한다. 자료에 없는 항목은 \"제공된 자료에는 ~이 없어요\"처럼 자료의 유무를 서술하지 말고(내부 처리 과정을 드러내는 표현이다) 곧바로 상담에서 물어볼 질문으로 쓴다(예: \"셔틀 운행 여부와 탑승 위치는 상담에서 확인해 보세요\").",
    "- 여러 학원에 똑같이 적용되는 공통 조건(수강료의 \"부가세 별도·검정료 포함·기준 분기\" 같은 단서, 모든 학원이 같은 운영 형태라는 사실 등)은 글에서 한 번만 밝힌다. 각 학원 소개에서는 그 학원만의 값(수강료 금액, 실제 소재지, 운영 시간 등)만 쓰고 공통 단서 문장을 학원마다 되풀이하지 않는다.",
    // 고지문의 자리를 마무리에서 「금액이 적힌 곳」으로 옮긴다. 마무리에 두라고 지시했더니
    // 발행 21편 중 15편이 **마지막 문단 자체가 고지문**으로 끝났다(도입은 독자 고민으로 열어 놓고
    // 약관으로 닫는 글이 된다). 고지는 금액 옆에 있을 때 가장 잘 읽히므로 표 아래로 합친다.
    "- 수강료 공통 단서는 금액이 적힌 자리에 모은다: '부가세 별도·검정료 포함'처럼 금액 해석에 필요한 단서와 '○○년 ○분기 기준'·'할인·조건·시점에 따라 달라질 수 있으니 상담으로 확인' 같은 시점·고지성 안내를 요약표에 수강료 열이 있을 때 그 표 바로 아래 한 줄로 함께 붙인다. 요약표에 수강료 열이 없으면 금액을 처음 제시한 학원 카드 묶음이 끝나는 자리에 한 줄로 둔다. 이 단서들을 글 도입부 리드 문장으로 올리지 않는다.",
    "- 마무리(상담·예약) 섹션에서는 수강료 고지를 되풀이하지 않는다. **글의 마지막 문단이 '기준 시점·할인·조건에 따라 달라질 수 있다'는 고지 문장으로 끝나서는 안 된다** — 고지는 금액 옆에 붙는 각주이지 글의 맺음말이 아니다. 마무리의 마지막 문장은 독자에게 건네는 말로 닫는다.",
    "- 상담 체크리스트(✅ 목록)는 어느 학원에나 공통으로 던질 질문만 담는다. \"○○학원의 셔틀은 어느 지역을 운행하는지\"처럼 특정 학원 이름을 붙인 항목으로 쪼개지 않는다. 특정 학원에만 해당하는 세부 확인은 그 학원 소개 문단에서 다룬다.",
    "- 굵게(**) 표시는 이 글의 '각 학원 소개에서 부각할 관점'이 지목한 사실에 우선 쓴다 — 주말/야간이면 운영 시간, 셔틀이면 운행 지역, 비용이면 수강료 금액, 과정이면 면허 과정. 여기에 학원명 첫 등장 정도만 더한다. 굵게 하는 자리는 소개 산문 문장이다(기본 정보 불릿은 라벨만 굵게 — 값은 굵히지 않는다). 학원 카드당 1~3개로 아껴 쓰고, 부가세·검정료·기준 시점 같은 고지 문구나 문장 대부분을 굵게 만들지 않는다.",
    "- 독자의 상황(처음이라 걱정됨, 고를 항목이 많아 고민됨, 일정·비용이 빠듯함)에는 공감할 수 있다. 다만 학원에 대한 감정적 평가는 자료에 근거가 있을 때만 쓴다. 가상의 수강생·방문·상담 경험을 만들거나 글쓴이가 직접 다녀온 것처럼 쓰지 않는다.",
  ].join("\n");
}

/** 구조 지침에 축이 정한 관점·주제·질문을 덧붙인다. */
export function t16StructureGuide(baseGuide: string, plan: T16AxisPlan): string {
  return [
    baseGuide,
    // 후보가 적은 지역(2~3곳)은 카드 수가 적어 최소 분량(3,500자)에 걸리기 쉽다. 카드를 늘릴 수는
    // 없으니 각 카드와 강조 섹션의 밀도를 높이라고 명시한다(없는 사실을 채우라는 뜻이 아니다).
    "- 후보가 2~3곳뿐이면 카드 수가 적어 글이 짧아지기 쉽다. 이럴 때는 각 학원 카드를 4~5문장으로 충실히 쓰고 강조 섹션·필수 응답 섹션에서 확인된 사실을 더 깊이 풀어 최소 분량을 채운다(자료에 없는 내용을 지어내서 채우지는 않는다).",
    `- 각 학원 소개에서 부각할 관점: ${plan.angle}`,
    `- 강조 섹션 주제: ${plan.focus}`,
    `- 필수 응답 질문: ${plan.question}`,
  ].join("\n");
}

/**
 * T16 facts 가공 — 프롬프트를 오염시키던 필드만 걷어내고 나머지는 그대로 둔다.
 *
 * Legacy Plus 의 `legacyPlusFactsForPrompt` 를 쓰지 않는 이유: 그쪽은 수강생 리뷰까지 제거하고
 * 생성 뒤 원천 데이터로 다시 붙이는데(finalizeLegacyPlusMarkdown), 그 후처리가 T01 컨텍스트에
 * 강하게 묶여 있다. T16 은 intent=후기확인 이 리뷰를 근거로 쓰므로 리뷰가 프롬프트에 있어야 한다.
 *
 * 제거 대상은 실측으로 문제가 확인된 것만이다:
 *  - `SEO 설명`  : 원천 홍보 문구("익산·전주·군산 일대…")가 사실처럼 재료에 들어간다
 *  - `SEO 키워드`: 타 지역명이 대량으로 섞여 글의 지역을 흔든다
 *  - `좌표`      : 본문에 쓸 일이 없고 거리 서술을 유도한다
 *
 * 반대로 **더하는** 것이 하나 있다: `이 학원이 두드러지는 점`. 후보들을 서로 대조해야만 나오는
 * 사실(유일한 연중무휴, 개점이 가장 이름, 표시 수강료 최저 등)이라 학원 1곳의 필드만 봐서는
 * 알 수 없고, 모델에게 맡기면 앞 카드가 항목을 선점해 뒤 카드가 밀린다. academies 를 넘기면
 * academy-distinguishing-points 가 계산해 해당 후보 줄에 붙인다(순서는 [N] 과 같다).
 */
export function t16FactsForPrompt(facts: string, academies: Row[] = []): string {
  const DROP = /^(?:SEO 설명|SEO 키워드|좌표)$/u;
  const points = academies.length ? academyDistinguishingPoints(academies) : [];
  return String(facts || "")
    .split(/\r?\n/)
    .map((line) => {
      const ordinal = line.match(/^\[(\d+)\]\s+/u);
      if (!ordinal) return line;
      const kept = line.split(" / ")
        .filter((part) => !DROP.test(String(part.split(":")[0] || "").trim()));
      const factLine = distinguishingPointsFactLine(points[Number(ordinal[1]) - 1]);
      if (factLine) kept.push(factLine);
      return kept.join(" / ");
    })
    .join("\n");
}

/**
 * T16 리뷰 지침 — 후기를 **인용으로만** 쓴다.
 *
 * 기본 지침(worker.service 의 reviewInstruction 기본값)은 후기 인상을 카드 첫 문장으로 쓰게 한다.
 * 그건 학원별 개성을 후기에 의존하던 시절의 설계인데, 실측에서 두 가지가 드러났다:
 *  1) 카드 바로 아래 인용과 같은 후기를 요약하게 돼 같은 내용을 두 번 읽힌다.
 *  2) 사실 검증 규칙과 맞물려 "한 수강생은 ~라고 남겼어요" 식 귀속문이 네 카드에 판박이로 깔린다.
 * 개성은 `이 학원이 두드러지는 점`(후보 대조로 계산된 사실)이 맡고, 후기는 원문 인용으로 남긴다.
 */
export function t16ReviewPromptInstruction(): string {
  return [
    "본문에 인용할 수강생 리뷰는 '수강생 리뷰:' 줄로 제공된 실제 수강생 원문 1건이다.",
    "리뷰가 있는 학원은 이 1건만 후보 설명 안에 Markdown 인용(> “원문” — 출처: 운전면허PLUS 실제 수강생 리뷰)으로 그대로 노출한다.",
    "함께 제공되는 '추가 후기(내부 판단용)' 줄의 후기들은 본문에 인용하거나 옮겨 적지 않는다.",
    "테마 요약·재서술·출처 삭제는 금지하며, 작성자·작성일·평점과 제공되지 않은 후기 문구는 쓰거나 만들지 않는다.",
    "리뷰가 없으면 실제 후기처럼 꾸며 쓰지 말고 확인된 사실로만 카드를 쓴다.",
    "카드 소개 산문에서는 후기 내용을 옮기지 않는다 — 후기는 카드 맨 아래 인용으로만 보여주고, 학원의 개성은 확인된 사실의 차이가 만들게 한다.",
    "후기를 '리뷰/후기/수강생 반응' 등 어떤 명칭으로도 가리켜 그 내용을 대신 전달·요약하지 않는다(카드 맨 아래 인용이 출처를 밝힌다).",
  ].join(" ");
}

/** 수강생 리뷰 출처의 표준 표기. 품질 게이트가 이 형태를 정상 콘텐츠로 인정한다. */
const T16_REVIEW_ATTRIBUTION = "출처: 운전면허PLUS 실제 수강생 리뷰";

/**
 * 리뷰 출처 표기를 표준형으로 정규화한다.
 *
 * 공개 출처는 "운전면허PLUS 실제 수강생 리뷰"다. 그런데 모델이 원천 시스템명 `DrivingPlus`(그 자체로
 * 내부 유출 하드 실패 토큰)나 "운전면허 플러스"·"운전면허PLUS 리뷰" 같은 변형을 쓰면 게이트에서
 * 떨어지거나 표기가 흔들린다. 프롬프트로만 강제하지 말고 생성 뒤 여기서 모든 변형을 표준형으로 맞춘다.
 */
export function normalizeT16ReviewAttribution(markdown: string): string {
  const brand = "(?:운전면허\\s*(?:PLUS|플러스)|DrivingPlus)";
  return String(markdown || "")
    .replace(new RegExp(`출처\\s*[:：]?\\s*${brand}\\s*(?:실제\\s*)?(?:수강생\\s*)?(?:리뷰|후기)`, "gu"), T16_REVIEW_ATTRIBUTION)
    .replace(new RegExp(`(?<!출처:\\s)${brand}\\s+(?:실제\\s+)?수강생\\s+(?:리뷰|후기)`, "gu"), T16_REVIEW_ATTRIBUTION);
}
