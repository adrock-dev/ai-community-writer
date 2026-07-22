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
  if (!res.ok) {
    const message = typeof data?.detail === "string" ? data.detail : typeof data?.message === "string" ? data.message : `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return data as T;
}

function safeJson(text: string): any {
  try { return JSON.parse(text); } catch { return text; }
}

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
    const data = text ? safeJson(text) : null;
    const message = typeof data?.message === "string" ? data.message : text || `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return res.blob();
}
export const syncDrivingplusAcademies = (domain: string, body: { include_reviews?: boolean; review_limit?: number; review_sort?: "new" | "point"; include_blog_reviews?: boolean; blog_review_limit?: number } = { include_reviews: true, review_limit: 5, review_sort: "point", include_blog_reviews: true, blog_review_limit: 3 }) =>
  api<{ ok: true; fetched: number; upserted: number; skipped: number; review_count: number; blog_review_count: number; warnings?: string[] }>(`/domains/${encodeURIComponent(domain)}/sync/drivingplus/academies`, { method: "POST", body: JSON.stringify(body) });
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
