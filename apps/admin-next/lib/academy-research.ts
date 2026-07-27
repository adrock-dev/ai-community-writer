import { api } from "@/lib/api";

// 학원 심층조사 관리자 API 클라이언트(기존 도메인 API와 분리).

export interface AcademyBaseRow {
  external_id: string;
  name?: string | null;
  region?: string | null;
  address?: string | null;
  phone?: string | null;
  vphone?: string | null;
  academy_type?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  thumb_url?: string | null;
  photos?: string | null;
  seo_title?: string | null;
  seo_keywords?: string | null;
  seo_description?: string | null;
  raw_json?: string | null;
  synced_at?: string | null;
  researched_at?: string | null;
  research_engine?: string | null;
}

export interface StatusDef { code: string; label: string; rank: number }
export type ResearchProvider = "auto" | "codex" | "claude";

export interface ResearchRun {
  id: string;
  scope: string;
  region?: string | null;
  engine?: string | null;
  method?: string | null;
  status: string;
  count_total: number;
  count_done: number;
  error?: string | null;
  /** 실행 결과 요약 JSON 문자열. 동기화는 {matched,total,reviews,cancelled}. */
  result?: string | null;
  /** 1 이면 취소 요청됨. 아직 running 이면 "취소 중"이다. */
  cancel_requested?: number | null;
  started_at: string;
  finished_at?: string | null;
}

export interface ReviewRow {
  id: string;
  platform: string;
  rating?: number | null;
  title?: string | null;
  quote_text: string;
  author_masked?: string | null;
  source_url?: string | null;
  posted_at?: string | null;
  collected_at: string;
}

export interface FieldMetaRow {
  field_key: string;
  status: string;
  source_url?: string | null;
  source_name?: string | null;
  verified_at?: string | null;
  updated_at?: string | null;
}

export interface AcademyFull {
  base: AcademyBaseRow;
  research: Record<string, any> | null;
  courses: Array<Record<string, any>>;
  shuttle_routes: Array<Record<string, any>>;
  reviews: ReviewRow[];
  field_meta: FieldMetaRow[];
}

export const listAcademyResearch = (region?: string, q?: string) => {
  const search = new URLSearchParams();
  if (region) search.set("region", region);
  if (q) search.set("q", q);
  return api<{ count: number; region: string | null; items: AcademyBaseRow[] }>(`/academy-research/list?${search.toString()}`);
};
export const getAcademyResearch = (externalId: string) => api<AcademyFull>(`/academy-research/${encodeURIComponent(externalId)}`);
export const listStatusDefs = () => api<{ items: StatusDef[] }>("/academy-research/status-defs");
export const listResearchRuns = () => api<{ items: ResearchRun[] }>("/academy-research/runs");
// 취소 "요청". 처리 중이던 학원은 마치고 멈추므로 즉시 반영되지는 않는다.
export const cancelResearchRun = (runId: string) =>
  api<{ ok: boolean; run_id: string }>(`/academy-research/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
// 백그라운드 시작만 하고 run_id 를 받는다. 진행률은 listResearchRuns 폴링으로 본다.
export const syncRegion = () => api<{ ok: boolean; run_id?: string; error?: string }>("/academy-research/sync", { method: "POST", body: JSON.stringify({}) });
// 블로그리뷰는 원천 조회가 학원당 10초라 별도 실행으로 분리돼 있다.
export const syncBlogReviews = () => api<{ ok: boolean; run_id?: string; error?: string }>("/academy-research/sync/blog-reviews", { method: "POST", body: JSON.stringify({}) });
export const syncOneAcademy = (externalId: string) => api<{ external_id: string; found: boolean; reviews: number }>(`/academy-research/${encodeURIComponent(externalId)}/sync`, { method: "POST" });
export const researchOneAcademy = (externalId: string, provider: ResearchProvider = "auto") => api<{ ok: boolean; external_id: string; provider?: string; error?: string; no_sources?: boolean; sources?: number }>(`/academy-research/${encodeURIComponent(externalId)}/research`, { method: "POST", body: JSON.stringify({ provider }) });
export const researchRegion = (provider: ResearchProvider = "auto") => api<{ ok: boolean; run_id?: string; count?: number; error?: string }>("/academy-research/research/region", { method: "POST", body: JSON.stringify({ provider }) });
export const updateResearchField = (externalId: string, field: string, value: unknown) => api<{ ok: boolean }>(`/academy-research/${encodeURIComponent(externalId)}/field`, { method: "PATCH", body: JSON.stringify({ field, value }) });
export const setResearchFieldMeta = (externalId: string, body: { field_key: string; status?: string; source_url?: string; note?: string }) => api<{ ok: boolean }>(`/academy-research/${encodeURIComponent(externalId)}/field-meta`, { method: "PATCH", body: JSON.stringify(body) });

// 조사 스칼라 필드 라벨(상세 편집 UI 순서)
export const RESEARCH_FIELD_LABELS: Array<{ key: string; label: string }> = [
  { key: "name_researched", label: "이름(재조사)" },
  { key: "address_researched", label: "주소(재조사)" },
  { key: "phone_researched", label: "전화(재조사)" },
  { key: "gu", label: "구/군" },
  { key: "dong", label: "동" },
  { key: "jibun_address", label: "지번주소" },
  { key: "hours", label: "운영/교육시간" },
  { key: "night_class", label: "야간반" },
  { key: "weekend", label: "주말운영" },
  { key: "closed_days", label: "휴무일" },
  { key: "shuttle_available", label: "셔틀 운행여부" },
  { key: "shuttle_summary", label: "셔틀 요약" },
  { key: "licenses", label: "취급면허" },
  { key: "self_test", label: "자체시험장" },
  { key: "facilities", label: "설비" },
  { key: "fee_summary", label: "가격요약" },
  { key: "price_disclosed", label: "가격공개" },
  { key: "pass_rate", label: "합격률" },
  { key: "pass_rate_scope", label: "합격률 근거" },
  { key: "established_year", label: "설립연도" },
  { key: "scale", label: "규모" },
  { key: "homepage_url", label: "홈페이지" },
  { key: "naver_place_url", label: "네이버플레이스" },
  { key: "kakao_url", label: "카카오맵" },
];
