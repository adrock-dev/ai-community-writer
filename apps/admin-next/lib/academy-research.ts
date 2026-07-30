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
  /** 'drivingplus'(원천 동기화) 또는 'manual'(직접 등록). 수동분만 삭제할 수 있다. */
  source?: string | null;
  synced_at?: string | null;
  researched_at?: string | null;
  research_engine?: string | null;
  /** 마지막 조사 시도 결과. researched_at은 실제 값 저장 성공일 때만 채워진다. */
  last_attempted_at?: string | null;
  last_attempt_outcome?: "saved" | "no_sources" | "failed" | null;
  last_attempt_error?: string | null;
}

export interface StatusDef { code: string; label: string; rank: number }
export type ResearchProvider = "auto" | "codex" | "claude";

export interface ResearchRun {
  id: string;
  /** 'sync' | 'sync_blog' | 'all'(전체 조사) | 'single'(학원 1곳 조사) */
  scope: string;
  /** scope='single' 일 때 대상 학원. */
  external_id?: string | null;
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
  /** 조사 결과에 대한 사유(검사 지적·조사 제외 사유). 화면에 그대로 보여준다. */
  note?: string | null;
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
  /** 원천이 이미 답을 가진 항목(조사에서 뺀 값). 생성 프롬프트에 들어가는 문장과 같다. */
  source_facts?: string[];
}

export const listAcademyResearch = (region?: string, q?: string) => {
  const search = new URLSearchParams();
  if (region) search.set("region", region);
  if (q) search.set("q", q);
  // hidden: 최신 동기화 목록에 없어 제외된 학원 수(보관은 하되 노출하지 않는다).
  return api<{ count: number; region: string | null; items: AcademyBaseRow[]; hidden?: number }>(`/academy-research/list?${search.toString()}`);
};
export const getAcademyResearch = (externalId: string) => api<AcademyFull>(`/academy-research/${encodeURIComponent(externalId)}`);
export interface ReviewQueueRow {
  external_id: string;
  name?: string | null;
  address?: string | null;
  field_key: string;
  status: string;
  value?: string | null;
  note?: string | null;
  source_url?: string | null;
  updated_at?: string | null;
}
// 검토 대기 — 학원을 가로질러 필드 단위로 모은다. 사용 관문이 "사람이 검증완료로 올린 값만
// 쓴다" 인데 대기 중인 필드를 찾을 화면이 없으면 380곳을 하나씩 열어야 한다.
export const listReviewQueue = (opts: { status?: string; field?: string; allFields?: boolean; q?: string; limit?: number } = {}) => {
  const search = new URLSearchParams();
  if (opts.status) search.set("status", opts.status);
  if (opts.field) search.set("field", opts.field);
  // 기본은 글에 나갈 수 있는 항목만 본다(원천 교차검증용 항목은 승인해도 글에 못 쓰인다).
  if (opts.allFields) search.set("all_fields", "1");
  if (opts.q) search.set("q", opts.q);
  if (opts.limit) search.set("limit", String(opts.limit));
  return api<{ items: ReviewQueueRow[]; total: number; fields: Array<{ field_key: string; n: number }> }>(`/academy-research/review-queue?${search.toString()}`);
};
// 일괄 승인. 한 줄씩 누르는 구조로는 조사 375곳 × 항목 10개를 감당할 수 없어 verified 가 0건이었다.
export const bulkFieldMeta = (items: Array<{ external_id: string; field_key: string }>, status: string) =>
  api<{ ok: boolean; changed: number }>("/academy-research/field-meta/bulk", { method: "POST", body: JSON.stringify({ items, status }) });
/** 원천에 없는 학원을 직접 등록한다. 지역·이름 외에는 아는 것만 채우면 된다. */
export interface ManualAcademyInput {
  name: string;
  region?: string;
  address?: string;
  phone?: string;
  academy_type?: string;
  price?: string;
  shuttle?: string;
  hours?: string;
  pass_rate?: string;
  source_name?: string;
  source_url?: string;
  review?: string;
}
export const createManualAcademy = (body: ManualAcademyInput | ManualAcademyInput[]) =>
  api<{ ok: boolean; created: number; external_ids: string[]; errors: string[] }>("/academy-research/manual", {
    method: "POST",
    body: JSON.stringify(Array.isArray(body) ? { items: body } : body),
  });
export const deleteManualAcademy = (externalId: string) =>
  api<{ ok: boolean }>(`/academy-research/manual/${encodeURIComponent(externalId)}`, { method: "DELETE" });

export const listStatusDefs = () => api<{ items: StatusDef[] }>("/academy-research/status-defs");
export const listResearchRuns = () => api<{ items: ResearchRun[] }>("/academy-research/runs");
// 취소 "요청". 처리 중이던 학원은 마치고 멈추므로 즉시 반영되지는 않는다.
export const cancelResearchRun = (runId: string) =>
  api<{ ok: boolean; run_id: string }>(`/academy-research/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
// 백그라운드 시작만 하고 run_id 를 받는다. 진행률은 listResearchRuns 폴링으로 본다.
export const syncRegion = () => api<{ ok: boolean; run_id?: string; error?: string }>("/academy-research/sync", { method: "POST", body: JSON.stringify({}) });
// 블로그리뷰는 원천 조회가 느려 별도 실행으로 분리돼 있다. 현재 수집은 중단 상태라 서버가 거부한다
// (원천이 학원명을 느슨하게 매칭해 다른 학원 글이 섞인다). 검증 방식이 정해지면 다시 켠다.
export const syncBlogReviews = () => api<{ ok: boolean; run_id?: string; error?: string }>("/academy-research/sync/blog-reviews", { method: "POST", body: JSON.stringify({}) });
export const syncOneAcademy = (externalId: string) => api<{
  external_id: string; found: boolean; reviews: number; student_reviews: number; blog_reviews: number;
}>(`/academy-research/${encodeURIComponent(externalId)}/sync`, { method: "POST" });
// 단건 조사도 백그라운드다 — 학원 1곳이 평균 85초, 길면 388초 걸려 요청 안에서 기다리면
// 관리자 프록시의 fetch(기본 300초)에 끊긴다. run_id 로 진행을 폴링한다.
export const researchOneAcademy = (externalId: string, provider: ResearchProvider = "auto") =>
  api<{ ok: boolean; run_id?: string; error?: string }>(`/academy-research/${encodeURIComponent(externalId)}/research`, { method: "POST", body: JSON.stringify({ provider }) });
export const getResearchRun = (runId: string) => api<ResearchRun>(`/academy-research/runs/${encodeURIComponent(runId)}`);
// 기본은 아직 조사되지 않은 학원만 대상으로 한다. 배치가 중단돼도 다시 눌러 이어서
// 진행하기 위함이다. limit 은 이번 실행의 상한(학원 1곳이 1분 안팎이라 나눠 돌린다).
export const researchRegion = (provider: ResearchProvider = "auto", opts: { refreshAll?: boolean; retryOnly?: boolean; limit?: number; offset?: number } = {}) =>
  api<{ ok: boolean; run_id?: string; count?: number; error?: string }>("/academy-research/research/region", {
    method: "POST",
    body: JSON.stringify({ provider, refresh_all: opts.refreshAll === true, retry_only: opts.retryOnly === true, limit: opts.limit, offset: opts.offset }),
  });
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
  { key: "enrollment_prep", label: "등록 준비물" },
  { key: "booking_channel", label: "예약·상담 경로" },
  { key: "transit_access", label: "대중교통 접근" },
  { key: "parking_note", label: "주차" },
  { key: "nearby_landmarks", label: "주변 시설" },
];
