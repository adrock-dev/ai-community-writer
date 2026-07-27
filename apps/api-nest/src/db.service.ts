import { Injectable, OnModuleInit } from "@nestjs/common";
import { parseResearchUsage } from "./academy-research-usage.js";
import { registerSettingsReader } from "./runtime-config.js";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { AXES, DEFAULT_DRIVING_DESIGN_TEMPLATE, DEFAULT_DRIVING_TEMPLATE_IDS, DRIVING_ORIGINAL_TEMPLATE_IDS, TEMPLATE_SPECS, TITLE_RULES, type AxisName, type JobKind, type TemplateSpecShape, type TitleRule } from "./constants.js";
import { parseExclusionTerms, slotExclusionSql } from "./exclusions.js";
import { drivingplusApiBaseUrl } from "./runtime-config.js";
import { formatOperatingHoursFact, formatTuitionFact } from "./drivingplus-academy-facts.js";
import { formatShuttleFact, type RegionDirectoryEntry } from "./drivingplus-shuttle-facts.js";
import type { DrivingplusEducationPerformance, DrivingplusOperateHour, DrivingplusShuttleBus } from "./drivingplus-api.service.js";

// node:sqlite is available in the project's Node 25 runtime and keeps the Nest port dependency-light.
const sqlite = await import("node:sqlite" as string) as any;
type DatabaseSync = any;

type Row = Record<string, any>;

// worker.service.ts 의 slugify 와 동일 규칙(그쪽은 미노출 private). draft 승격 시 slug 생성에 사용.
function slugify(text: string): string {
  return (text || "post").trim().replace(/[^\w가-힣\s-]/g, "").replace(/[\s_]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "post";
}

const PROJECT_DIR = resolve(new URL("../../..", import.meta.url).pathname);
const DEFAULT_DB = resolve(PROJECT_DIR, "data/admin.db");

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS domains (
  domain TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  -- 공개 브랜드명(글 본문·CTA·공개 API). 비면 display_name 으로 폴백한다(brand.ts).
  brand_name TEXT,
  vertical TEXT NOT NULL,
  theme TEXT NOT NULL DEFAULT 'clean' CHECK (theme IN ('clean','modern','pro')),
  brand_color TEXT DEFAULT '#0066ff',
  logo_url TEXT,
  templates_enabled TEXT NOT NULL DEFAULT '[]',
  design_template_id TEXT NOT NULL DEFAULT 'local-guide',
  design_template_overrides TEXT,
  template_overrides TEXT,
  custom_design_templates TEXT,
  content_brief TEXT,
  common_principles TEXT,
  excluded_keywords TEXT,
  monitored_phrases TEXT,
  daily_limit INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS axes (
  domain TEXT NOT NULL,
  axis TEXT NOT NULL CHECK (axis IN ('region','keyword','intent','persona','modifier')),
  value TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 3,
  monthly_search_volume INTEGER,
  competition_kd INTEGER,
  PRIMARY KEY (domain, axis, value),
  FOREIGN KEY (domain) REFERENCES domains(domain) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS slots (
  slot_id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  template_id TEXT NOT NULL,
  primary_keyword TEXT NOT NULL,
  region TEXT,
  persona TEXT,
  intent TEXT,
  modifier_1 TEXT,
  modifier_2 TEXT,
  entity_id TEXT,
  priority_score REAL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','published','failed','skipped')),
  last_error TEXT,
  title TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (domain) REFERENCES domains(domain) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_slots_domain_status ON slots(domain, status, priority_score DESC);
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  slot_id TEXT,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  meta_description TEXT,
  images TEXT,
  design_template_id TEXT NOT NULL DEFAULT 'local-guide',
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','noindex','deleted')),
  provider TEXT,
  model TEXT,
  session_id TEXT,
  cost_usd REAL DEFAULT 0,
  duration_sec REAL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  job_id TEXT,
  image_count INTEGER DEFAULT 0,
  image_cost_usd REAL DEFAULT 0,
  academy_count INTEGER,
  region TEXT,
  primary_keyword TEXT,
  academy_names TEXT,
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (domain, slug),
  FOREIGN KEY (domain) REFERENCES domains(domain) ON DELETE CASCADE,
  FOREIGN KEY (slot_id) REFERENCES slots(slot_id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('generate','dedup','indexing','prune')),
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  paused INTEGER NOT NULL DEFAULT 0,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  scheduled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  heartbeat_at TEXT,
  current_slot_id TEXT,
  current_step TEXT,
  processed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  finished_at TEXT,
  error TEXT,
  result TEXT,
  FOREIGN KEY (domain) REFERENCES domains(domain) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_jobs_status_sched ON jobs(status, scheduled_at);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS academies (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  external_id TEXT,
  region TEXT,
  name TEXT NOT NULL,
  address TEXT,
  price TEXT,
  shuttle TEXT,
  hours TEXT,
  pass_rate TEXT,
  phone TEXT,
  vphone TEXT,
  review TEXT,
  review_json TEXT,
  blog_reviews TEXT,
  seo_title TEXT,
  seo_keywords TEXT,
  seo_description TEXT,
  latitude REAL,
  longitude REAL,
  thumb_url TEXT,
  photos TEXT,
  academy_type TEXT,
  extra TEXT,
  source_name TEXT,
  source_url TEXT,
  synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (domain, region, name),
  FOREIGN KEY (domain) REFERENCES domains(domain) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_academies_domain_region ON academies(domain, region);
CREATE TABLE IF NOT EXISTS seo_regions (
  domain TEXT NOT NULL,
  level INTEGER NOT NULL,
  region TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  source_name TEXT,
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (domain, level, region),
  FOREIGN KEY (domain) REFERENCES domains(domain) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_seo_regions_domain_region ON seo_regions(domain, region);
-- 전역 행정구역 사전. seo_regions 와 의도적으로 분리한다.
-- seo_regions 는 '어느 지역에 글을 쓸 것인가'라는 도메인별 운영 선택이고, 소비처 두 곳이
-- level 2 만 있다고 암묵적으로 가정한다(bestRegionForAddress 는 '가장 긴 매칭'을,
-- slot.buildRegionCoords 는 '높은 level 우선'을 쓴다). 여기에 읍·면·동을 섞으면 학원 지역
-- 배정과 슬롯 좌표가 조용히 뒤집힌다. 이 표는 '대한민국 행정구역이 무엇인가'라는 사실
-- 참조라서 도메인과 무관하고, 재동기화로 언제든 복구 가능한 파생 데이터다.
CREATE TABLE IF NOT EXISTS region_directory (
  region TEXT PRIMARY KEY,
  level INTEGER NOT NULL,
  sido TEXT NOT NULL,
  sigungu TEXT,
  submunicipal TEXT,
  latitude REAL,
  longitude REAL,
  source_name TEXT,
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_region_directory_sub ON region_directory(submunicipal);
CREATE INDEX IF NOT EXISTS idx_region_directory_level ON region_directory(level);
CREATE TABLE IF NOT EXISTS custom_templates (
  domain TEXT NOT NULL,
  template_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  use_persona INTEGER NOT NULL DEFAULT 0,
  with_intent INTEGER NOT NULL DEFAULT 0,
  modifier_count INTEGER NOT NULL DEFAULT 0,
  weight REAL NOT NULL DEFAULT 1.0,
  min_sv INTEGER NOT NULL DEFAULT 0,
  axis_tags TEXT,
  axis_values TEXT,
  academy_types TEXT,
  keyword_filter TEXT,
  primary_override TEXT,
  default_direction TEXT,
  default_design TEXT NOT NULL DEFAULT 'local-guide',
  origin_template_id TEXT,
  title_rule TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (domain, template_id),
  FOREIGN KEY (domain) REFERENCES domains(domain) ON DELETE CASCADE
);

-- 품질 게이트에 걸려 발행되지 못한 글의 격리 보관소. posts 와 물리적으로 분리돼
-- 공개 경로(/api/v1, sitemap, dedup/prune)는 절대 참조하지 않는다. 관리자 검수 후
-- promote 시에만 posts 로 승격된다. blocking_class 는 걸린 이슈 중 최상위 등급
-- (B=안전/사실 → 발행 차단, A=구조/문체 → 사유 확인 후 발행 허용).
CREATE TABLE IF NOT EXISTS draft_posts (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  slot_id TEXT,
  title TEXT,
  body_markdown TEXT NOT NULL,
  meta_description TEXT,
  images TEXT,
  design_template_id TEXT NOT NULL DEFAULT 'local-guide',
  region TEXT,
  primary_keyword TEXT,
  academy_names TEXT,
  facts_text TEXT,
  quality_issues TEXT NOT NULL DEFAULT '[]',
  gate_stage TEXT,
  blocking_class TEXT NOT NULL DEFAULT 'B' CHECK (blocking_class IN ('A','B')),
  provider TEXT,
  model TEXT,
  job_id TEXT,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','dismissed','promoted')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  FOREIGN KEY (domain) REFERENCES domains(domain) ON DELETE CASCADE,
  FOREIGN KEY (slot_id) REFERENCES slots(slot_id) ON DELETE SET NULL
);
-- 원천 동기화 실행 이력. jobs 와 분리한 이유: jobs 는 워커가 하나씩 claim 하는 큐라
-- 12분짜리 동기화를 넣으면 그동안 글 생성이 통째로 밀린다. 동기화는 워커와 무관하게
-- API 프로세스 안에서 돌고, 이 표는 진행률·취소·결과만 들고 있다.
CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  scope TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','cancelled','error')),
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  step TEXT,
  count_total INTEGER NOT NULL DEFAULT 0,
  count_done INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  error TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_runs_started ON sync_runs(started_at DESC);
	`;

@Injectable()
export class DbService implements OnModuleInit {
  private db!: DatabaseSync;
  readonly path = resolve(process.cwd(), process.env.SEO_DB_PATH || DEFAULT_DB);

  onModuleInit(): void {
    this.init();
  }

  init(): void {
    if (this.db) return;
    mkdirSync(dirname(this.path), { recursive: true });
    this.db = new sqlite.DatabaseSync(this.path);
    this.db.exec("PRAGMA foreign_keys = OFF");
    this.ensureDomainsTable();
    this.normalizeLegacyDomainSchema();
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(SCHEMA);
    this.migrate();
    this.clearStaleSyncRuns();
    // 저장된 설정을 읽는 통로를 열어 둔다. runtime-config 의 스위치들이 DB 를 직접 몰라도
    // 관리자 설정을 반영할 수 있게 하는 장치다(자세한 이유는 registerSettingsReader 주석).
    registerSettingsReader((key) => this.getSetting(key));
  }

  /**
   * 이전 프로세스가 죽으며 남긴 "running" 동기화를 정리한다.
   * 안 하면 findRunningSyncRun 이 영원히 걸려 동기화 버튼이 잠긴 채 풀리지 않는다.
   * 동기화는 API 프로세스 메모리에서 도는 작업이라, 프로세스가 죽었으면 그 실행도 죽은 것이다.
   */
  private clearStaleSyncRuns(): void {
    this.run(
      "UPDATE sync_runs SET status='error', error=COALESCE(error, ?), finished_at=? WHERE status='running'",
      ["API 프로세스가 재시작되어 중단됐습니다.", nowSql()],
    );
  }

  private ensureDomainsTable(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS domains (
      domain TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      vertical TEXT NOT NULL,
      theme TEXT NOT NULL DEFAULT 'clean' CHECK (theme IN ('clean','modern','pro')),
      brand_color TEXT DEFAULT '#0066ff',
      logo_url TEXT,
      templates_enabled TEXT NOT NULL DEFAULT '[]',
      design_template_id TEXT NOT NULL DEFAULT 'local-guide',
      design_template_overrides TEXT,
      custom_design_templates TEXT,
      content_brief TEXT,
      excluded_keywords TEXT,
      monitored_phrases TEXT,
      daily_limit INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  }

  private normalizeLegacyDomainSchema(): void {
    const hasTable = (name: string) => Boolean(this.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name]));
    const legacyDomainsTable = "ten" + "ants";
    const legacyDomainColumn = "ten" + "ant";
    if (hasTable(legacyDomainsTable)) {
      const legacyCols = new Set(this.all(`PRAGMA table_info(${legacyDomainsTable})`).map((r) => r.name));
      if (legacyCols.has("domain")) {
        const select = (column: string, fallback: string) => legacyCols.has(column) ? column : fallback;
        this.db.exec(`INSERT OR IGNORE INTO domains (
            domain, display_name, vertical, theme, brand_color, logo_url, templates_enabled,
            daily_limit, created_at, design_template_id, custom_design_templates, content_brief
          )
          SELECT
            domain,
            ${select("display_name", "domain")},
            ${select("vertical", "'driving'")},
            ${select("theme", "'clean'")},
            ${select("brand_color", "'#0066ff'")},
            ${select("logo_url", "NULL")},
            ${select("templates_enabled", `'${JSON.stringify(DEFAULT_DRIVING_TEMPLATE_IDS)}'`)},
            ${select("daily_limit", "0")},
            ${select("created_at", "CURRENT_TIMESTAMP")},
            ${select("design_template_id", "'local-guide'")},
            ${select("custom_design_templates", "NULL")},
            ${select("content_brief", "NULL")}
          FROM ${legacyDomainsTable}`);
      }
    }

    for (const table of ["axes", "slots", "posts", "jobs", "academies", "seo_regions"]) {
      if (!hasTable(table)) continue;
      const cols = new Set(this.all(`PRAGMA table_info(${table})`).map((r) => r.name));
      if (cols.has(legacyDomainColumn) && !cols.has("domain")) this.db.exec(`ALTER TABLE ${table} RENAME COLUMN ${legacyDomainColumn} TO domain`);
    }
  }

  private migrate(): void {
    const domainCols = new Set(this.all("PRAGMA table_info(domains)").map((r) => r.name));
    // 공개 브랜드명 분리. NULL 로 추가만 하고 값을 채우지 않는다 — 폴백(brand.ts)이 기존 동작을
    // 그대로 유지하므로, 운영자가 직접 지정한 도메인만 라벨과 브랜드가 갈라진다.
    if (!domainCols.has("brand_name")) this.db.exec("ALTER TABLE domains ADD COLUMN brand_name TEXT");
    if (!domainCols.has("design_template_id")) this.db.exec("ALTER TABLE domains ADD COLUMN design_template_id TEXT NOT NULL DEFAULT 'local-guide'");
    if (!domainCols.has("design_template_overrides")) this.db.exec("ALTER TABLE domains ADD COLUMN design_template_overrides TEXT");
    if (!domainCols.has("custom_design_templates")) this.db.exec("ALTER TABLE domains ADD COLUMN custom_design_templates TEXT");
    if (!domainCols.has("template_overrides")) this.db.exec("ALTER TABLE domains ADD COLUMN template_overrides TEXT");
    // 조사값을 글 생성의 근거로 쓸지(off/verified/draft). 기본은 쓰지 않음 —
    // 조사값은 공개 웹에서 모은 미검증 자료라 관리자가 명시적으로 열어야 한다.
    if (!domainCols.has("research_usage")) this.db.exec("ALTER TABLE domains ADD COLUMN research_usage TEXT NOT NULL DEFAULT 'off'");
    if (!domainCols.has("content_brief")) this.db.exec("ALTER TABLE domains ADD COLUMN content_brief TEXT");
    if (!domainCols.has("common_principles")) {
      this.db.exec("ALTER TABLE domains ADD COLUMN common_principles TEXT");
      // 폐기 가능한 개발 데이터 기준의 단순 이월: 기존 content_brief 를 공통원칙 초기값으로 가져온다.
      this.db.exec("UPDATE domains SET common_principles = content_brief WHERE common_principles IS NULL AND content_brief IS NOT NULL");
    }
    if (!domainCols.has("excluded_keywords")) this.db.exec("ALTER TABLE domains ADD COLUMN excluded_keywords TEXT");
    if (!domainCols.has("monitored_phrases")) this.db.exec("ALTER TABLE domains ADD COLUMN monitored_phrases TEXT");
    this.run(`UPDATE domains SET templates_enabled=?
       WHERE vertical='driving' AND templates_enabled IN ('["T01","T03","T05","T07"]', '["T01","T03","T04","T05","T06","T07"]')`, [JSON.stringify(DRIVING_ORIGINAL_TEMPLATE_IDS)]);
    const postCols = new Set(this.all("PRAGMA table_info(posts)").map((r) => r.name));
    if (!postCols.has("images")) this.db.exec("ALTER TABLE posts ADD COLUMN images TEXT");
    if (!postCols.has("job_id")) this.db.exec("ALTER TABLE posts ADD COLUMN job_id TEXT");
    if (!postCols.has("image_count")) this.db.exec("ALTER TABLE posts ADD COLUMN image_count INTEGER DEFAULT 0");
    if (!postCols.has("image_cost_usd")) this.db.exec("ALTER TABLE posts ADD COLUMN image_cost_usd REAL DEFAULT 0");
    if (!postCols.has("academy_count")) this.db.exec("ALTER TABLE posts ADD COLUMN academy_count INTEGER");
    // 발행글의 지역/대표키워드/참조 학원명 — JSON-LD·내부링크 등 렌더 시점 파생의 원천(기존 행은 NULL 안전).
    if (!postCols.has("region")) this.db.exec("ALTER TABLE posts ADD COLUMN region TEXT");
    if (!postCols.has("primary_keyword")) this.db.exec("ALTER TABLE posts ADD COLUMN primary_keyword TEXT");
    if (!postCols.has("academy_names")) this.db.exec("ALTER TABLE posts ADD COLUMN academy_names TEXT");
    const jobCols = new Set(this.all("PRAGMA table_info(jobs)").map((r) => r.name));
    if (!jobCols.has("paused")) this.db.exec("ALTER TABLE jobs ADD COLUMN paused INTEGER NOT NULL DEFAULT 0");
    if (!jobCols.has("cancel_requested")) this.db.exec("ALTER TABLE jobs ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0");
    if (!jobCols.has("heartbeat_at")) this.db.exec("ALTER TABLE jobs ADD COLUMN heartbeat_at TEXT");
    if (!jobCols.has("current_slot_id")) this.db.exec("ALTER TABLE jobs ADD COLUMN current_slot_id TEXT");
    if (!jobCols.has("current_step")) this.db.exec("ALTER TABLE jobs ADD COLUMN current_step TEXT");
    if (!jobCols.has("processed_count")) this.db.exec("ALTER TABLE jobs ADD COLUMN processed_count INTEGER NOT NULL DEFAULT 0");
    if (!jobCols.has("failed_count")) this.db.exec("ALTER TABLE jobs ADD COLUMN failed_count INTEGER NOT NULL DEFAULT 0");
    this.migrateSlotsSkippedStatus();
    // 슬롯 수동 제목 오버라이드(규칙보다 우선, 생성 시점 플레이스홀더 치환). skipped 재생성 이후에 추가한다.
    const slotCols = new Set(this.all("PRAGMA table_info(slots)").map((r) => r.name));
    if (!slotCols.has("title")) this.db.exec("ALTER TABLE slots ADD COLUMN title TEXT");
    if (!postCols.has("design_template_id")) {
      this.db.exec("ALTER TABLE posts ADD COLUMN design_template_id TEXT NOT NULL DEFAULT 'local-guide'");
      this.db.exec("UPDATE posts SET design_template_id = COALESCE((SELECT t.design_template_id FROM domains t WHERE t.domain = posts.domain), 'local-guide')");
    }
    const academyCols = new Set(this.all("PRAGMA table_info(academies)").map((r) => r.name));
    const academyMigrations: Array<[string, string]> = [
      ["external_id", "ALTER TABLE academies ADD COLUMN external_id TEXT"],
      ["vphone", "ALTER TABLE academies ADD COLUMN vphone TEXT"],
      ["seo_title", "ALTER TABLE academies ADD COLUMN seo_title TEXT"],
      ["seo_keywords", "ALTER TABLE academies ADD COLUMN seo_keywords TEXT"],
      ["seo_description", "ALTER TABLE academies ADD COLUMN seo_description TEXT"],
      ["latitude", "ALTER TABLE academies ADD COLUMN latitude REAL"],
      ["longitude", "ALTER TABLE academies ADD COLUMN longitude REAL"],
      ["thumb_url", "ALTER TABLE academies ADD COLUMN thumb_url TEXT"],
      ["photos", "ALTER TABLE academies ADD COLUMN photos TEXT"],
      ["academy_type", "ALTER TABLE academies ADD COLUMN academy_type TEXT"],
      ["review_json", "ALTER TABLE academies ADD COLUMN review_json TEXT"],
      ["blog_reviews", "ALTER TABLE academies ADD COLUMN blog_reviews TEXT"],
      ["synced_at", "ALTER TABLE academies ADD COLUMN synced_at TEXT"],
      // 원천 학원 소개 본문(seoContent). 보관 전용 — 인근 지명·면허 종별이 seo_description·
      // licenseTypes 와 중복이고 일부는 불일치라 프롬프트에 넣지 않는다(docs/source-field-usage.md §3.1).
      ["seo_content", "ALTER TABLE academies ADD COLUMN seo_content TEXT"],
    ];
    for (const [col, sql] of academyMigrations) if (!academyCols.has(col)) this.db.exec(sql);
    const customTemplateCols = new Set(this.all("PRAGMA table_info(custom_templates)").map((r) => r.name));
    if (!customTemplateCols.has("axis_values")) this.db.exec("ALTER TABLE custom_templates ADD COLUMN axis_values TEXT");
    if (!customTemplateCols.has("academy_types")) this.db.exec("ALTER TABLE custom_templates ADD COLUMN academy_types TEXT");
    if (!customTemplateCols.has("keyword_filter")) this.db.exec("ALTER TABLE custom_templates ADD COLUMN keyword_filter TEXT");
    if (!customTemplateCols.has("primary_override")) this.db.exec("ALTER TABLE custom_templates ADD COLUMN primary_override TEXT");
    if (!customTemplateCols.has("title_rule")) this.db.exec("ALTER TABLE custom_templates ADD COLUMN title_rule TEXT");
    if (!customTemplateCols.has("origin_template_id")) this.db.exec("ALTER TABLE custom_templates ADD COLUMN origin_template_id TEXT");
    this.backfillRecognizableT01CloneOrigins();
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_academies_domain_external_id ON academies(domain, external_id) WHERE external_id IS NOT NULL");
    this.db.exec(`CREATE TABLE IF NOT EXISTS seo_regions (
      domain TEXT NOT NULL,
      level INTEGER NOT NULL,
      region TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      source_name TEXT,
      synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (domain, level, region),
      FOREIGN KEY (domain) REFERENCES domains(domain) ON DELETE CASCADE
    )`);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_seo_regions_domain_region ON seo_regions(domain, region)");
    this.db.exec(`CREATE TABLE IF NOT EXISTS region_directory (
      region TEXT PRIMARY KEY,
      level INTEGER NOT NULL,
      sido TEXT NOT NULL,
      sigungu TEXT,
      submunicipal TEXT,
      latitude REAL,
      longitude REAL,
      source_name TEXT,
      synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_region_directory_sub ON region_directory(submunicipal)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_region_directory_level ON region_directory(level)");
    this.db.exec(`CREATE TABLE IF NOT EXISTS custom_templates (
      domain TEXT NOT NULL,
      template_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      use_persona INTEGER NOT NULL DEFAULT 0,
      with_intent INTEGER NOT NULL DEFAULT 0,
      modifier_count INTEGER NOT NULL DEFAULT 0,
      weight REAL NOT NULL DEFAULT 1.0,
      min_sv INTEGER NOT NULL DEFAULT 0,
      axis_tags TEXT,
      axis_values TEXT,
      academy_types TEXT,
      keyword_filter TEXT,
      primary_override TEXT,
      default_direction TEXT,
      default_design TEXT NOT NULL DEFAULT 'local-guide',
      origin_template_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (domain, template_id),
      FOREIGN KEY (domain) REFERENCES domains(domain) ON DELETE CASCADE
    )`);
    // PR3: 레거시 디자인 오버라이드를 template_overrides.design 으로 1회 이관(멱등, 이후엔 신규 경로가 소유).
    if (!this.getSetting("pr3_design_migrated")) {
      this.migratePr3DesignOverrides();
      this.setSetting("pr3_design_migrated", "1");
    }
  }

  // slots.status: 레거시 'pruned'(생성 시점 스킵을 뭉뚱그린 값)를 전용 'skipped' 상태로 분리한다.
  // CHECK 제약은 ALTER로 바꿀 수 없어 테이블을 재생성한다(멱등: 이미 'skipped' 제약이면 skip).
  private migrateSlotsSkippedStatus(): void {
    const slotsSql = String(this.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='slots'")?.sql ?? "");
    if (!slotsSql || slotsSql.includes("'skipped'")) return;
    this.db.exec("PRAGMA foreign_keys = OFF");
    this.transaction(() => {
      this.db.exec(`CREATE TABLE slots_new (
        slot_id TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        template_id TEXT NOT NULL,
        primary_keyword TEXT NOT NULL,
        region TEXT,
        persona TEXT,
        intent TEXT,
        modifier_1 TEXT,
        modifier_2 TEXT,
        entity_id TEXT,
        priority_score REAL,
        status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','published','failed','skipped')),
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (domain) REFERENCES domains(domain) ON DELETE CASCADE
      )`);
      this.db.exec(`INSERT INTO slots_new (slot_id, domain, template_id, primary_keyword, region, persona, intent, modifier_1, modifier_2, entity_id, priority_score, status, last_error, created_at)
        SELECT slot_id, domain, template_id, primary_keyword, region, persona, intent, modifier_1, modifier_2, entity_id, priority_score,
          CASE WHEN status = 'pruned' THEN 'skipped' ELSE status END, last_error, created_at FROM slots`);
      this.db.exec("DROP TABLE slots");
      this.db.exec("ALTER TABLE slots_new RENAME TO slots");
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_slots_domain_status ON slots(domain, status, priority_score DESC)");
    });
    this.db.exec("PRAGMA foreign_keys = ON");
  }

  all(sql: string, params: any[] = []): Row[] { return this.db.prepare(sql).all(...params) as Row[]; }
  get(sql: string, params: any[] = []): Row | undefined { return this.db.prepare(sql).get(...params) as Row | undefined; }
  run(sql: string, params: any[] = []): any { return this.db.prepare(sql).run(...params); }
  exec(sql: string): void { this.db.exec(sql); }
  transaction<T>(fn: () => T): T {
    this.exec("BEGIN");
    try { const result = fn(); this.exec("COMMIT"); return result; }
    catch (error) { this.exec("ROLLBACK"); throw error; }
  }

  listDomains(): Row[] {
    return this.all(`SELECT t.*,
      (SELECT COUNT(*) FROM slots s WHERE s.domain = t.domain) AS slot_count,
      (SELECT COUNT(*) FROM slots s WHERE s.domain = t.domain AND s.status='planned') AS planned_count,
      (SELECT COUNT(*) FROM posts p WHERE p.domain = t.domain AND p.status='published') AS published_count
      FROM domains t ORDER BY t.created_at DESC`);
  }
  getDomain(domain: string): Row | undefined { return this.get("SELECT * FROM domains WHERE domain=?", [domain]); }
  createDomain(input: { domain: string; display_name: string; brand_name?: string | null; vertical: string; theme?: string; brand_color?: string; daily_limit?: number; templates_enabled?: string }): void {
    this.run(`INSERT INTO domains (domain, display_name, brand_name, vertical, theme, brand_color, daily_limit, templates_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.domain, input.display_name, input.brand_name || null, input.vertical, input.theme || "clean", input.brand_color || "#0066ff", input.daily_limit ?? 0, input.templates_enabled || JSON.stringify(DEFAULT_DRIVING_TEMPLATE_IDS)]);
  }
  updateDomain(domain: string, fields: Row): void {
    const allowed = new Set(["display_name", "brand_name", "vertical", "theme", "brand_color", "daily_limit", "templates_enabled", "logo_url", "design_template_id", "design_template_overrides", "template_overrides", "custom_design_templates", "content_brief", "common_principles", "excluded_keywords", "monitored_phrases", "research_usage"]);
    const entries = Object.entries(fields)
      .filter(([k, v]) => allowed.has(k) && v !== undefined)
      // 읽을 때만 정규화하면 DB 에는 알 수 없는 값이 그대로 남고, domainOut 을 거치지 않는
      // 소비자가 그걸 본다. 쓰는 자리에서 막는다.
      .map(([k, v]) => (k === "research_usage" ? [k, parseResearchUsage(v)] as const : [k, v] as const));
    if (!entries.length) return;
    this.run(`UPDATE domains SET ${entries.map(([k]) => `${k}=?`).join(", ")} WHERE domain=?`, [...entries.map(([, v]) => v), domain]);
  }
  deleteDomain(domain: string): void { this.run("DELETE FROM domains WHERE domain=?", [domain]); }

  // --- 글유형 리졸버 / 커스텀 글유형(custom_templates) ---
  // 빌트인(TEMPLATE_SPECS)·커스텀(custom_templates)을 동일 shape 로 반환한다. 하위 리졸버가 균일하게 소비.
  // primary 는 넣지 않는다 — getArchetype(spec.kind).primary 로 얻는다(빌트인/커스텀 동일 경로).
  getTemplateSpec(domain: string, templateId: string): TemplateSpecShape | undefined {
    const builtin = (TEMPLATE_SPECS as Record<string, any>)[templateId];
    if (builtin) {
      return {
        name: String(builtin.name || ""),
        kind: String(builtin.kind || ""),
        use_persona: Boolean(builtin.use_persona),
        with_intent: Boolean(builtin.with_intent),
        modifier_count: Number(builtin.modifier_count ?? 0),
        weight: Number(builtin.weight ?? 1),
        min_sv: Number(builtin.min_sv ?? 0),
        axis_tags: builtin.axis_tags,
        axis_values: builtin.axis_values,
        academy_types: builtin.academy_types,
        keyword_filter: builtin.keyword_filter,
        primary_override: builtin.primary_override,
        default_direction: builtin.default_direction,
        default_design: builtin.default_design,
        // 빌트인 제목 규칙은 TITLE_RULES 맵이 소유 — spec 에 실어 하위(clone/worker)가 커스텀과 동일 경로로 소비.
        title_rule: TITLE_RULES[templateId],
      };
    }
    const row = this.get("SELECT * FROM custom_templates WHERE domain=? AND template_id=?", [domain, templateId]);
    return row ? customTemplateSpec(row) : undefined;
  }

  listCustomTemplates(domain: string): Row[] {
    return this.all("SELECT * FROM custom_templates WHERE domain=? ORDER BY created_at ASC, template_id ASC", [domain]).map(customTemplateOut);
  }
  // 정합성 계산용: 도메인 학원의 region 문자열 목록(비어있지 않은 것만). analyzeCoherence 가 축 region 값과 매칭.
  academyRegionValues(domain: string): string[] {
    return this.all("SELECT region FROM academies WHERE domain=? AND region IS NOT NULL AND region!=''", [domain])
      .map((r) => String(r.region || "").trim())
      .filter(Boolean);
  }
  getCustomTemplate(domain: string, templateId: string): Row | undefined {
    const row = this.get("SELECT * FROM custom_templates WHERE domain=? AND template_id=?", [domain, templateId]);
    return row ? customTemplateOut(row) : undefined;
  }
  // 커스텀 글유형 생성. id 는 여기서 발급(빌트인/기존 커스텀과 유니크). axis_tags 는 JSON 직렬화해 저장(트랩: TEXT 컬럼 write 는 반드시 stringify).
  createCustomTemplate(domain: string, input: Row): Row {
    const templateId = this.nextCustomTemplateId(domain);
    this.run(`INSERT INTO custom_templates (domain, template_id, name, kind, use_persona, with_intent, modifier_count, weight, min_sv, axis_tags, axis_values, academy_types, keyword_filter, primary_override, default_direction, default_design, origin_template_id, title_rule)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [domain, templateId, String(input.name || "").trim(), String(input.kind || "").trim(),
        input.use_persona ? 1 : 0, input.with_intent ? 1 : 0,
        clampModifierCount(input.modifier_count),
        Number.isFinite(Number(input.weight)) ? Number(input.weight) : 1.0,
        Number.isFinite(Number(input.min_sv)) ? Math.trunc(Number(input.min_sv)) : 0,
        serializeAxisTags(input.axis_tags),
        serializeAxisTags(input.axis_values),
        serializeAcademyTypes(input.academy_types),
        serializeAcademyTypes(input.keyword_filter),
        normPrimaryOverride(input.primary_override),
        input.default_direction != null && String(input.default_direction).trim() ? String(input.default_direction).trim() : null,
        String(input.default_design || "").trim() || DEFAULT_DRIVING_DESIGN_TEMPLATE,
        input.origin_template_id != null && String(input.origin_template_id).trim() ? String(input.origin_template_id).trim() : null,
        serializeTitleRule(input.title_rule)]);
    return this.getCustomTemplate(domain, templateId)!;
  }
  deleteCustomTemplate(domain: string, templateId: string): number {
    return this.run("DELETE FROM custom_templates WHERE domain=? AND template_id=?", [domain, templateId]).changes ?? 0;
  }
  deleteAllCustomTemplates(domain: string): number {
    return this.run("DELETE FROM custom_templates WHERE domain=?", [domain]).changes ?? 0;
  }
  // PR3: 레거시 design_template_overrides(글유형→디자인 문자열 맵)를 template_overrides[tid].design 으로 이관.
  // per-entry 멱등(design 이 이미 있으면 안 건드림) — 레거시 컬럼은 읽기 폴백으로 남긴다. migrate()에서 1회 플래그로 호출.
  migratePr3DesignOverrides(): number {
    let updated = 0;
    for (const row of this.all("SELECT domain, design_template_overrides, template_overrides FROM domains")) {
      const legacy = safeJson(row.design_template_overrides, {});
      if (!legacy || typeof legacy !== "object" || Array.isArray(legacy) || !Object.keys(legacy).length) continue;
      const tplRaw = safeJson(row.template_overrides, {});
      const tpl: Record<string, any> = (tplRaw && typeof tplRaw === "object" && !Array.isArray(tplRaw)) ? tplRaw : {};
      let changed = false;
      for (const [tid, designId] of Object.entries(legacy as Record<string, unknown>)) {
        const d = String(designId || "").trim();
        if (!d) continue;
        const entry = (tpl[tid] && typeof tpl[tid] === "object" && !Array.isArray(tpl[tid])) ? tpl[tid] : {};
        if (entry.design === undefined) { entry.design = d; tpl[tid] = entry; changed = true; }
      }
      if (changed) { this.run("UPDATE domains SET template_overrides=? WHERE domain=?", [JSON.stringify(tpl), row.domain]); updated++; }
    }
    return updated;
  }
  // 커스텀 글유형 부분 편집(PATCH). 제공된 필드만 갱신. axis_tags 는 stringify(트랩). kind 검증은 호출측.
  updateCustomTemplate(domain: string, templateId: string, fields: Row): number {
    const sets: string[] = [];
    const args: any[] = [];
    const push = (col: string, val: any) => { sets.push(`${col}=?`); args.push(val); };
    if (fields.name !== undefined) push("name", String(fields.name || "").trim());
    if (fields.kind !== undefined) push("kind", String(fields.kind || "").trim());
    if (fields.use_persona !== undefined) push("use_persona", fields.use_persona ? 1 : 0);
    if (fields.with_intent !== undefined) push("with_intent", fields.with_intent ? 1 : 0);
    if (fields.modifier_count !== undefined) push("modifier_count", clampModifierCount(fields.modifier_count));
    if (fields.weight !== undefined) push("weight", Number.isFinite(Number(fields.weight)) ? Number(fields.weight) : 1.0);
    if (fields.min_sv !== undefined) push("min_sv", Number.isFinite(Number(fields.min_sv)) ? Math.trunc(Number(fields.min_sv)) : 0);
    if (fields.axis_tags !== undefined) push("axis_tags", serializeAxisTags(fields.axis_tags));
    if (fields.axis_values !== undefined) push("axis_values", serializeAxisTags(fields.axis_values));
    if (fields.academy_types !== undefined) push("academy_types", serializeAcademyTypes(fields.academy_types));
    if (fields.keyword_filter !== undefined) push("keyword_filter", serializeAcademyTypes(fields.keyword_filter));
    if (fields.primary_override !== undefined) push("primary_override", normPrimaryOverride(fields.primary_override));
    if (fields.default_direction !== undefined) push("default_direction", fields.default_direction != null && String(fields.default_direction).trim() ? String(fields.default_direction).trim() : null);
    if (fields.default_design !== undefined) push("default_design", String(fields.default_design || "").trim() || DEFAULT_DRIVING_DESIGN_TEMPLATE);
    if (fields.title_rule !== undefined) push("title_rule", serializeTitleRule(fields.title_rule));
    if (!sets.length) return 0;
    args.push(domain, templateId);
    return this.run(`UPDATE custom_templates SET ${sets.join(", ")} WHERE domain=? AND template_id=?`, args).changes ?? 0;
  }

  // origin_template_id 도입 전의 T01 복제본은 원본 메타데이터가 없었다. 이름만으로 넓게
  // 추정하지 않고, 기존 복제 UI가 만든 기본 이름·아키타입·디자인·방향성·학원 타입·제목 규칙이
  // 모두 T01과 일치하는 경우에만 한 번 보완한다. 수정된/직접 만든 커스텀 유형은 그대로 둔다.
  backfillRecognizableT01CloneOrigins(): number {
    const t01 = (TEMPLATE_SPECS as Record<string, any>).T01;
    if (!t01) return 0;
    const t01Name = `${String(t01.name || "").trim()} (복사본)`;
    const t01AcademyTypes = JSON.stringify(Array.isArray(t01.academy_types) ? t01.academy_types : []);
    const t01TitleRule = JSON.stringify(normalizeTitleRule(TITLE_RULES.T01));
    const rows = this.all(`SELECT domain, template_id, name, kind, academy_types, default_direction, default_design, title_rule
      FROM custom_templates
      WHERE origin_template_id IS NULL OR TRIM(origin_template_id)=''`);
    let updated = 0;
    for (const row of rows) {
      const matches = String(row.name || "").trim() === t01Name
        && String(row.kind || "").trim() === String(t01.kind || "")
        && String(row.default_design || "").trim() === String(t01.default_design || "")
        && String(row.default_direction || "").trim() === String(t01.default_direction || "")
        && JSON.stringify(parseAcademyTypes(row.academy_types)) === t01AcademyTypes
        && JSON.stringify(normalizeTitleRule(row.title_rule)) === t01TitleRule;
      if (!matches) continue;
      updated += this.run(`UPDATE custom_templates SET origin_template_id='T01'
        WHERE domain=? AND template_id=? AND (origin_template_id IS NULL OR TRIM(origin_template_id)='')`, [row.domain, row.template_id]).changes ?? 0;
    }
    return updated;
  }
  // import 전용: id 를 지정해 upsert 한다(createCustomTemplate 은 id 를 새로 발급하므로 복구에 부적합).
  // created_at 은 봉투 값 보존(없으면 CURRENT_TIMESTAMP), 충돌 시 기존 created_at 유지. axis_tags 는 stringify.
  // 빌트인 id/kind 검증은 호출측(컨트롤러)에서 수행한다.
  importCustomTemplate(domain: string, row: Row): void {
    this.run(`INSERT INTO custom_templates (domain, template_id, name, kind, use_persona, with_intent, modifier_count, weight, min_sv, axis_tags, axis_values, academy_types, keyword_filter, primary_override, default_direction, default_design, origin_template_id, title_rule, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
      ON CONFLICT(domain, template_id) DO UPDATE SET
        name=excluded.name, kind=excluded.kind, use_persona=excluded.use_persona, with_intent=excluded.with_intent,
        modifier_count=excluded.modifier_count, weight=excluded.weight, min_sv=excluded.min_sv,
        axis_tags=excluded.axis_tags, axis_values=excluded.axis_values, academy_types=excluded.academy_types, keyword_filter=excluded.keyword_filter, primary_override=excluded.primary_override, default_direction=excluded.default_direction, default_design=excluded.default_design, origin_template_id=COALESCE(excluded.origin_template_id, custom_templates.origin_template_id), title_rule=excluded.title_rule`,
      [domain, String(row.template_id || "").trim(), String(row.name || "").trim(), String(row.kind || "").trim(),
        row.use_persona ? 1 : 0, row.with_intent ? 1 : 0, clampModifierCount(row.modifier_count),
        Number.isFinite(Number(row.weight)) ? Number(row.weight) : 1.0,
        Number.isFinite(Number(row.min_sv)) ? Math.trunc(Number(row.min_sv)) : 0,
        serializeAxisTags(row.axis_tags),
        serializeAxisTags(row.axis_values),
        serializeAcademyTypes(row.academy_types),
        serializeAcademyTypes(row.keyword_filter),
        normPrimaryOverride(row.primary_override),
        row.default_direction != null && String(row.default_direction).trim() ? String(row.default_direction).trim() : null,
        String(row.default_design || "").trim() || DEFAULT_DRIVING_DESIGN_TEMPLATE,
        row.origin_template_id != null && String(row.origin_template_id).trim() ? String(row.origin_template_id).trim() : null,
        serializeTitleRule(row.title_rule),
        row.created_at != null && String(row.created_at).trim() ? String(row.created_at).trim() : null]);
  }
  // C + randomUUID 앞 6 hex. 빌트인(T01~)·기존 커스텀 row 와 충돌하지 않는 id 를 발급한다.
  // slot_id 는 domain+template_id 해시라, template_id 가 유니크하면 슬롯 충돌은 없다.
  private nextCustomTemplateId(domain: string): string {
    for (let i = 0; i < 50; i++) {
      const candidate = `C${randomUUID().replace(/-/g, "").slice(0, 6)}`;
      if ((TEMPLATE_SPECS as Record<string, unknown>)[candidate]) continue;
      if (this.get("SELECT 1 FROM custom_templates WHERE domain=? AND template_id=?", [domain, candidate])) continue;
      return candidate;
    }
    throw new Error("failed to allocate unique custom template id");
  }

  listAxes(domain: string): Record<AxisName, Row[]> {
    const out = Object.fromEntries(AXES.map((a) => [a, []])) as unknown as Record<AxisName, Row[]>;
    for (const row of this.all("SELECT * FROM axes WHERE domain=? ORDER BY axis, weight DESC, value", [domain])) out[row.axis as AxisName]?.push(row);
    return out;
  }
  bulkReplaceAxis(domain: string, axis: AxisName, values: Row[]): void {
    this.transaction(() => {
      this.run("DELETE FROM axes WHERE domain=? AND axis=?", [domain, axis]);
      for (const v of values) {
        this.run(`INSERT INTO axes (domain, axis, value, weight, monthly_search_volume, competition_kd) VALUES (?, ?, ?, ?, ?, ?)`,
          [domain, axis, v.value, Number(v.weight ?? 3), v.monthly_search_volume ?? null, v.competition_kd ?? null]);
      }
    });
  }

  listSlots(domain: string, opts: { status?: string; template?: string; q?: string; limit?: number; offset?: number } = {}): Row[] {
    const { where, args } = this.slotFilterClause(domain, opts);
    const limit = Math.max(1, Math.min(2000, Math.trunc(Number(opts.limit ?? 200))));
    const offset = Math.max(0, Math.trunc(Number(opts.offset ?? 0)));
    return this.all(`SELECT * FROM slots ${where} ORDER BY priority_score DESC, slot_id LIMIT ? OFFSET ?`, [...args, limit, offset]);
  }
  countSlotsFiltered(domain: string, opts: { status?: string; template?: string; q?: string } = {}): number {
    const { where, args } = this.slotFilterClause(domain, opts);
    return Number(this.get(`SELECT COUNT(*) AS n FROM slots ${where}`, args)?.n ?? 0);
  }
  private slotFilterClause(domain: string, opts: { status?: string; template?: string; q?: string }): { where: string; args: any[] } {
    let where = "WHERE domain=?"; const args: any[] = [domain];
    if (opts.status) { where += " AND status=?"; args.push(opts.status); }
    if (opts.template) { where += " AND template_id=?"; args.push(opts.template); }
    const q = String(opts.q || "").trim().toLowerCase();
    if (q) {
      const like = `%${q}%`;
      where += ` AND (
        lower(primary_keyword) LIKE ? OR lower(slot_id) LIKE ? OR lower(COALESCE(region,'')) LIKE ?
        OR lower(COALESCE(persona,'')) LIKE ? OR lower(COALESCE(intent,'')) LIKE ?
        OR lower(COALESCE(modifier_1,'')) LIKE ? OR lower(COALESCE(modifier_2,'')) LIKE ?
        OR lower(COALESCE(entity_id,'')) LIKE ?
      )`;
      args.push(like, like, like, like, like, like, like, like);
    }
    const exclusionTerms = parseExclusionTerms(this.get("SELECT excluded_keywords FROM domains WHERE domain=?", [domain])?.excluded_keywords);
    if (exclusionTerms.length) {
      const exclusion = slotExclusionSql("");
      for (const term of exclusionTerms) {
        where += ` AND ${exclusion.predicate}`;
        args.push(...exclusion.argsForTerm(term));
      }
    }
    return { where, args };
  }
  selectSlotsForBatch(domain: string, opts: { q?: string; template?: string; limit?: number; balanced?: boolean } = {}): Row[] {
    const { where, args } = this.slotFilterClause(domain, { status: "planned", template: opts.template, q: opts.q });
    const candidates = this.all(`SELECT slot_id, region, template_id, primary_keyword, priority_score FROM slots ${where} ORDER BY priority_score DESC, slot_id LIMIT ?`, [...args, 10000]);
    const limit = Math.max(1, Math.min(500, Math.trunc(Number(opts.limit ?? 10))));
    const groups = new Map<string, Row[]>();
    for (const row of candidates) {
      const key = opts.balanced ? String(row.region || "전국") : String(row.template_id || "기타");
      const bucket = groups.get(key) || [];
      bucket.push(row);
      groups.set(key, bucket);
    }
    const keys = [...groups.keys()].sort((a, b) => (groups.get(b)?.[0]?.priority_score ?? 0) - (groups.get(a)?.[0]?.priority_score ?? 0));
    const picked: Row[] = [];
    const seenTopic = new Set<string>();
    while (picked.length < limit && keys.length) {
      let progressed = false;
      for (const key of [...keys]) {
        const bucket = groups.get(key) || [];
        let next: Row | undefined;
        while (bucket.length) {
          const candidate = bucket.shift()!;
          const topic = `${candidate.region || ""}::${candidate.primary_keyword || ""}`;
          if (!seenTopic.has(topic)) { next = candidate; seenTopic.add(topic); break; }
        }
        if (next) { picked.push(next); progressed = true; }
        if (!bucket.length) keys.splice(keys.indexOf(key), 1);
        if (picked.length >= limit) break;
      }
      if (!progressed) break;
    }
    return picked;
  }
  countSlots(domain: string): Record<string, number> {
    const out: Record<string, number> = { planned: 0, in_progress: 0, published: 0, failed: 0, skipped: 0 };
    for (const r of this.all("SELECT status, COUNT(*) AS n FROM slots WHERE domain=? GROUP BY status", [domain])) out[r.status] = r.n;
    return out;
  }
  bulkUpsertSlots(rows: Row[]): number {
    if (!rows.length) return 0;
    // prepared statement 1회 재사용 + 단일 트랜잭션. 한 행씩 개별 커밋하면 행마다 fsync 가 일어나
    // 수천~수만 건에서 동기 삽입이 극단적으로 느려져(이벤트 루프 블로킹) 요청이 타임아웃/500 이 된다.
    const stmt = this.db.prepare(`INSERT INTO slots (slot_id, domain, template_id, primary_keyword, region, persona, intent, modifier_1, modifier_2, entity_id, priority_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(slot_id) DO UPDATE SET primary_keyword=excluded.primary_keyword, priority_score=excluded.priority_score`);
    let inserted = 0;
    this.transaction(() => {
      for (const s of rows) {
        const res = stmt.run(s.slot_id, s.domain, s.template_id, s.primary_keyword, s.region ?? null, s.persona ?? null, s.intent ?? null, s.modifier_1 ?? null, s.modifier_2 ?? null, s.entity_id ?? null, s.priority_score ?? null);
        if (res.changes) inserted += 1;
      }
    });
    return inserted;
  }
  getSlot(slotId: string): Row | undefined { return this.get("SELECT * FROM slots WHERE slot_id=?", [slotId]); }
  /**
   * T16 부제 변형 회전용 서수. 같은 (도메인·지역·수식어·의도) 슬롯을 slot_id로 정렬해 이 슬롯의
   * 0-based 순위를 돌려준다 → buildT16AxisPlan variantOffset 으로 넘기면 형제마다 부제 조합이 겹치지
   * 않아 제목 완전중복이 사라진다. 형제 집합이 바뀌면 순위(=부제)도 바뀔 수 있다(재현성은 집합 고정 시).
   */
  getT16SubtitleOrdinal(slot: Row): number {
    const domain = String(slot.domain || "");
    const slotId = String(slot.slot_id || "");
    if (!domain || !slotId) return 0;
    const rows = this.all(
      "SELECT slot_id FROM slots WHERE domain=? AND IFNULL(region,'')=? AND IFNULL(modifier_1,'')=? AND IFNULL(intent,'')=? ORDER BY slot_id",
      [domain, String(slot.region || ""), String(slot.modifier_1 || ""), String(slot.intent || "")],
    );
    const idx = rows.findIndex((r) => String(r.slot_id) === slotId);
    return idx < 0 ? 0 : idx;
  }
  updateSlotStatus(slotId: string, status: string, error?: string | null): void {
    if (error !== undefined) this.run("UPDATE slots SET status=?, last_error=? WHERE slot_id=?", [status, error, slotId]);
    else this.run("UPDATE slots SET status=? WHERE slot_id=?", [status, slotId]);
  }
  // 슬롯 수동 제목(원문 저장 — 플레이스홀더는 생성 시점 치환). 빈/공백은 null(=규칙/LLM 로 폴백).
  updateSlotTitle(slotId: string, title: string | null): number {
    const val = title != null && String(title).trim() ? String(title).trim() : null;
    return this.run("UPDATE slots SET title=? WHERE slot_id=?", [val, slotId]).changes ?? 0;
  }
  deleteSlot(domain: string, slotId: string): number { return this.run("DELETE FROM slots WHERE slot_id=? AND domain=?", [slotId, domain]).changes ?? 0; }

  listPosts(domain: string, opts: { status?: string; limit?: number; jobId?: string } = {}): Row[] {
    let sql = `SELECT id, domain, slot_id, slug, title, meta_description, status, design_template_id, provider, model, cost_usd, duration_sec, generated_at, job_id, image_count, image_cost_usd, length(body_markdown) AS body_chars FROM posts WHERE domain=?`;
    const args: any[] = [domain];
    if (opts.status) { sql += " AND status=?"; args.push(opts.status); }
    if (opts.jobId) { sql += " AND job_id=?"; args.push(opts.jobId); }
    sql += " ORDER BY generated_at DESC LIMIT ?"; args.push(opts.limit ?? 200);
    return this.all(sql, args);
  }
  getPost(postId: string): Row | undefined { return this.get("SELECT * FROM posts WHERE id=?", [postId]); }
  getPostBySlug(domain: string, slug: string, status?: string): Row | undefined {
    return this.get(`SELECT * FROM posts WHERE domain=? AND slug=?${status ? " AND status=?" : ""}`, status ? [domain, slug, status] : [domain, slug]);
  }
  // 오늘(로컬 기준) 생성돼 살아있는(삭제 안 된) 글 수 — 일일 한도 집행에 사용.
  countPostsToday(domain: string): number {
    const row = this.get("SELECT COUNT(*) AS n FROM posts WHERE domain=? AND status!='deleted' AND date(generated_at, 'localtime')=date('now', 'localtime')", [domain]);
    return Number(row?.n ?? 0);
  }
  uniqueSlug(domain: string, base: string, slotId?: string | null): string {
    if (slotId) {
      const existingForSlot = this.get("SELECT slug FROM posts WHERE domain=? AND slot_id=? AND status!='deleted' ORDER BY generated_at DESC LIMIT 1", [domain, slotId]);
      if (existingForSlot?.slug) return existingForSlot.slug;
    }
    let cand = (base || "post").replace(/^-+|-+$/g, "") || "post"; let i = 2;
    while (true) {
      const row = this.get("SELECT slot_id FROM posts WHERE domain=? AND slug=?", [domain, cand]);
      if (!row || row.slot_id === slotId) return cand;
      cand = `${base}-${i++}`;
    }
  }
  insertPost(input: Row): string {
    const id = randomUUID();
    this.run(`INSERT INTO posts (id, domain, slot_id, slug, title, body_markdown, meta_description, images, design_template_id, provider, model, session_id, cost_usd, duration_sec, input_tokens, output_tokens, job_id, image_count, image_cost_usd, academy_count, region, primary_keyword, academy_names)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(domain, slug) DO UPDATE SET title=excluded.title, slot_id=excluded.slot_id, body_markdown=excluded.body_markdown, meta_description=excluded.meta_description, images=excluded.images, design_template_id=excluded.design_template_id, status='published', provider=excluded.provider, model=excluded.model, session_id=excluded.session_id, cost_usd=excluded.cost_usd, duration_sec=excluded.duration_sec, input_tokens=excluded.input_tokens, output_tokens=excluded.output_tokens, job_id=excluded.job_id, image_count=excluded.image_count, image_cost_usd=excluded.image_cost_usd, academy_count=excluded.academy_count, region=excluded.region, primary_keyword=excluded.primary_keyword, academy_names=excluded.academy_names, generated_at=CURRENT_TIMESTAMP`,
      [id, input.domain, input.slot_id ?? null, input.slug, input.title, input.body_markdown, input.meta_description ?? null, input.images ?? null, input.design_template_id || DEFAULT_DRIVING_DESIGN_TEMPLATE, input.provider ?? null, input.model ?? null, input.session_id ?? null, input.cost_usd ?? 0, input.duration_sec ?? null, input.input_tokens ?? 0, input.output_tokens ?? 0, input.job_id ?? null, input.image_count ?? 0, input.image_cost_usd ?? 0, input.academy_count ?? null, input.region ?? null, input.primary_keyword ?? null, input.academy_names ?? null]);
    return id;
  }
  deletePost(postId: string): void { this.run("DELETE FROM posts WHERE id=?", [postId]); }
  updatePostStatus(postId: string, status: string): void { this.run("UPDATE posts SET status=? WHERE id=?", [status, postId]); }

  // --- 격리(draft_posts): 게이트 미통과 글 보관/검수 ---
  insertDraftPost(input: Row): string {
    const id = randomUUID();
    this.run(`INSERT INTO draft_posts (id, domain, slot_id, title, body_markdown, meta_description, images, design_template_id, region, primary_keyword, academy_names, facts_text, quality_issues, gate_stage, blocking_class, provider, model, job_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.domain, input.slot_id ?? null, input.title ?? null, input.body_markdown, input.meta_description ?? null, input.images ?? null, input.design_template_id || DEFAULT_DRIVING_DESIGN_TEMPLATE, input.region ?? null, input.primary_keyword ?? null, input.academy_names ?? null, input.facts_text ?? null, input.quality_issues ?? "[]", input.gate_stage ?? null, input.blocking_class === "A" ? "A" : "B", input.provider ?? null, input.model ?? null, input.job_id ?? null]);
    return id;
  }
  listDraftPosts(domain: string, opts: { reviewStatus?: string; limit?: number } = {}): Row[] {
    let sql = `SELECT id, domain, slot_id, title, meta_description, design_template_id, region, primary_keyword, quality_issues, gate_stage, blocking_class, review_status, provider, model, job_id, created_at, reviewed_at, length(body_markdown) AS body_chars FROM draft_posts WHERE domain=?`;
    const args: any[] = [domain];
    if (opts.reviewStatus) { sql += " AND review_status=?"; args.push(opts.reviewStatus); }
    sql += " ORDER BY created_at DESC LIMIT ?"; args.push(opts.limit ?? 200);
    return this.all(sql, args);
  }
  countDraftPosts(domain: string, reviewStatus = "pending"): number {
    const row = this.get("SELECT COUNT(*) AS n FROM draft_posts WHERE domain=? AND review_status=?", [domain, reviewStatus]);
    return Number(row?.n ?? 0);
  }
  getDraftPost(draftId: string): Row | undefined { return this.get("SELECT * FROM draft_posts WHERE id=?", [draftId]); }
  setDraftReviewStatus(draftId: string, status: string): void {
    this.run("UPDATE draft_posts SET review_status=?, reviewed_at=CURRENT_TIMESTAMP WHERE id=?", [status, draftId]);
  }
  // 관리자가 본문을 수정해 재검증한 결과를 반영(본문·이슈·차단등급 갱신).
  updateDraftAfterRevalidate(draftId: string, bodyMarkdown: string, qualityIssuesJson: string, blockingClass: string): void {
    this.run("UPDATE draft_posts SET body_markdown=?, quality_issues=?, blocking_class=? WHERE id=?",
      [bodyMarkdown, qualityIssuesJson, blockingClass === "A" ? "A" : "B", draftId]);
  }
  deleteDraftPost(draftId: string): void { this.run("DELETE FROM draft_posts WHERE id=?", [draftId]); }
  // 검수 통과 draft 를 실제 발행글로 승격. 슬롯당 slug 재사용 규칙(uniqueSlug)을 그대로 따른다.
  // 안전 판단(blocking_class==='B' 차단)은 호출부(컨트롤러)에서 강제한다.
  promoteDraftToPost(draftId: string): string {
    const draft = this.getDraftPost(draftId);
    if (!draft) throw new Error("draft not found");
    const title = String(draft.title || "").trim() || "제목 없음";
    const slug = this.uniqueSlug(draft.domain, slugify(title), draft.slot_id ?? null);
    const postId = this.insertPost({
      domain: draft.domain, slot_id: draft.slot_id ?? null, slug, title, body_markdown: draft.body_markdown,
      meta_description: draft.meta_description ?? null, images: draft.images ?? null, design_template_id: draft.design_template_id,
      provider: draft.provider ?? null, model: draft.model ?? null, job_id: draft.job_id ?? null,
      region: draft.region ?? null, primary_keyword: draft.primary_keyword ?? null, academy_names: draft.academy_names ?? null,
    });
    if (draft.slot_id) this.updateSlotStatus(draft.slot_id, "published");
    this.setDraftReviewStatus(draftId, "promoted");
    return postId;
  }
  listPostsForDedup(domain: string, includeNoindex = false): Row[] {
    const statuses = includeNoindex ? "('published','noindex')" : "('published')";
    return this.all(`SELECT p.id, p.slug, p.title, p.body_markdown, p.status, p.generated_at, s.priority_score AS priority_score FROM posts p LEFT JOIN slots s ON s.slot_id = p.slot_id WHERE p.domain=? AND p.status IN ${statuses} ORDER BY p.generated_at ASC`, [domain]);
  }

  getSetting(key: string): string | null { return this.get("SELECT value FROM app_settings WHERE key=?", [key])?.value ?? null; }
  setSetting(key: string, value: string | null): void {
    this.run(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`, [key, value]);
  }

  // 업종 레지스트리(라벨 MVP): app_settings 에 {key,label}[] 로 저장. 미저장 시 driving 시드.
  // key 는 프리셋 선택/프롬프트에 쓰는 슬러그, label 은 화면 표시명(생성폼·설정·뱃지 공통 소스).
  getVerticals(): Array<{ key: string; label: string }> {
    const raw = this.getSetting("verticals");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const list = parsed.filter((v): v is { key: string; label: string } => v && typeof v.key === "string" && typeof v.label === "string" && v.key.trim() !== "");
          if (list.length) return list;
        }
      } catch { /* 손상 시 시드로 폴백 */ }
    }
    return [{ key: "driving", label: "운전면허/운전학원" }];
  }
  setVerticals(list: Array<{ key: string; label: string }>): void { this.setSetting("verticals", JSON.stringify(list)); }
  countDomainsByVertical(key: string): number { return Number(this.get("SELECT COUNT(*) AS n FROM domains WHERE vertical=?", [key])?.n ?? 0); }

  upsertAcademies(domain: string, rows: Row[]): number {
    let n = 0;
    for (const r of rows) {
      const name = String(r.name || "").trim(); if (!name) continue;
      const extra = typeof r.extra === "object" && r.extra !== null ? JSON.stringify(r.extra) : (r.extra ?? null);
      this.run(`INSERT INTO academies (id, domain, external_id, region, name, address, price, shuttle, hours, pass_rate, phone, vphone, review, review_json, blog_reviews, seo_title, seo_keywords, seo_description, latitude, longitude, thumb_url, photos, academy_type, extra, source_name, source_url, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(domain, region, name) DO UPDATE SET address=excluded.address, price=excluded.price, shuttle=excluded.shuttle, hours=excluded.hours, pass_rate=excluded.pass_rate, phone=excluded.phone, vphone=excluded.vphone, review=excluded.review, review_json=excluded.review_json, blog_reviews=excluded.blog_reviews, seo_title=excluded.seo_title, seo_keywords=excluded.seo_keywords, seo_description=excluded.seo_description, latitude=excluded.latitude, longitude=excluded.longitude, thumb_url=excluded.thumb_url, photos=excluded.photos, academy_type=excluded.academy_type, extra=excluded.extra, source_name=excluded.source_name, source_url=excluded.source_url, synced_at=excluded.synced_at`,
        [randomUUID(), domain, r.external_id ?? null, String(r.region || "").trim(), name, r.address ?? null, r.price ?? null, r.shuttle ?? null, r.hours ?? null, r.pass_rate ?? null, r.phone ?? null, r.vphone ?? null, r.review ?? null, encodeJson(r.review_json ?? r.reviews), encodeJson(r.blog_reviews), r.seo_title ?? null, r.seo_keywords ?? null, r.seo_description ?? null, r.latitude ?? null, r.longitude ?? null, r.thumb_url ?? null, encodeJson(r.photos), r.academy_type ?? null, extra, r.source_name ?? null, r.source_url ?? null, r.synced_at ?? null]);
      n += 1;
    }
    return n;
  }
  // ---- 원천 동기화 실행 이력 ----
  createSyncRun(domain: string, scope: string): string {
    const id = randomUUID();
    this.run("INSERT INTO sync_runs (id, domain, scope, status) VALUES (?,?,?,'running')", [id, domain, scope]);
    return id;
  }

  updateSyncRun(id: string, patch: { status?: string; step?: string; count_total?: number; count_done?: number; result?: unknown; error?: string; finished?: boolean }): void {
    const sets: string[] = [];
    const params: any[] = [];
    if (patch.status !== undefined) { sets.push("status=?"); params.push(patch.status); }
    if (patch.step !== undefined) { sets.push("step=?"); params.push(patch.step); }
    if (patch.count_total !== undefined) { sets.push("count_total=?"); params.push(patch.count_total); }
    if (patch.count_done !== undefined) { sets.push("count_done=?"); params.push(patch.count_done); }
    if (patch.result !== undefined) { sets.push("result=?"); params.push(patch.result === null ? null : JSON.stringify(patch.result)); }
    if (patch.error !== undefined) { sets.push("error=?"); params.push(patch.error); }
    if (patch.finished) { sets.push("finished_at=?"); params.push(nowSql()); }
    if (!sets.length) return;
    params.push(id);
    this.run(`UPDATE sync_runs SET ${sets.join(", ")} WHERE id=?`, params);
  }

  getSyncRun(id: string): Row | undefined { return this.get("SELECT * FROM sync_runs WHERE id=?", [id]); }

  listSyncRuns(domain: string, limit = 20): Row[] {
    return this.all("SELECT * FROM sync_runs WHERE domain=? ORDER BY started_at DESC LIMIT ?", [domain, Math.max(1, Math.min(200, limit))]);
  }

  // 진행 중인 동기화. 같은 원천을 두드리므로 도메인을 가리지 않고 하나만 허용한다.
  findRunningSyncRun(scope?: string): Row | undefined {
    return scope
      ? this.get("SELECT * FROM sync_runs WHERE status='running' AND scope=? ORDER BY started_at DESC", [scope])
      : this.get("SELECT * FROM sync_runs WHERE status='running' ORDER BY started_at DESC");
  }

  // 취소 요청. 실행 중인 것만 대상으로 한다(이미 끝난 실행에 표시해 봐야 의미가 없다).
  requestSyncCancel(id: string): boolean {
    const run = this.getSyncRun(id);
    if (!run || run.status !== "running") return false;
    this.run("UPDATE sync_runs SET cancel_requested=1 WHERE id=?", [id]);
    return true;
  }

  isSyncCancelRequested(id: string): boolean {
    return Number(this.get("SELECT cancel_requested FROM sync_runs WHERE id=?", [id])?.cancel_requested ?? 0) === 1;
  }

  /**
   * @param opts.blogReviewsAttempted 이번 동기화가 블로그리뷰를 조회했는지. 기본 true.
   *   false 면(수집 스위치가 꺼진 평소 상태) 기존 값을 그대로 이어받되 "못 가져왔다" 로 세지 않는다.
   *   안 그러면 의도적으로 안 받은 것이 전 학원 미조회 경고로 뜬다.
   */
  upsertDrivingplusAcademies(domain: string, rows: Row[], opts: { blogReviewsAttempted?: boolean } = {}): { fetched: number; upserted: number; skipped: number; review_count: number; blog_review_count: number; blog_review_preserved: number; warnings: string[] } {
    const blogReviewsAttempted = opts.blogReviewsAttempted !== false;
    let upserted = 0, skipped = 0;
    let reviewCount = 0, blogReviewCount = 0;
    let blogReviewPreserved = 0;
    const warnings: string[] = [];
    const regions = this.listSeoRegions(domain);
    // 셔틀 운행 지역 판별용 전역 사전. 동기화 1회당 한 번만 읽고 학원별로 반경 안만 추린다.
    const directory = this.listRegionDirectory() as unknown as Array<RegionDirectoryEntry & { latitude: number | null; longitude: number | null }>;
    const syncedAt = nowSql();
    this.transaction(() => {
      for (const row of rows) {
        const externalId = String(row.id ?? "").trim();
        const name = String(row.title || "").trim();
        if (!externalId || !name) { skipped++; continue; }
        const address = nullableText(row.roadAddress);
        const region = bestRegionForAddress(address, regions) || fallbackRegionFromAddress(address);
        if (!region) warnings.push(`${name}: 주소에서 지역을 추정하지 못했습니다.`);
        const photos = Array.isArray(row.photos) ? row.photos.map((v) => String(v || "").trim()).filter(Boolean) : [];
        const reviews = normalizeDrivingplusReviews(row.reviews);
        // 원천이 블로그리뷰를 못 내려준 학원은 blogReviews 가 undefined 로 온다(빈 배열이 아니다).
        // 이때 덮어쓰면 전량교체 정책상 기존 후기가 삭제되므로, 기존 값을 그대로 이어받는다.
        // 원천이 진짜 0건을 확인해준 경우(빈 배열)는 의도대로 삭제된다.
        const existing = this.get("SELECT id, blog_reviews, extra FROM academies WHERE domain=? AND external_id=?", [domain, externalId]);
        const blogReviewsFetched = row.blogReviews !== undefined;
        const existingExtra = blogReviewsFetched ? null : decodeJsonObject(existing?.extra);
        const blogReviews = blogReviewsFetched
          ? normalizeDrivingplusBlogReviews(row.blogReviews)
          : normalizeDrivingplusBlogReviews(decodeJsonArray(existing?.blog_reviews));
        if (!blogReviewsFetched && blogReviewsAttempted) blogReviewPreserved++;
        reviewCount += reviews.length;
        blogReviewCount += blogReviews.length;
        const reviewText = reviewSummaryText(reviews);
        // 셔틀·영업시간·수강료·면허 종별은 dev·운영 endpoint 모두 내려준다(2026-07-27 실측: 운영 380곳
        // 기준 셔틀 212 · 영업시간 256 · 수강료 331 · 면허 종별 336). 예전 주석은 "운영에는 셔틀·영업시간
        // 키가 없다"였는데 사실이 아니었다. 값이 없는 학원은 어느 쪽이든 null/빈 배열로 안전하게 흘러간다.
        // 필드별 현황은 docs/source-field-usage.md.
        // pass_rate 는 의도적으로 채우지 않는다: accidentRate 는 교통사고율, graduates 는 수료생 수이며
        // 합격률 원천은 어디에도 없다. 합격률로 오독하면 글에 근거 없는 합격 주장이 실린다.
        const performance = (row.educationPerformance ?? null) as DrivingplusEducationPerformance | null;
        const price = formatTuitionFact(performance);
        const shuttle = formatShuttleFact((row.shuttleBuses ?? []) as DrivingplusShuttleBus[], nearbyDirectoryRegions(directory, nullableNumber(row.roadLatitude), nullableNumber(row.roadLongitude)));
        const hours = formatOperatingHoursFact((row.operateHour ?? null) as DrivingplusOperateHour | null);
        // extra 는 원천 응답을 손실 없이 보관하는 자리다(컬럼으로 승격한 값 외 전부).
        // 새 키를 읽어 facts/프롬프트로 올릴지는 별도 판단이며, 여기서는 저장만 한다.
        const extra = JSON.stringify({
          drivingplus_id: externalId,
          review_count: reviews.length,
          blog_review_count: blogReviews.length,
          // 동기화 레이어로 들어온 개수(API 레이어 긍정 필터 통과분). 원천 총량은 review_stats 를 본다.
          fetched_review_count: Array.isArray(row.reviews) ? row.reviews.length : 0,
          fetched_blog_review_count: blogReviewsFetched
            ? (Array.isArray(row.blogReviews) ? row.blogReviews.length : 0)
            : (existingExtra?.fetched_blog_review_count ?? 0),
          review_stats: row.reviewStats ?? null,
          // 조회를 못 한 경우 통계도 기존 값을 유지한다. 안 그러면 후기는 남았는데 통계만 0이 된다.
          blog_review_stats: blogReviewsFetched ? (row.blogReviewStats ?? null) : (existingExtra?.blog_review_stats ?? null),
          license_types: row.licenseTypes ?? [],
          education_performance: performance,
          price_observations: row.priceObservations ?? [],
          shuttle_buses: row.shuttleBuses ?? [],
          shuttle_bus_url: nullableText(row.shuttleBusUrl),
          shuttle_bus_detail: nullableText(row.shuttleBusDetail),
          shuttle_bus_image_url: nullableText(row.shuttleBusImageUrl),
          operate_hour: row.operateHour ?? null,
          road_courses: row.roadCourses ?? [],
        });
        if (existing) {
          this.run(`UPDATE academies SET region=?, name=?, address=?, price=?, shuttle=?, hours=?, phone=?, vphone=?, review=?, review_json=?, blog_reviews=?, seo_title=?, seo_keywords=?, seo_description=?, seo_content=?, latitude=?, longitude=?, thumb_url=?, photos=?, academy_type=?, extra=?, source_name=?, source_url=?, synced_at=? WHERE id=? AND domain=?`,
            [region, name, address, price, shuttle, hours, nullableText(row.phone), nullableText(row.vphone), reviewText, JSON.stringify(reviews), JSON.stringify(blogReviews), nullableText(row.seoTitle), nullableText(row.seoKeywords), nullableText(row.seoDescription), nullableText(row.seoContent), nullableNumber(row.roadLatitude), nullableNumber(row.roadLongitude), nullableText(row.thumbSavePath), JSON.stringify(photos), nullableText(row.type), extra, "DrivingPlus", `${drivingplusApiBaseUrl()}/v1/academy/get-all-academy`, syncedAt, existing.id, domain]);
        } else {
          this.run(`INSERT INTO academies (id, domain, external_id, region, name, address, price, shuttle, hours, phone, vphone, review, review_json, blog_reviews, seo_title, seo_keywords, seo_description, seo_content, latitude, longitude, thumb_url, photos, academy_type, extra, source_name, source_url, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            -- blog_reviews 를 NULL 로 넣으면 위 COALESCE 가 (domain, region, name) 충돌 시 기존 값을 지킨다
            ON CONFLICT(domain, region, name) DO UPDATE SET external_id=excluded.external_id, address=excluded.address, price=excluded.price, shuttle=excluded.shuttle, hours=excluded.hours, phone=excluded.phone, vphone=excluded.vphone, review=excluded.review, review_json=excluded.review_json, blog_reviews=COALESCE(excluded.blog_reviews, academies.blog_reviews), seo_title=excluded.seo_title, seo_keywords=excluded.seo_keywords, seo_description=excluded.seo_description, seo_content=excluded.seo_content, latitude=excluded.latitude, longitude=excluded.longitude, thumb_url=excluded.thumb_url, photos=excluded.photos, academy_type=excluded.academy_type, extra=excluded.extra, source_name=excluded.source_name, source_url=excluded.source_url, synced_at=excluded.synced_at
            WHERE academies.external_id IS NULL OR academies.external_id=excluded.external_id`,
            [randomUUID(), domain, externalId, region, name, address, price, shuttle, hours, nullableText(row.phone), nullableText(row.vphone), reviewText, JSON.stringify(reviews), blogReviewsFetched ? JSON.stringify(blogReviews) : null, nullableText(row.seoTitle), nullableText(row.seoKeywords), nullableText(row.seoDescription), nullableText(row.seoContent), nullableNumber(row.roadLatitude), nullableNumber(row.roadLongitude), nullableText(row.thumbSavePath), JSON.stringify(photos), nullableText(row.type), extra, "DrivingPlus", `${drivingplusApiBaseUrl()}/v1/academy/get-all-academy`, syncedAt]);
        }
        upserted++;
      }
    });
    if (blogReviewPreserved > 0) {
      warnings.unshift(`블로그리뷰를 가져오지 못한 학원 ${blogReviewPreserved}곳은 기존 후기를 유지했습니다(삭제하지 않음).`);
    }
    return { fetched: rows.length, upserted, skipped, review_count: reviewCount, blog_review_count: blogReviewCount, blog_review_preserved: blogReviewPreserved, warnings: warnings.slice(0, 50) };
  }
  listAcademies(domain: string, opts: { region?: string; academy_type?: string; academy_types?: string[]; q?: string; has_photos?: boolean; limit?: number } = {}): Row[] {
    let sql = "SELECT * FROM academies WHERE domain=?"; const args: any[] = [domain];
    if (opts.region) { sql += " AND region LIKE ?"; args.push(`%${opts.region}%`); }
    if (opts.academy_type) { sql += " AND academy_type=?"; args.push(opts.academy_type); }
    if (opts.academy_types?.length) {
      sql += ` AND academy_type IN (${opts.academy_types.map(() => "?").join(",")})`;
      args.push(...opts.academy_types);
    }
    if (opts.has_photos) sql += " AND (thumb_url IS NOT NULL OR (photos IS NOT NULL AND photos NOT IN ('', '[]', 'null')))";
    const q = String(opts.q || "").trim().toLowerCase();
    if (q) {
      const like = `%${q}%`;
      sql += ` AND (
        lower(name) LIKE ? OR lower(COALESCE(address,'')) LIKE ? OR lower(COALESCE(region,'')) LIKE ?
        OR lower(COALESCE(external_id,'')) LIKE ? OR lower(COALESCE(phone,'')) LIKE ?
        OR lower(COALESCE(vphone,'')) LIKE ? OR lower(COALESCE(seo_title,'')) LIKE ?
        OR lower(COALESCE(seo_keywords,'')) LIKE ? OR lower(COALESCE(seo_description,'')) LIKE ?
      )`;
      args.push(like, like, like, like, like, like, like, like, like);
    }
    sql += " ORDER BY name LIMIT ?"; args.push(opts.limit ?? 20);
    return this.all(sql, args);
  }
  listAcademyTypes(domain: string): Row[] {
    return this.all(`SELECT academy_type AS value, COUNT(*) AS count
      FROM academies
      WHERE domain=? AND academy_type IS NOT NULL AND academy_type!=''
      GROUP BY academy_type
      ORDER BY count DESC, academy_type`, [domain]);
  }
  getSeoRegion(domain: string, region: string): Row | undefined {
    return this.get("SELECT * FROM seo_regions WHERE domain=? AND region=? ORDER BY level DESC LIMIT 1", [domain, region]);
  }
  listSeoRegions(domain: string, opts: { level?: number; limit?: number } = {}): Row[] {
    let sql = "SELECT * FROM seo_regions WHERE domain=?"; const args: any[] = [domain];
    if (opts.level) { sql += " AND level=?"; args.push(opts.level); }
    sql += " ORDER BY level, region LIMIT ?"; args.push(opts.limit ?? 10000);
    return this.all(sql, args);
  }
  upsertSeoRegions(domain: string, rows: Row[], sourceName = "DrivingPlus"): { fetched: number; upserted: number; skipped: number } {
    let upserted = 0, skipped = 0;
    const syncedAt = nowSql();
    this.transaction(() => {
      for (const row of rows) {
        const level = Number(row.level);
        const region = String(row.region || "").trim();
        if (!Number.isFinite(level) || !region) { skipped++; continue; }
        this.run(`INSERT INTO seo_regions (domain, level, region, latitude, longitude, source_name, synced_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(domain, level, region) DO UPDATE SET latitude=excluded.latitude, longitude=excluded.longitude, source_name=excluded.source_name, synced_at=excluded.synced_at`,
          [domain, level, region, nullableNumber(row.latitude), nullableNumber(row.longitude), sourceName, syncedAt]);
        upserted++;
      }
    });
    return { fetched: rows.length, upserted, skipped };
  }
  // 전역 행정구역 사전. 도메인 인자가 없는 것이 의도다(모든 도메인이 같은 표를 본다).
  upsertRegionDirectory(rows: Row[], sourceName = "DrivingPlus"): { fetched: number; upserted: number; skipped: number } {
    let upserted = 0, skipped = 0;
    const syncedAt = nowSql();
    this.transaction(() => {
      for (const row of rows) {
        const level = Number(row.level);
        const region = String(row.region || "").trim();
        const parts = region.split(/\s+/).filter(Boolean);
        // 시·도만 있는 행(parts 1개)은 매칭 토큰이 없어 쓸모가 없다.
        if (!Number.isFinite(level) || parts.length < 2) { skipped++; continue; }
        const sido = parts[0]!;
        const sigungu = parts[1] ?? null;
        const submunicipal = parts.length >= 3 ? parts.slice(2).join(" ") : null;
        this.run(`INSERT INTO region_directory (region, level, sido, sigungu, submunicipal, latitude, longitude, source_name, synced_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(region) DO UPDATE SET level=excluded.level, sido=excluded.sido, sigungu=excluded.sigungu, submunicipal=excluded.submunicipal,
            latitude=excluded.latitude, longitude=excluded.longitude, source_name=excluded.source_name, synced_at=excluded.synced_at`,
          [region, level, sido, sigungu, submunicipal, nullableNumber(row.latitude), nullableNumber(row.longitude), sourceName, syncedAt]);
        upserted++;
      }
    });
    return { fetched: rows.length, upserted, skipped };
  }
  listRegionDirectory(): Row[] { return this.all("SELECT * FROM region_directory"); }
  /** 사전이 실제로 얼마나 쓰이는지 보여주는 지표(관리자 화면용). */
  shuttleRegionCoverage(domain: string): { with_shuttle: number; with_region: number } {
    const row = this.get(
      `SELECT COUNT(*) n, SUM(CASE WHEN shuttle LIKE '%운행 지역%' THEN 1 ELSE 0 END) r
       FROM academies WHERE domain=? AND COALESCE(TRIM(shuttle),'') <> ''`,
      [domain],
    );
    return { with_shuttle: Number(row?.n ?? 0), with_region: Number(row?.r ?? 0) };
  }
  regionDirectoryStatus(): { total: number; by_level: Record<string, number>; synced_at: string | null } {
    const total = Number(this.get("SELECT COUNT(*) n FROM region_directory")?.n ?? 0);
    const by_level: Record<string, number> = {};
    for (const row of this.all("SELECT level, COUNT(*) n FROM region_directory GROUP BY level ORDER BY level")) by_level[String(row.level)] = Number(row.n);
    return { total, by_level, synced_at: (this.get("SELECT MAX(synced_at) s FROM region_directory")?.s as string) ?? null };
  }
  deleteAcademy(domain: string, id: string): number { return this.run("DELETE FROM academies WHERE id=? AND domain=?", [id, domain]).changes ?? 0; }
  deleteAcademies(domain: string, region?: string): number {
    return this.run(`DELETE FROM academies WHERE domain=?${region ? " AND region=?" : ""}`, region ? [domain, region] : [domain]).changes ?? 0;
  }

  enqueueJob(domain: string, kind: JobKind, payload: Row): string {
    const id = randomUUID();
    this.run("INSERT INTO jobs (id, domain, kind, payload, status) VALUES (?, ?, ?, ?, 'queued')", [id, domain, kind, JSON.stringify(payload)]);
    return id;
  }
  claimNextJob(): Row | undefined {
    return this.transaction(() => {
      this.recoverStaleRunningJobs();
      const row = this.get("SELECT * FROM jobs WHERE status='queued' AND paused=0 ORDER BY scheduled_at LIMIT 1");
      if (!row) return undefined;
      const now = nowSql();
      this.run("UPDATE jobs SET status='running', started_at=?, heartbeat_at=?, current_step='작업자 시작' WHERE id=?", [now, now, row.id]);
      return { ...row, status: "running", started_at: now, heartbeat_at: now, current_step: "작업자 시작", payload_obj: safeJson(row.payload, {}) };
    });
  }
  recoverStaleRunningJobs(maxExtraGraceSeconds = Number(process.env.WORKER_CANCEL_EXTRA_GRACE_SEC || 300)): number {
    const extraGraceSec = Math.max(60, Math.min(60 * 60, Math.trunc(Number(maxExtraGraceSeconds) || 300)));
    const rows = this.all("SELECT id, payload, started_at, heartbeat_at, cancel_requested FROM jobs WHERE status='running' AND started_at IS NOT NULL")
      .filter((row) => isRunningJobStale(row, extraGraceSec));
    if (!rows.length) return 0;
    for (const row of rows) {
      const payload = safeJson(row.payload, {});
      const timeoutSec = clampJobTimeoutSeconds(payload.timeout_sec);
      const staleAfterMin = Math.ceil((timeoutSec + extraGraceSec) / 60);
      const cancelled = Number(row.cancel_requested ?? 0) === 1;
      const message = cancelled
        ? `취소됨(작업자 요청, 제한시간+여유 ${staleAfterMin}분 이상 응답 없음)`
        : `실패 처리됨(작업자 응답 없음, 제한시간+여유 ${staleAfterMin}분 초과)`;
      const step = cancelled ? "취소 복구 처리" : "응답 없음 복구 처리";
      this.run("UPDATE jobs SET status='failed', finished_at=?, current_slot_id=NULL, current_step=?, error=coalesce(error, ?) WHERE id=? AND status='running'", [nowSql(), step, message, row.id]);
      this.recoverInProgressSlots(payload?.slot_ids, message);
    }
    return rows.length;
  }
  private recoverInProgressSlots(slotIds: unknown, message: string): void {
    if (!Array.isArray(slotIds)) return;
    for (const slotId of slotIds.map((value: unknown) => String(value || "")).filter(Boolean)) {
      this.run(
        `UPDATE slots SET status='planned', last_error=?
         WHERE slot_id=? AND status='in_progress'
           AND NOT EXISTS (SELECT 1 FROM posts WHERE posts.slot_id=slots.slot_id AND posts.status!='deleted')`,
        [message, slotId],
      );
    }
  }
  completeJob(jobId: string, ok: boolean, result?: Row, error?: string): void {
    this.run(
      "UPDATE jobs SET status=?, finished_at=?, heartbeat_at=?, current_slot_id=NULL, current_step=?, processed_count=?, failed_count=?, result=?, error=? WHERE id=?",
      [ok ? "done" : "failed", nowSql(), nowSql(), ok ? "완료" : "실패", Number(result?.ok ?? 0), Number(result?.fail ?? 0), result ? JSON.stringify(result) : null, error ?? null, jobId],
    );
  }
  updateJobProgress(jobId: string | undefined, progress: { step: string; slotId?: string | null; processed?: number; failed?: number }): void {
    if (!jobId) return;
    this.run(
      `UPDATE jobs
       SET heartbeat_at=?, current_step=?, current_slot_id=?, processed_count=COALESCE(?, processed_count), failed_count=COALESCE(?, failed_count)
       WHERE id=? AND status='running'`,
      [nowSql(), progress.step, progress.slotId ?? null, progress.processed ?? null, progress.failed ?? null, jobId],
    );
  }
  // 작업 큐 제어 —
  isJobCancelRequested(jobId: string): boolean {
    return Number(this.get("SELECT cancel_requested FROM jobs WHERE id=?", [jobId])?.cancel_requested ?? 0) === 1;
  }
  cancelJob(jobId: string): { ok: boolean; state: string } {
    const row = this.get("SELECT status FROM jobs WHERE id=?", [jobId]);
    if (!row) return { ok: false, state: "not_found" };
    if (row.status === "queued") {
      this.run("UPDATE jobs SET status='failed', finished_at=?, error='취소됨(작업자 요청)' WHERE id=? AND status='queued'", [nowSql(), jobId]);
      return { ok: true, state: "cancelled" };
    }
    if (row.status === "running") {
      // 실행 중은 슬롯 경계에서 협조적으로 중단한다(현재 글은 마치고 멈춤).
      this.run("UPDATE jobs SET cancel_requested=1 WHERE id=?", [jobId]);
      return { ok: true, state: "cancel_requested" };
    }
    return { ok: false, state: row.status };
  }
  pauseJob(jobId: string): boolean {
    return (this.run("UPDATE jobs SET paused=1 WHERE id=? AND status='queued'", [jobId]).changes ?? 0) > 0;
  }
  resumeJob(jobId: string): boolean {
    return (this.run("UPDATE jobs SET paused=0 WHERE id=? AND status='queued'", [jobId]).changes ?? 0) > 0;
  }
  prioritizeJob(jobId: string): boolean {
    // 대기 중 가장 이른 시각보다 1초 앞당겨 다음 claim에서 먼저 집히게 한다.
    return (this.run(
      "UPDATE jobs SET paused=0, scheduled_at=datetime((SELECT MIN(scheduled_at) FROM jobs WHERE status='queued'), '-1 seconds') WHERE id=? AND status='queued'",
      [jobId],
    ).changes ?? 0) > 0;
  }
  listJobs(opts: { domain?: string; status?: string; limit?: number } = {}): Row[] {
    this.recoverStaleRunningJobs();
    let sql = "SELECT * FROM jobs WHERE 1=1"; const args: any[] = [];
    if (opts.domain) { sql += " AND domain=?"; args.push(opts.domain); }
    if (opts.status) { sql += " AND status=?"; args.push(opts.status); }
    sql += " ORDER BY scheduled_at DESC LIMIT ?"; args.push(opts.limit ?? 100);
    return this.all(sql, args);
  }
}

export function safeJson(value: any, fallback: any): any {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function domainOut(row: Row): Row {
  return {
    ...row,
    templates_enabled: safeJson(row.templates_enabled, []),
    design_template_overrides: safeJson(row.design_template_overrides, {}),
    template_overrides: safeJson(row.template_overrides, {}),
    research_usage: parseResearchUsage(row.research_usage),
  };
}
// 커스텀 글유형 axis_tags 는 {persona?,intent?,modifier?: string[]} 만 허용해 정규화한다.
function parseAxisTags(value: unknown): { persona?: string[]; intent?: string[]; modifier?: string[] } | undefined {
  const raw = safeJson(value, null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: { persona?: string[]; intent?: string[]; modifier?: string[] } = {};
  for (const axis of ["persona", "intent", "modifier"] as const) {
    const list = (raw as Row)[axis];
    if (Array.isArray(list)) out[axis] = list.map((t: unknown) => String(t)).filter(Boolean);
  }
  return Object.keys(out).length ? out : undefined;
}
// TEXT 컬럼 write 트랩: axis_tags 객체는 반드시 JSON.stringify. 빈/무효는 null.
function serializeAxisTags(value: unknown): string | null {
  const parsed = typeof value === "string" ? parseAxisTags(value) : parseAxisTags(JSON.stringify(value ?? null));
  return parsed ? JSON.stringify(parsed) : null;
}
// 글유형 academy_types(문자열 배열, JSON 배열 저장, 빈/무효는 null).
function parseAcademyTypes(value: unknown): string[] {
  const raw = safeJson(value, []);
  return Array.isArray(raw) ? raw.map((v) => String(v || "").trim()).filter(Boolean) : [];
}
function serializeAcademyTypes(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const list = value.map((v) => String(v || "").trim()).filter(Boolean);
  return list.length ? JSON.stringify(list) : null;
}
// 제목 규칙(JSON): { min_generate?, tiers:[{min_count, template}], fallback? }. 무효/tier 없음은 null.
// TITLE_RULES(빌트인) 와 동일 스키마. 저장 전 정규화해 쓰레기 값이 DB 에 들어가지 않게 한다.
function normalizeTitleRule(value: unknown): TitleRule | null {
  const raw = typeof value === "string" ? safeJson(value, null) : value;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const tiers = (Array.isArray(src.tiers) ? src.tiers : [])
    .map((t) => {
      const o = t && typeof t === "object" ? (t as Record<string, unknown>) : {};
      const min_count = Math.trunc(Number(o.min_count));
      const template = String(o.template ?? "").trim();
      return Number.isFinite(min_count) && template ? { min_count, template } : null;
    })
    .filter((t): t is { min_count: number; template: string } => t !== null)
    .sort((a, b) => b.min_count - a.min_count); // min_count 내림차순(첫 매칭 규칙)
  if (!tiers.length) return null;
  // 키 순서를 TITLE_RULES 리터럴(min_generate → tiers → fallback)에 맞춘다 — 빌트인/커스텀 직렬화 일치.
  const mg = Math.trunc(Number(src.min_generate));
  const rule: TitleRule = Number.isFinite(mg) && mg > 0 ? { min_generate: mg, tiers } : { tiers };
  const fb = String(src.fallback ?? "").trim();
  if (fb) rule.fallback = fb;
  return rule;
}
function serializeTitleRule(value: unknown): string | null {
  const norm = normalizeTitleRule(value);
  return norm ? JSON.stringify(norm) : null;
}
function parseTitleRule(value: unknown): TitleRule | undefined {
  return normalizeTitleRule(value) ?? undefined;
}
// 주축 재정의: "region"|"keyword" 만 허용, 그 외/빈값은 null(=아키타입 기본).
function normPrimaryOverride(value: unknown): "region" | "keyword" | null {
  const v = String(value || "").trim();
  return v === "region" || v === "keyword" ? v : null;
}
function clampModifierCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(2, Math.round(n)));
}
// custom_templates row → TemplateSpecShape (INTEGER→boolean, axis_tags safeJson). getTemplateSpec 커스텀 경로.
function customTemplateSpec(row: Row): TemplateSpecShape {
  return {
    name: String(row.name || ""),
    kind: String(row.kind || ""),
    use_persona: Number(row.use_persona) === 1,
    with_intent: Number(row.with_intent) === 1,
    modifier_count: Number(row.modifier_count ?? 0),
    weight: Number(row.weight ?? 1),
    min_sv: Number(row.min_sv ?? 0),
    axis_tags: parseAxisTags(row.axis_tags),
    axis_values: parseAxisTags(row.axis_values),
    academy_types: parseAcademyTypes(row.academy_types),
    keyword_filter: parseAcademyTypes(row.keyword_filter),
    primary_override: normPrimaryOverride(row.primary_override) ?? undefined,
    default_direction: row.default_direction != null ? String(row.default_direction) : undefined,
    default_design: row.default_design != null ? String(row.default_design) : undefined,
    origin_template_id: row.origin_template_id != null ? String(row.origin_template_id) : undefined,
    title_rule: parseTitleRule(row.title_rule),
  };
}
// custom_templates row → API 출력형 (INTEGER→boolean, axis_tags 객체화, custom 마커).
export function customTemplateOut(row: Row): Row {
  return {
    ...row,
    use_persona: Number(row.use_persona) === 1,
    with_intent: Number(row.with_intent) === 1,
    modifier_count: Number(row.modifier_count ?? 0),
    weight: Number(row.weight ?? 1),
    min_sv: Number(row.min_sv ?? 0),
    axis_tags: parseAxisTags(row.axis_tags) ?? {},
    axis_values: parseAxisTags(row.axis_values) ?? {},
    academy_types: parseAcademyTypes(row.academy_types),
    keyword_filter: parseAcademyTypes(row.keyword_filter),
    title_rule: parseTitleRule(row.title_rule) ?? null,
    custom: true,
  };
}
export function jobOut(row: Row): Row { return { ...row, domain: row.domain, payload_obj: safeJson(row.payload, {}), result_obj: safeJson(row.result, {}) }; }
export function syncRunOut(row: Row): Row {
  return { ...row, cancel_requested: Number(row.cancel_requested ?? 0) === 1, result_obj: safeJson(row.result, null) };
}
export function nowSql(): string { return new Date().toISOString().replace("T", " ").slice(0, 19); }

function encodeJson(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return null; }
}

function nullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeDrivingplusReviews(value: unknown): Row[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const row = raw && typeof raw === "object" ? raw as Row : {};
    const content = cleanText(row.content);
    const point = nullableNumber(row.point);
    if (!isPositiveReviewText(content, point)) return null;
    return {
      id: nullableNumber(row.id),
      author: nullableText(row.author),
      point,
      content: content.slice(0, 500),
      date: nullableText(row.date),
      images: Array.isArray(row.images) ? row.images.map((v) => String(v || "").trim()).filter(Boolean).slice(0, 3) : [],
      num_like: nullableNumber(row.numLike),
    };
  }).filter(Boolean).slice(0, 10) as Row[];
}

// DB 에 저장된 JSON 텍스트를 되읽는다. 깨진 값은 조용히 빈 값으로 떨어뜨린다(동기화를 막지 않는다).
function decodeJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function decodeJsonObject(value: unknown): Row | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Row;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Row : null;
  } catch {
    return null;
  }
}

function normalizeDrivingplusBlogReviews(value: unknown): Row[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const row = raw && typeof raw === "object" ? raw as Row : {};
    const title = cleanText(row.title);
    const content = cleanText(row.content);
    const link = nullableText(row.link);
    if (!title || !link) return null;
    if (!isPositiveReviewText(`${title} ${content}`, null)) return null;
    return {
      title: title.slice(0, 160),
      content: content ? content.slice(0, 500) : null,
      link,
      postdate: nullableText(row.postdate),
      images: Array.isArray(row.images) ? row.images.map((v) => String(v || "").trim()).filter(Boolean).slice(0, 3) : [],
    };
  }).filter(Boolean).slice(0, 10) as Row[];
}

function reviewSummaryText(reviews: Row[]): string | null {
  const lines = reviews
    .map((review) => {
      const point = review.point ? `${review.point}점 ` : "";
      return `${point}${String(review.content || "").trim()}`.trim();
    })
    .filter(Boolean)
    .slice(0, 3);
  return lines.length ? lines.join("\n") : null;
}

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/#[0-9A-Za-z_가-힣]+/g, " ")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulKoreanReview(text: string): boolean {
  if (!text || text.length < 12) return false;
  const korean = (text.match(/[가-힣]/g) || []).length;
  const digits = (text.match(/\d/g) || []).length;
  if (korean < 6) return false;
  if (digits > korean + 8) return false;
  if (/^(\d|[ㅋㅎㅠㅜ\s.,!?])+$/u.test(text)) return false;
  return true;
}

const NEGATIVE_REVIEW_RE = /불친절|최악|비추|별로|환불|짜증|화남|불만|실망|안\s*좋|안좋|문제\s*있|대기\s*길|너무\s*늦|엉망|후회/u;
const POSITIVE_REVIEW_RE = /친절|합격|좋|추천|감사|만족|편하|꼼꼼|잘\s*가르|빠르|한\s*번에|한번에|쉬웠|도움|최고|강추|자세히|설명|안심|쾌적|체계/u;
const RISKY_REVIEW_CLAIM_RE = /\d+\s*일\s*(?:만|컷|완성)|삼\s*일\s*(?:만|컷|완성)|하루\s*만|당일\s*합격|무조건|보장|\d{2,3}\s*만\s*(?:원|뤈|웜)?|\d{3},\d{3}\s*원/u;

function isPositiveReviewText(text: string, point: number | null): boolean {
  if (!isUsefulKoreanReview(text)) return false;
  if (NEGATIVE_REVIEW_RE.test(text)) return false;
  if (RISKY_REVIEW_CLAIM_RE.test(text)) return false;
  if (point !== null && point !== undefined && point < 4) return false;
  if (point !== null && point !== undefined && point >= 4) return true;
  return POSITIVE_REVIEW_RE.test(text);
}

// 셔틀 안내문에 등장한 지명을 판별할 때 후보를 학원 주변으로 좁힌다.
// 전국 사전과 그냥 대조하면 "서구"·"남구"처럼 여러 도시에 있는 이름을 구분할 수 없다.
const SHUTTLE_REGION_RADIUS_KM = 25;
function nearbyDirectoryRegions<T extends { latitude: number | null; longitude: number | null }>(
  directory: T[],
  latitude: number | null,
  longitude: number | null,
): T[] {
  if (latitude === null || longitude === null) return [];
  return directory.filter((entry) => {
    if (entry.latitude === null || entry.longitude === null) return false;
    return haversineKm(latitude, longitude, entry.latitude, entry.longitude) <= SHUTTLE_REGION_RADIUS_KM;
  });
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

function bestRegionForAddress(address: string | null, regions: Row[]): string | null {
  if (!address) return null;
  let best = "";
  for (const region of regions) {
    const value = String(region.region || "").trim();
    if (value && address.includes(value) && value.length > best.length) best = value;
  }
  return best || null;
}

function fallbackRegionFromAddress(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]} ${parts[1]}`;
  return parts[0] || null;
}

function isRunningJobStale(job: Row, extraGraceSec: number): boolean {
  const lastSeenAt = Date.parse(`${String(job.heartbeat_at || job.started_at || "").replace(" ", "T")}Z`);
  if (!Number.isFinite(lastSeenAt)) return false;
  const timeoutSec = clampJobTimeoutSeconds(safeJson(job.payload, {})?.timeout_sec);
  return Date.now() - lastSeenAt > (timeoutSec + extraGraceSec) * 1000;
}

function clampJobTimeoutSeconds(value: unknown): number {
  return Math.max(60, Math.min(60 * 60 * 6, Math.trunc(Number(value) || 600)));
}
