import type { AcademyListPayload, AdminOptions, Axis, AxisValue, SlotListPayload, DomainDetailPayload, RuntimeApis, CustomTemplate, CoherenceReport, Vertical } from "./types";

export const listVerticals = () => api<{ items: Vertical[] }>("/settings/verticals");
export const addVertical = (key: string, label: string) => api<{ ok: true; items: Vertical[] }>("/settings/verticals", { method: "POST", body: JSON.stringify({ key, label }) });
export const deleteVertical = (key: string) => api<{ ok: true; items: Vertical[] }>(`/settings/verticals/${encodeURIComponent(key)}`, { method: "DELETE" });

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) throw new Error(errorMessage(data, res));
  return data as T;
}

// 사람이 읽을 수 있는 message 를 우선하고, 원문(detail)은 괄호로 덧붙인다.
// detail 을 먼저 쓰면 프록시가 만든 "콘텐츠 API에 연결할 수 없습니다" 안내가 undici 의 "fetch failed" 에 가려진다.
export function errorMessage(data: any, res: { status: number; statusText: string }): string {
  const message = typeof data?.message === "string" && data.message.trim() ? data.message.trim() : "";
  const detail = typeof data?.detail === "string" && data.detail.trim() ? data.detail.trim() : "";
  if (message && detail && detail !== message) return `${message} (${detail})`;
  if (message) return message;
  if (detail) return detail;
  if (typeof data === "string" && data.trim()) return data.trim();
  return `${res.status} ${res.statusText}`;
}

function safeJson(text: string): any {
  try { return JSON.parse(text); } catch { return text; }
}

/**
 * 블로그리뷰 "수집" 스위치. `used_in_generation` 은 항상 false 다 — 켜도 글 생성에는 쓰이지 않는다.
 * 화면이 그 사실을 서버 응답으로 확인해 문구를 쓰도록 필드로 내려받는다(주석에만 적어두면 어긋난다).
 */
export type BlogReviewSyncSetting = { enabled: boolean; configured: boolean; used_in_generation: boolean };
export const getBlogReviewSync = () => api<BlogReviewSyncSetting>("/settings/blog-review-sync");
export const saveBlogReviewSync = (enabled: boolean) =>
  api<{ ok: true } & BlogReviewSyncSetting>("/settings/blog-review-sync", { method: "PUT", body: JSON.stringify({ enabled }) });

export const getOptions = () => api<AdminOptions>("/options");
// 전역 빌트인 노출 목록 저장(검증용 임시). null = 전체 노출로 초기화.
export const setBuiltinVisibility = (exposed: string[] | null) =>
  api<{ ok: true; exposed_builtin_template_ids: string[] | null }>("/settings/builtin-visibility", { method: "PUT", body: JSON.stringify({ exposed }) });
export const getRuntimeApis = () => api<RuntimeApis>("/runtime/apis");
export const listDomains = () => api<{ count: number; items: import("./types").DomainConfig[] }>("/domains");
export const getDomainDetail = (domain: string, include = "slots,posts,academies,jobs") =>
  api<DomainDetailPayload>(`/domains/${encodeURIComponent(domain)}?include=${include}&limit=500`);
export const cancelJob = (id: string) => api<{ ok: boolean; state?: string }>(`/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" });
export const pauseJob = (id: string) => api<{ ok: boolean }>(`/jobs/${encodeURIComponent(id)}/pause`, { method: "POST" });
export const resumeJob = (id: string) => api<{ ok: boolean }>(`/jobs/${encodeURIComponent(id)}/resume`, { method: "POST" });
export const prioritizeJob = (id: string) => api<{ ok: boolean }>(`/jobs/${encodeURIComponent(id)}/prioritize`, { method: "POST" });
export const listPosts = (domain: string, params: { status?: string; jobId?: string; limit?: number } = {}) => {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.jobId) search.set("job_id", params.jobId);
  search.set("limit", String(params.limit ?? 500));
  return api<{ count: number; items: import("./types").PostSummary[] }>(`/domains/${encodeURIComponent(domain)}/posts?${search}`);
};
// 격리(draft) 검수 API
export const listDrafts = (domain: string, params: { status?: string; limit?: number } = {}) => {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  search.set("limit", String(params.limit ?? 500));
  return api<import("./types").DraftListPayload>(`/domains/${encodeURIComponent(domain)}/drafts?${search}`);
};
export const getDraft = (domain: string, draftId: string) =>
  api<{ draft: import("./types").DraftDetail; body_html?: string }>(`/domains/${encodeURIComponent(domain)}/drafts/${encodeURIComponent(draftId)}?include_rendered=true`);
export const promoteDraft = (domain: string, draftId: string) =>
  api<{ ok: true; post_id: string }>(`/domains/${encodeURIComponent(domain)}/drafts/${encodeURIComponent(draftId)}/promote`, { method: "POST" });
export const revalidateDraft = (domain: string, draftId: string, bodyMarkdown?: string) =>
  api<{ ok: true; quality_issues: import("./types").DraftIssue[]; blocking_class: import("./types").IssueSeverityClass; promotable: boolean }>(
    `/domains/${encodeURIComponent(domain)}/drafts/${encodeURIComponent(draftId)}/revalidate`,
    { method: "POST", body: JSON.stringify(bodyMarkdown !== undefined ? { body_markdown: bodyMarkdown } : {}) });
export const dismissDraft = (domain: string, draftId: string) =>
  api<{ ok: true }>(`/domains/${encodeURIComponent(domain)}/drafts/${encodeURIComponent(draftId)}/dismiss`, { method: "POST" });
export const deleteDraft = (domain: string, draftId: string) =>
  api<{ ok: true }>(`/domains/${encodeURIComponent(domain)}/drafts/${encodeURIComponent(draftId)}`, { method: "DELETE" });

export const listSlots = (domain: string, params: { status?: string; template?: string; q?: string; limit?: number; offset?: number } = {}) => {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.template) search.set("template", params.template);
  if (params.q) search.set("q", params.q);
  search.set("limit", String(params.limit ?? 1000));
  if (params.offset) search.set("offset", String(params.offset));
  return api<SlotListPayload>(`/domains/${encodeURIComponent(domain)}/slots?${search.toString()}`);
};
// 슬롯 수동 제목 오버라이드 저장. title=null 이면 규칙/LLM 로 폴백.
export const updateSlotTitle = (domain: string, slotId: string, title: string | null) =>
  api<{ ok: true; slot: import("./types").Slot }>(`/domains/${encodeURIComponent(domain)}/slots/${encodeURIComponent(slotId)}`, { method: "PATCH", body: JSON.stringify({ title }) });
export const listAcademies = (domain: string, params: { region?: string; academy_type?: string; q?: string; has_photos?: boolean; limit?: number } = {}) => {
  const search = new URLSearchParams();
  if (params.region) search.set("region", params.region);
  if (params.academy_type) search.set("academy_type", params.academy_type);
  if (params.q) search.set("q", params.q);
  if (params.has_photos) search.set("has_photos", "1");
  search.set("limit", String(params.limit ?? 500));
  return api<AcademyListPayload>(`/domains/${encodeURIComponent(domain)}/academies?${search.toString()}`);
};
export const updateDomain = (domain: string, body: Record<string, unknown>) =>
  api<{ ok: true; domain: import("./types").DomainConfig }>(`/domains/${encodeURIComponent(domain)}`, { method: "PATCH", body: JSON.stringify(body) });
// --- 커스텀 글유형(custom_templates) + coherence (Phase 2b-2~P3 백엔드) ---
export const listTemplates = (domain: string) =>
  api<{ builtin: Array<Record<string, unknown>>; custom: CustomTemplate[] }>(`/domains/${encodeURIComponent(domain)}/templates`);
export const createTemplate = (domain: string, body: Partial<CustomTemplate>) =>
  api<{ ok: true; template: CustomTemplate }>(`/domains/${encodeURIComponent(domain)}/templates`, { method: "POST", body: JSON.stringify(body) });
export const cloneTemplate = (domain: string, body: { source_template_id: string; name?: string; overrides?: Record<string, unknown> }) =>
  api<{ ok: true; template: CustomTemplate; source_template_id: string }>(`/domains/${encodeURIComponent(domain)}/templates/clone`, { method: "POST", body: JSON.stringify(body) });
export const updateTemplate = (domain: string, templateId: string, body: Partial<CustomTemplate>) =>
  api<{ ok: true; template: CustomTemplate }>(`/domains/${encodeURIComponent(domain)}/templates/${encodeURIComponent(templateId)}`, { method: "PATCH", body: JSON.stringify(body) });
export const deleteTemplate = (domain: string, templateId: string) =>
  api<{ ok: true; deleted: string }>(`/domains/${encodeURIComponent(domain)}/templates/${encodeURIComponent(templateId)}`, { method: "DELETE" });
export const getAcademyCoverage = (domain: string, templateId: string) =>
  api<import("./types").AcademyCoverage>(`/domains/${encodeURIComponent(domain)}/templates/${encodeURIComponent(templateId)}/academy-coverage`);
export const suggestTemplateAxes = (domain: string, body: { kind: string; name?: string; direction?: string; keywords?: string[]; axes: string[]; provider?: string; model?: string }) =>
  api<{ ok: true; suggestions: { persona?: string[]; intent?: string[]; modifier?: string[] }; provider: string; model: string }>(`/domains/${encodeURIComponent(domain)}/templates/suggest-axes`, { method: "POST", body: JSON.stringify(body) });
export type DirectionValidation = { redundant: Array<{ text: string; overlaps: string }>; conflicting: Array<{ text: string; reason: string }>; suggested_direction: string; summary: string };
export const validateTemplateDirection = (domain: string, body: { kind: string; name?: string; direction: string; current_direction?: string; has_academy?: boolean; provider?: string; model?: string }) =>
  api<{ ok: true; validation: DirectionValidation; provider: string; model: string }>(`/domains/${encodeURIComponent(domain)}/templates/validate-direction`, { method: "POST", body: JSON.stringify(body) });
export const exportTemplates = (domain: string) =>
  api<Record<string, unknown>>(`/domains/${encodeURIComponent(domain)}/templates/export`);
export const importTemplates = (domain: string, envelope: Record<string, unknown>, mode?: "merge" | "replace") =>
  api<{ ok: true; mode: string; imported: number; skipped: number; overrides_merged: number; templates_enabled?: string[]; warnings: string[] }>(
    `/domains/${encodeURIComponent(domain)}/templates/import${mode ? `?mode=${mode}` : ""}`, { method: "POST", body: JSON.stringify(envelope) });
export const getCoherence = (domain: string) =>
  api<CoherenceReport>(`/domains/${encodeURIComponent(domain)}/templates/coherence`);

export const replaceAxis = (domain: string, axis: Axis, values: AxisValue[]) =>
  api<{ ok: true }>(`/domains/${encodeURIComponent(domain)}/axes/${axis}`, { method: "PUT", body: JSON.stringify({ values }) });
export const enqueueGenerate = (domain: string, body: Record<string, unknown>) =>
  api<{ ok: true; job_id: string; slot_count?: number }>(`/domains/${encodeURIComponent(domain)}/jobs/generate`, { method: "POST", body: JSON.stringify(body) });
export async function downloadPostExport(domain: string, body: { post_ids: string[]; format: "markdown" | "html" }): Promise<Blob> {
  const res = await fetch(`/api/admin/domains/${encodeURIComponent(domain)}/posts/export`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(errorMessage(text ? safeJson(text) : null, res));
  }
  return res.blob();
}
export interface ResearchSummary {
  domain: string; total: number; matched: number; researched: number;
  /** 글에 실릴 수 있는 항목에 값이 하나라도 있는 학원 수. researched 는 교차검증 항목만 채워진 곳도 센다. */
  article_ready: number;
  /** 조사했지만 값이 없는 자리 — 할 일이 달라 나눠 센다(근거 없음은 다시 돌려도 대개 그대로). */
  no_sources: number; failed: number; unattempted: number;
  /** 둘 다 글에 실릴 수 있는 항목·연결 중인 학원만 센다(자료관리 검토 대기와 같은 기준). */
  needs_review: number; verified: number;
  last_researched_at: string | null;
  /** 조사값·검증상태가 마지막으로 바뀐 시각. linked_at 보다 새로우면 아직 도메인에 반영되지 않았다. */
  last_changed_at: string | null;
  /** 위 두 시각의 판정 결과. 두 DB 의 시각 형식이 달라 화면이 직접 견주지 않는다(서버 link-freshness). */
  pending_link: boolean;
  /** 이 도메인에 마지막으로 연결한 시각(academies.synced_at 최댓값). */
  linked_at: string | null;
}
// 심층조사는 도메인이 아니라 학원 자체의 속성이라 실행은 자료관리(전역)에서 한다.
// 도메인 화면에는 현황만 보여주고 실행 버튼은 두지 않는다.
export const getResearchSummary = (domain: string) =>
  api<ResearchSummary>(`/domains/${encodeURIComponent(domain)}/research-summary`);

/**
 * 학원 동기화 시작. 결과가 아니라 run_id 를 돌려준다. 지금은 자체 후기만 받아 1~2분이지만,
 * 블로그리뷰 수집을 켜면 12분이 넘어 응답을 기다리는 방식으로는 완주할 수 없다(Node fetch 가 300초에 끊는다).
 * 진행 상황은 getSyncRun 으로 폴링한다.
 */
/**
 * 블로그리뷰 수집 여부(`include_blog_reviews`)는 **의도적으로 받지 않는다.**
 * 서버가 스위치로 판단하므로(설정 → 환경변수 → 꺼짐) 화면이 중계할 이유가 없고, 중계하면 화면이
 * 아직 상태를 못 읽은 시점에 false 가 나가 스위치가 켜져 있어도 수집을 건너뛴다(239f4a1 회귀).
 * 타입에서 빼 두면 되살리려는 순간 컴파일이 막는다.
 */
export interface AcademyLinkResult {
  linked: number; skipped: number; removed: number; excluded: number; reviews: number; blog_reviews: number;
  research_applied: number; research_usage: string; warnings: string[];
}

export interface AcademyExclusion { external_id: string; name?: string | null; created_at?: string | null }
// 이 도메인에서 빼기로 한 학원 목록. 조사 DB 는 건드리지 않으므로 다른 도메인에는 영향이 없다.
export const listAcademyExclusions = (domain: string) =>
  api<{ count: number; items: AcademyExclusion[] }>(`/domains/${encodeURIComponent(domain)}/academy-exclusions`);
// 해제하면 그 자리에서 다시 연결된다. relinked=false 면 reason 을 그대로 보여준다.
export const unexcludeAcademy = (domain: string, externalId: string) =>
  api<{ ok: true; removed: number; relinked: boolean; reason?: string }>(`/domains/${encodeURIComponent(domain)}/academy-exclusions/${encodeURIComponent(externalId)}`, { method: "DELETE" });
// 학원자료 연결 — 원천 API 를 다시 치지 않고, 「운전학원 자료」가 이미 받아 둔 자료를 가져온다.
export const linkAcademies = (domain: string) =>
  api<AcademyLinkResult>(`/domains/${encodeURIComponent(domain)}/academies/link`, { method: "POST" });

export const syncDrivingplusAcademies = (domain: string, body: { include_reviews?: boolean; review_limit?: number; review_sort?: "new" | "point"; blog_review_limit?: number } = { include_reviews: true, review_limit: 5, review_sort: "point" }) =>
  api<{ ok: true; run_id: string }>(`/domains/${encodeURIComponent(domain)}/sync/drivingplus/academies`, { method: "POST", body: JSON.stringify(body) });

export type SyncRunResult = { fetched: number; upserted: number; skipped: number; review_count: number; blog_review_count: number; blog_review_preserved: number; warnings: string[] };
export type SyncRun = {
  id: string;
  domain: string;
  scope: string;
  status: "running" | "done" | "cancelled" | "error";
  cancel_requested: boolean;
  step: string | null;
  count_total: number;
  count_done: number;
  result_obj: SyncRunResult | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};
export const getSyncRun = (domain: string, runId: string) =>
  api<SyncRun>(`/domains/${encodeURIComponent(domain)}/sync/runs/${encodeURIComponent(runId)}`);
export const listSyncRuns = (domain: string, limit = 20) =>
  api<{ items: SyncRun[] }>(`/domains/${encodeURIComponent(domain)}/sync/runs?limit=${limit}`);
export const cancelSyncRun = (domain: string, runId: string) =>
  api<{ ok: boolean }>(`/domains/${encodeURIComponent(domain)}/sync/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
// 원천 표를 학원 행보다 나중에 받았는지. 학원의 지역 배정·셔틀 운행 지역은 「학원자료 연결」
// 시점에 계산되므로, 사전·지역 목록만 새로 받으면 학원 행이 옛 값으로 남는다.
export type SourceFreshness = {
  academies_synced_at: string | null;
  region_directory_synced_at: string | null;
  seo_regions_synced_at: string | null;
  region_directory_ahead: boolean;
  seo_regions_ahead: boolean;
};
export const getSourceFreshness = (domain: string) =>
  api<SourceFreshness>(`/domains/${encodeURIComponent(domain)}/source-freshness`);
// 전역 행정구역 사전(region_directory). 도메인별이 아니라 모든 도메인이 같은 표를 본다.
// domain 을 넘기면 그 도메인에서 사전이 실제로 얼마나 쓰이는지(셔틀 운행 지역 매칭) 함께 받는다.
export type RegionDirectoryStatus = {
  total: number;
  by_level: Record<string, number>;
  synced_at: string | null;
  shuttle?: { with_shuttle: number; with_region: number };
};
export const getRegionDirectory = (domain?: string) =>
  api<RegionDirectoryStatus>(`/settings/region-directory${domain ? `?domain=${encodeURIComponent(domain)}` : ""}`);
export const syncRegionDirectory = (domain?: string) =>
  api<RegionDirectoryStatus & { ok: true; fetched: number; upserted: number; skipped: number }>("/settings/region-directory/sync", { method: "POST", body: JSON.stringify(domain ? { domain } : {}) });
export const syncDrivingplusRegions = (domain: string, body: { level?: "all" | "2" | "3"; replace_axis?: boolean; max?: number }) =>
  api<{ ok: true; level: string; axis_replaced: boolean; fetched: number; upserted: number; skipped: number }>(`/domains/${encodeURIComponent(domain)}/sync/drivingplus/regions`, { method: "POST", body: JSON.stringify(body) });
