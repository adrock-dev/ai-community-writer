export type Axis = "region" | "keyword" | "intent" | "persona" | "modifier";
export type SlotStatus = "planned" | "in_progress" | "published" | "failed" | "skipped";
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

// 제목 규칙(생성 시점 해석). 빌트인은 TITLE_RULES 맵, 커스텀은 custom_templates.title_rule.
// tiers: min_count 내림차순 첫 매칭. min_generate: 실제 후보 수가 이 값 미만이면 생성 스킵. {지역}/{개수}/{키워드}/{학원명} 치환.
export interface TitleRuleTier { min_count: number; template: string; }
export interface TitleRule { min_generate?: number; tiers: TitleRuleTier[]; fallback?: string; }

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
  // 서버가 복제 계보로만 사용하는 내부 메타데이터. 편집 폼에서 변경하지 않는다.
  origin_template_id?: string | null;
  title_rule?: TitleRule | null;
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
  academy: { applicable: boolean; academy_types?: string[]; nearby_km?: number; min_guarantee_km?: number; regions_total?: number; regions_with_academies?: number; regions_with_min_for_best?: number; regions_with_min_direct?: number; regions_guaranteed?: number; regions_short?: number };
  estimated_slot_upperbound: number;
  warnings: CoherenceWarning[];
}
export interface CoherenceReport {
  domain: string;
  thresholds: { academy_min_for_best: number };
  templates: CoherenceTemplate[];
}
export interface AcademyCoverageAcademy { name: string; region: string; academy_type: string; address: string; tier: "direct" | "nearby" | "guaranteed"; distance_km: number | null; missing: string[]; }
export interface AcademyCoverageRegion { region: string; direct: number; nearby: number; guaranteed: number; count: number; effective: number; status: "sufficient" | "guaranteed" | "short"; sufficient: boolean; academies: AcademyCoverageAcademy[]; truncated: boolean; }
export interface AcademyCoverage {
  template_id: string;
  name: string;
  applicable: boolean;
  academy_types: string[];
  threshold: number;
  nearby_km?: number;
  max_candidates?: number;
  used_per_post?: number;
  min_guarantee_km?: number;
  regions_total?: number;
  regions_with_academies?: number;
  regions_with_min_for_best?: number;
  regions_with_min_direct?: number;
  regions_guaranteed?: number;
  regions_short?: number;
  regions: AcademyCoverageRegion[];
}

export interface DomainConfig {
  domain: string;
  /** 관리자 목록에서 도메인을 구분하는 내부 라벨. */
  display_name: string;
  /** 글 본문·CTA·공개 API 에 노출되는 이름. 비면 display_name 으로 폴백(lib/brand.ts). */
  brand_name?: string | null;
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
  monitored_phrases?: string | null;
  /** 조사값을 글 생성 근거로 쓸지: off(기본) / verified(검증완료만) / draft(AI 초안까지). */
  research_usage?: "off" | "verified" | "draft";
  /**
   * 원천 자료가 마지막 「학원자료 연결」보다 새로운가 — **축 무관**(조사값·지역 사전·지역 목록
   * 중 하나라도). 판정은 서버(link-freshness)에서만 한다. 셸 배너가 이 값으로 「선택된 운영
   * 대상에 아직 반영되지 않았습니다」를 띄우고, 어느 축인지는 도메인 원천 데이터 탭이 설명한다.
   */
  pending_link?: boolean;
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
  title: string | null; // 수동 제목 오버라이드(원문 · 규칙보다 우선). null=규칙/LLM 폴백.
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

// 격리(draft) 검수: 품질 게이트에 걸려 발행되지 못한 글.
export type IssueSeverityClass = "A" | "B";
export type DraftReviewStatus = "pending" | "dismissed" | "promoted";
export interface DraftIssue { code: string; class: IssueSeverityClass; }
export interface DraftSummary {
  id: string;
  domain: string;
  slot_id: string | null;
  title: string | null;
  meta_description: string | null;
  design_template_id: string | null;
  region: string | null;
  primary_keyword: string | null;
  quality_issues: DraftIssue[];
  gate_stage: string | null;
  blocking_class: IssueSeverityClass;
  review_status: DraftReviewStatus;
  provider: string | null;
  model: string | null;
  job_id: string | null;
  created_at: string;
  reviewed_at: string | null;
  body_chars: number;
}
export interface DraftDetail extends DraftSummary {
  body_markdown: string;
  images?: string | Record<string, string> | null;
  facts_text?: string | null;
}
export interface DraftListPayload { count: number; pending: number; items: DraftSummary[]; }

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
  seo_content?: string | null;
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
  result_obj?: Record<string, unknown> & { ok?: number; fail?: number; skipped?: number; per_slot?: unknown[] };
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
  title_rule?: TitleRule | null;
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
  // 아키타입 kind → 섹션 순서 변형 라벨(읽기전용 안내). 변형 없는 아키타입은 키 없음.
  archetype_structure_variants?: Record<string, string[]>;
  academy_types?: string[];
  // 후보 선정 규칙(서버 상수). 안내멘트가 반경·상한을 손으로 적지 않도록 값으로 내려받는다.
  candidate_rules?: { nearby_km: number; min_guarantee_km: number; used_per_post: number };
  axis_tag_vocab: { persona: string[]; intent: string[]; modifier: string[] };
  design_templates: DesignTemplateOption[];
  providers: Provider[];
  // 프로바이더별 글 생성 모델 선택지. id 가 빈 문자열이면 CLI 설정 기본값을 쓴다.
  generation_models?: Record<string, { id: string; label: string }[]>;
  preset_options: string[];
  indexing: { has_key: boolean; url_template: string };
  /** 이미 모든 글에 강제되는 규칙(읽기 전용 안내용). absolute=전 글, academy=학원 후보를 다루는 글. */
  enforced_principles?: { absolute: string; academy: string };
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
