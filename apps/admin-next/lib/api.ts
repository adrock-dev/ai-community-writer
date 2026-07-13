import type { AcademyListPayload, AdminOptions, Axis, AxisValue, SlotListPayload, DomainDetailPayload, RuntimeApis, CustomTemplate, CoherenceReport } from "./types";

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
export const listSlots = (domain: string, params: { status?: string; template?: string; q?: string; limit?: number; offset?: number } = {}) => {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.template) search.set("template", params.template);
  if (params.q) search.set("q", params.q);
  search.set("limit", String(params.limit ?? 1000));
  if (params.offset) search.set("offset", String(params.offset));
  return api<SlotListPayload>(`/domains/${encodeURIComponent(domain)}/slots?${search.toString()}`);
};
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
export const suggestTemplateAxes = (domain: string, body: { kind: string; name?: string; direction?: string; axes: string[]; provider?: string; model?: string }) =>
  api<{ ok: true; suggestions: { persona?: string[]; intent?: string[]; modifier?: string[] }; provider: string; model: string }>(`/domains/${encodeURIComponent(domain)}/templates/suggest-axes`, { method: "POST", body: JSON.stringify(body) });
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
export const syncDrivingplusRegions = (domain: string, body: { level?: "all" | "2" | "3"; replace_axis?: boolean; max?: number }) =>
  api<{ ok: true; level: string; axis_replaced: boolean; fetched: number; upserted: number; skipped: number }>(`/domains/${encodeURIComponent(domain)}/sync/drivingplus/regions`, { method: "POST", body: JSON.stringify(body) });
