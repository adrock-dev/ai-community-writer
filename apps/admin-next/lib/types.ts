export type Axis = "region" | "keyword" | "intent" | "persona" | "modifier";
export type SlotStatus = "planned" | "in_progress" | "published" | "failed" | "pruned";
export type PostStatus = "published" | "noindex" | "deleted";
export type JobStatus = "queued" | "running" | "done" | "failed";
export type JobKind = "generate" | "dedup" | "indexing" | "prune";
export type Provider = "claude" | "codex";
export type DesignTemplateId = "editorial" | "comparison" | "local-guide" | "checklist" | "conversion" | "custom";
// 도메인 설정값. "auto"면 글마다 후보의 글 유형 기본 디자인(default_design)이 적용된다.
export type DomainDesignSetting = string | "auto";

export interface DesignTemplateOption {
  id: string;
  name: string;
  summary: string;
  best_for: string;
  source_type?: "builtin" | "uploaded_html";
  source_html?: string | null;
  tone?: string | null;
  structure_guide?: string[];
  css_tokens?: Record<string, unknown>;
}

export interface TemplateOverride {
  direction?: string;
  axis_tags?: { persona?: string[]; intent?: string[]; modifier?: string[] };
  use_persona?: boolean;
  with_intent?: boolean;
  modifier_count?: number;
  // 글유형별 디자인(PR3: 레거시 design_template_overrides 통합). 백엔드 resolveGenerationDesign 이 우선 소비.
  design?: string;
}

// 커스텀 글유형(custom_templates row). 빌트인 TemplateSpec 과 유사하되 template_id/created_at 를 갖는다.
export interface CustomTemplate {
  template_id: string;
  name: string;
  kind: string;
  use_persona: boolean;
  with_intent: boolean;
  modifier_count: number;
  weight: number;
  min_sv: number;
  axis_tags?: { persona?: string[]; intent?: string[]; modifier?: string[] };
  axis_values?: { persona?: string[]; intent?: string[]; modifier?: string[] };
  academy_types?: string[];
  keyword_filter?: string[];
  primary_override?: "region" | "keyword";
  default_direction?: string | null;
  default_design?: string;
  created_at?: string;
  custom?: boolean;
}

// 레시피↔데이터 정합성(coherence) 응답.
export interface CoherenceWarning { level: "error" | "warn" | string; code: string; message: string; }
export interface CoherenceTemplate {
  template_id: string;
  name: string;
  kind: string;
  custom: boolean;
  enabled: boolean;
  primary_axis: string;
  primary_value_count: number;
  keyword_rule: { format: string | null; matched_keyword_count: number | null; keyword_total: number };
  axes: Record<"persona" | "intent" | "modifier", { used: boolean; accepted_tags: string[]; pool_size: number; total: number }>;
  academy: { applicable: boolean; regions_total?: number; regions_with_academies?: number; regions_with_min_for_best?: number };
  estimated_slot_upperbound: number;
  warnings: CoherenceWarning[];
}
export interface CoherenceReport {
  domain: string;
  thresholds: { academy_min_for_best: number };
  templates: CoherenceTemplate[];
}
export interface AcademyCoverageAcademy { name: string; region: string; academy_type: string; address: string; nearby: boolean; distance_km: number | null; missing: string[]; }
export interface AcademyCoverageRegion { region: string; direct: number; nearby: number; count: number; sufficient: boolean; academies: AcademyCoverageAcademy[]; truncated: boolean; }
export interface AcademyCoverage {
  template_id: string;
  name: string;
  applicable: boolean;
  academy_types: string[];
  threshold: number;
  nearby_km?: number;
  regions_total?: number;
  regions_with_academies?: number;
  regions_with_min_for_best?: number;
  regions_with_min_direct?: number;
  regions: AcademyCoverageRegion[];
}

export interface DomainConfig {
  domain: string;
  display_name: string;
  vertical: string;
  theme: string;
  brand_color: string | null;
  logo_url: string | null;
  templates_enabled: string[];
  design_template_id?: DomainDesignSetting;
  design_template_overrides?: Record<string, string>;
  template_overrides?: Record<string, TemplateOverride>;
  custom_design_templates?: string | null;
  content_brief?: string | null;
  common_principles?: string | null;
  excluded_keywords?: string | null;
  daily_limit: number;
  created_at: string;
  slot_count?: number;
  planned_count?: number;
  published_count?: number;
}

export interface AxisValue {
  domain?: string;
  axis?: Axis;
  value: string;
  weight: number;
  monthly_search_volume: number | null;
  competition_kd: number | null;
}

export type AxesMap = Record<Axis, AxisValue[]>;
export type SlotCounts = Record<SlotStatus, number>;

export interface Slot {
  slot_id: string;
  domain: string;
  template_id: string;
  primary_keyword: string;
  region: string | null;
  persona: string | null;
  intent: string | null;
  modifier_1: string | null;
  modifier_2: string | null;
  entity_id: string | null;
  priority_score: number | null;
  status: SlotStatus;
  last_error: string | null;
  created_at: string;
}

export interface PostSummary {
  id: string;
  domain: string;
  slot_id: string | null;
  slug: string;
  title: string;
  meta_description: string | null;
  design_template_id: string | null;
  status: PostStatus;
  provider: string | null;
  model: string | null;
  cost_usd: number;
  duration_sec: number | null;
  generated_at: string;
  body_chars: number;
  job_id: string | null;
  image_count: number;
  image_cost_usd: number;
}

export interface PostDetail extends PostSummary {
  body_markdown: string;
  images?: string | Record<string, string> | null;
  session_id?: string | null;
  input_tokens?: number;
  output_tokens?: number;
}

export interface Academy {
  id: string;
  domain: string;
  external_id?: string | null;
  region: string | null;
  name: string;
  address: string | null;
  price: string | null;
  shuttle: string | null;
  hours: string | null;
  pass_rate: string | null;
  phone: string | null;
  vphone?: string | null;
  review: string | null;
  review_json?: string | null;
  blog_reviews?: string | null;
  seo_title?: string | null;
  seo_keywords?: string | null;
  seo_description?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  thumb_url?: string | null;
  photos?: string | null;
  academy_type?: string | null;
  extra: string | null;
  source_name: string | null;
  source_url: string | null;
  synced_at?: string | null;
  created_at: string;
}

export interface AcademyListPayload {
  count: number;
  items: Academy[];
  academy_types?: Array<{ value: string; count: number }>;
}

export interface Job {
  id: string;
  domain: string;
  kind: JobKind;
  payload: string;
  payload_obj: Record<string, unknown> & {
    slot_ids?: string[];
    provider?: string;
    model?: string;
    cooldown_sec?: number;
    timeout_sec?: number;
    enable_image_generation?: boolean;
    image_size?: string;
    image_count?: number;
    image_provider?: string;
    image_model?: string;
  };
  status: JobStatus;
  paused?: number;
  cancel_requested?: number;
  heartbeat_at?: string | null;
  current_slot_id?: string | null;
  current_step?: string | null;
  processed_count?: number;
  failed_count?: number;
  scheduled_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  result: string | null;
  result_obj?: Record<string, unknown> & { ok?: number; fail?: number; per_slot?: unknown[] };
}

export interface TemplateSpec {
  name: string;
  description?: string;
  primary: string[];
  use_persona: boolean;
  modifier_count: number;
  weight?: number;
  min_sv?: number;
  with_intent?: boolean;
  kind?: string;
  default_design?: string;
  default_direction?: string;
  axis_tags?: { persona?: string[]; intent?: string[]; modifier?: string[] };
  axis_values?: { persona?: string[]; intent?: string[]; modifier?: string[] };
  academy_types?: string[];
  keyword_filter?: string[];
  primary_override?: "region" | "keyword";
}

export interface Vertical {
  key: string;
  label: string;
}

export interface AdminOptions {
  verticals: Vertical[];
  themes: string[];
  templates: string[];
  template_specs: Record<string, TemplateSpec>;
  academy_types?: string[];
  axis_tag_vocab: { persona: string[]; intent: string[]; modifier: string[] };
  design_templates: DesignTemplateOption[];
  providers: Provider[];
  preset_options: string[];
  indexing: { has_key: boolean; url_template: string };
  // 전역 빌트인 노출 허용 id 목록(검증용 임시). null/undefined = 전체 노출.
  exposed_builtin_template_ids?: string[] | null;
}

export interface RuntimeApis {
  admin_api_base: string;
  public_api_base: string;
  drivingplus_api_base: string;
  drivingplus_endpoints: {
    academies: string;
    reviews: string;
    blog_reviews: string;
    seo_regions: string;
  };
  sync_defaults: {
    include_reviews: boolean;
    review_limit: number;
    review_sort: "new" | "point";
    include_blog_reviews: boolean;
    blog_review_limit: number;
    review_source_note: string;
  };
}

export interface DomainDetailPayload {
  domain: DomainConfig;
  axes: AxesMap;
  slot_counts: SlotCounts;
  custom_templates?: CustomTemplate[];
  settings: { indexing_has_key: boolean; indexing_url_template: string };
  slots?: Slot[];
  posts?: PostSummary[];
  academies?: Academy[];
  jobs?: Job[];
}

export interface SlotListPayload {
  count: number;
  total: number;
  slot_counts: SlotCounts;
  items: Slot[];
}
