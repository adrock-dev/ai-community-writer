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
  상담전확인: { angle: "상담 전에 정리해 둘 그 학원의 기본 정보", summaryColumn: null, requires: ["course"], focus: "각 학원에서 상담 때 확인할 점", fallback: null },
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
  과정선택: { question: "이 지역에서 딸 수 있는 면허 과정과 그 차이", requires: ["course"], fallback: null, subtitle: "면허 과정 고르기" },
  학원유형: { question: "전문학원과 일반학원의 차이와 고르는 기준", requires: ["academyType"], fallback: "과정선택", subtitle: "전문학원 차이까지" },
  비용구성: { question: "수강료에 무엇이 포함되고 무엇이 따로인지", requires: ["price"], fallback: "과정선택", subtitle: "수강료 구성 확인" },
  후기확인: { question: "수강생 반응에서 확인할 수 있는 점", requires: ["review"], fallback: "과정선택", subtitle: "수강생 후기로 확인하는" },
  일정확인: { question: "언제 다닐 수 있는지(운영 요일·시간)", requires: ["hours"], fallback: "과정선택", subtitle: "운영 시간까지" },
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

export function buildT16AxisPlan(slot: Row, academies: Row[]): T16AxisPlan {
  const demoted: string[] = [];
  const rawModifier = String(slot.modifier_1 || "").trim() || "상담전확인";
  const rawIntent = String(slot.intent || "").trim() || "과정선택";
  const mod = resolveWithFallback(T16_MODIFIERS, rawModifier, academies, demoted);
  const int = resolveWithFallback(T16_INTENTS, rawIntent, academies, demoted);
  // 요약표 추가 열. 학원명·실제 소재지·운영 과정은 항상 들어가므로 걸러내 중복을 막는다.
  const summaryColumns = [mod.spec.summaryColumn]
    .filter((column): column is string => Boolean(column) && !["실제 소재지", "학원명", "운영 과정"].includes(column!));
  return {
    modifier: mod.key,
    intent: int.key,
    angle: mod.spec.angle,
    summaryColumns,
    focus: mod.spec.focus,
    question: int.spec.question,
    subtitle: `${modifierSubtitle(mod.key)} ${int.spec.subtitle}`.replace(/\s+/g, " ").trim(),
    demoted,
  };
}

// 제목 부제 앞부분(modifier). "비교"라는 단어를 쓰지 않는다 — 정량 비교 프레이밍을 유발했다.
function modifierSubtitle(modifier: string): string {
  const map: Record<string, string> = {
    비용절약: "수강료와 과정",
    셔틀편리: "셔틀 운행 지역",
    야간반: "야간 운영",
    주말반: "주말 운영",
    상담전확인: "상담 전 확인",
    가까운: "위치와 동선",
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
      ? `- 학원 요약표: 후보가 ${academyCount}곳이라 정보가 많으므로, ${summaryCols.join(" · ")} 열로 한눈에 볼 수 있는 요약표를 하나 둔다. 이것은 우열을 매기는 비교표가 아니라 각 학원의 확인된 정보를 모아 보여주는 요약표다. 글의 중심은 여전히 각 학원 소개이고, 요약표는 그 소개를 훑어보게 돕는 보조 도구다. 값이 없는 열·칸은 비우거나 뺀다. 전체 주소·전화번호는 요약표 열로 쓰지 않는다.`
      : `- 학원 요약표: ${summaryCols.join(" · ")} 열의 짧은 요약표를 하나 둔다. 후보가 ${academyCount}곳으로 적으니 표는 각 학원 소개를 보조하는 정보 요약일 뿐이고, 글의 중심은 각 학원 소개다. 우열을 매기는 비교표로 만들지 않는다. 값이 없는 칸은 비운다.`,
    `- 강조 섹션: "${plan.focus}"을 주제로 한 섹션을 하나 둔다. 확인된 자료 범위 안에서만 쓴다.`,
    `- 필수 응답: 이 글은 "${plan.question}"에 답한다. 제공된 자료로 답할 수 있는 만큼만 쓰고, 모자라면 상담에서 확인할 질문으로 남긴다.`,
    persona ? `- 독자: 이 글의 독자는 "${persona}"다. 도입에서 그 상황을 구체적으로 그리고, 안내의 순서를 그 상황에 맞추며, 마무리에서 어떤 상황이면 어느 학원을 먼저 살펴보면 좋을지 확인된 사실에 근거해 연결한다. 자료로 뒷받침되지 않는 추천은 만들지 않는다.` : "",
    "- 후보는 이 지역을 기준으로 다닐 수 있는 범위에서 골랐다. 도입에서 그 범위를 한 문장으로만 밝히고, 이후에는 반복하지 않는다.",
    "- 실제 소재지가 대상 지역과 다른 학원도 별도 후보군이나 섹션으로 나누지 않는다. 해당 학원 소개에 실제 지역만 사실대로 적는다.",
    "- `13.2km`, `약 Nkm` 같은 거리 수치와 직선거리·도로거리·이동시간·통학 편의·접근성 우위 단정은 쓰지 않는다.",
    "- 대중교통 노선·도보 시간·주차 여부는 확인된 자료가 없으므로 쓰지 않고, 필요하면 상담 확인 질문으로만 남긴다.",
  ].filter(Boolean).join("\n");
}

/**
 * T16 전용 문체 지침 — 스토리텔링·친절한 블로그 톤.
 *
 * buildPrompt 의 기본 문체만 받으면 후보 소개가 "~으로, ~과정을 운영합니다. 실제 소재지는
 * ~이며…" 식 사실 나열 보고서가 된다(실측). Legacy Plus 의 writingGuide(t01-legacy-plus.ts)에
 * 검증된 스토리텔링·공감 요소가 있지만 "다른 지역인데도 후보가 되는 이유" 같은 T01 인근-후보
 * 서사가 섞여 있어 그대로 쓰면 T16 계약(지역군 분리 금지·거리 단정 금지)과 충돌한다.
 * 그래서 그 요소만 추려 T16 맥락으로 다시 쓴다. slot.persona 를 도입 예시에 직접 엮는다.
 */
export function t16WritingGuide(slot: Row): string {
  const persona = String(slot.persona || "").trim();
  const openingExample = persona
    ? `예: "${persona}"라면 무엇부터 봐야 할지 고민되실 텐데요, 그 순서를 함께 정리해 봤습니다.`
    : "예: 어디부터 봐야 할지 고민되실 텐데요, 그 순서를 함께 정리해 봤습니다.";
  return [
    `- 도입은 검색어를 그대로 반복하지 말고, 독자가 실제로 처한 상황과 궁금증에서 연다. ${openingExample} 고를 항목이 많아 판단이 쉽지 않다는 점에 짧게 공감한 뒤 이 글에서 볼 기준과 후보로 이어 간다.`,
    "- 정보를 기계적으로 정리하는 보고서가 아니라, 독자의 고민을 이해하고 선택을 돕는 친근한 블로그 에디터의 톤으로 쓴다. 독자에게 말을 거는 표현을 실제로 쓴다. 예: \"이 부분이 궁금하실 텐데요\", \"처음이라면 여기부터 확인해 보세요\", \"가격만 보고 정하기 전에 함께 볼 항목이 있어요\". 독자를 \"여러분\"으로 불러도 되지만 문단마다 반복하지 않는다.",
    "- 후보 소개는 \"과정을 운영합니다 / 실제 소재지는 ~입니다\" 식으로 사실만 나열하지 않는다. 각 학원에서 실제로 확인된 사실이 그 독자에게 어떤 의미인지 한 문장으로 이어 준다. 모든 후보를 같은 문장 구조로 시작하지 않는다.",
    "- 종결은 \"-습니다\"에 \"-해요\"·\"-인데요\"·\"-거든요\"를 자연스럽게 섞고, 같은 종결을 세 문장 이상 연속으로 쓰지 않는다. 다만 전체를 가벼운 구어체로 만들거나 감탄사·이모지를 쓰지는 않는다.",
    "- 굵게(**) 표시는 핵심 학원명·비용·과정에만 아껴 쓴다. 문장 대부분을 굵게 만들지 않는다.",
    "- 독자의 상황(처음이라 걱정됨, 고를 항목이 많아 고민됨, 일정·비용이 빠듯함)에는 공감할 수 있다. 다만 학원에 대한 감정적 평가는 자료에 근거가 있을 때만 쓴다. 가상의 수강생·방문·상담 경험을 만들거나 글쓴이가 직접 다녀온 것처럼 쓰지 않는다.",
  ].join("\n");
}

/** 구조 지침에 축이 정한 관점·주제·질문을 덧붙인다. */
export function t16StructureGuide(baseGuide: string, plan: T16AxisPlan): string {
  return [
    baseGuide,
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
 */
export function t16FactsForPrompt(facts: string): string {
  const DROP = /^(?:SEO 설명|SEO 키워드|좌표)$/u;
  return String(facts || "")
    .split(/\r?\n/)
    .map((line) => {
      if (!/^\[\d+\]\s+/u.test(line)) return line;
      return line.split(" / ")
        .filter((part) => !DROP.test(String(part.split(":")[0] || "").trim()))
        .join(" / ");
    })
    .join("\n");
}

/** 수강생 리뷰 출처의 표준 표기. 품질 게이트가 이 형태만 내부 유출 검사에서 면제한다. */
const T16_REVIEW_ATTRIBUTION = "출처: DrivingPlus 수강생 리뷰";

/**
 * 리뷰 출처 표기를 표준형으로 정규화한다.
 *
 * `DrivingPlus` 는 그 자체로 하드 실패 토큰이고(quality-gate `exposes_internal_fact_language`),
 * 면제는 정규식 완전 일치 하나뿐이다. 모델이 "출처: DrivingPlus 리뷰" 처럼 한 글자만 다르게 써도
 * 글 전체가 게이트에서 떨어진다. 프롬프트로만 강제하지 말고 생성 뒤 여기서 표기를 맞춘다.
 */
export function normalizeT16ReviewAttribution(markdown: string): string {
  return String(markdown || "")
    .replace(/출처\s*[:：]?\s*DrivingPlus\s*(?:수강생\s*)?(?:리뷰|후기)/gu, T16_REVIEW_ATTRIBUTION)
    .replace(/(?<!출처:\s)DrivingPlus\s+수강생\s+(?:리뷰|후기)/gu, T16_REVIEW_ATTRIBUTION);
}
