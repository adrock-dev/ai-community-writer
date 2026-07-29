// 조사값을 글 생성의 근거로 쓸지 정하는 정책.
//
// 조사값은 공개 웹에서 모은 미검증 자료라 원천 데이터와 같은 취급을 할 수 없다.
// 그래서 "무엇을 저장하느냐"(조사)와 "무엇을 글에 쓰느냐"(이 정책)를 분리한다.
// 승인 도구는 새로 만들지 않는다 — 이미 있는 필드 검증상태(academy_field_meta.status)가
// 그대로 관문이 된다. 관리자가 검증완료로 올리는 행위가 곧 글에 쓰도록 승인하는 행위다.

export const RESEARCH_USAGE_MODES = ["off", "verified", "draft"] as const;
export type ResearchUsageMode = (typeof RESEARCH_USAGE_MODES)[number];

export const DEFAULT_RESEARCH_USAGE: ResearchUsageMode = "off";

export const RESEARCH_USAGE_LABELS: Record<ResearchUsageMode, string> = {
  off: "사용 안 함",
  verified: "검증완료만 사용",
  draft: "AI 초안까지 사용",
};

/**
 * 어떤 설정에서도 글에 쓰이지 않는 상태.
 * - needs_review: 그라운딩 검사에 걸린 값(소스에 근거가 없거나 그 필드에 담기면 안 되는 값)
 * - unverified: 조사가 채우지 않은 자리(사람이 손대기 전)
 */
const NEVER_USABLE = new Set(["needs_review", "unverified"]);

export function parseResearchUsage(value: unknown): ResearchUsageMode {
  const raw = String(value ?? "").trim();
  return (RESEARCH_USAGE_MODES as readonly string[]).includes(raw) ? (raw as ResearchUsageMode) : DEFAULT_RESEARCH_USAGE;
}

/** 이 필드값을 글 생성의 근거로 넘겨도 되는가. */
export function researchValueUsable(mode: ResearchUsageMode, status: unknown): boolean {
  if (mode === "off") return false;
  const code = String(status ?? "").trim();
  if (NEVER_USABLE.has(code)) return false;
  if (mode === "verified") return code === "verified";
  // draft: 검증완료 + AI 초안까지. 그 밖의 알 수 없는 상태는 보수적으로 제외한다.
  return code === "verified" || code === "ai_draft";
}
