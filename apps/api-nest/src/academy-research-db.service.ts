import { Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

// admin.db(DbService)와 완전히 분리된 "학원 심층조사" 전용 DB.
// admin.db는 테스트로 자주 초기화되므로, 조사 데이터는 이 DB에 영구 보존한다.
// 모든 테이블은 DrivingPlus academy.id(= external_id, 불변)로 키잉한다.
const sqlite = await import("node:sqlite" as string) as any;
type DatabaseSync = any;

type Row = Record<string, any>;

const PROJECT_DIR = resolve(new URL("../../..", import.meta.url).pathname);
const DEFAULT_DB = resolve(PROJECT_DIR, "data/academy_research.db");

// 검증상태 기본 3단계(미확인→AI초안→검증완료). 코드 테이블이라 추후 상태 추가가 마이그레이션 없이 가능.
const DEFAULT_STATUS_DEFS: Array<{ code: string; label: string; rank: number }> = [
  { code: "unverified", label: "미확인", rank: 0 },
  { code: "ai_draft", label: "AI 초안", rank: 1 },
  { code: "verified", label: "검증완료", rank: 2 },
  // 웹 조사 도구가 차단돼 실제 웹검증을 못 한 상태(값을 신뢰할 수 없어 저장하지 않음). 웹 활성화 후 재조사 필요.
  { code: "web_blocked", label: "웹조사 차단", rank: 3 },
];

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 검증상태 정의(확장 가능)
CREATE TABLE IF NOT EXISTS field_status_defs (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  rank INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- DrivingPlus 미러(원본값, 조사로 덮어쓰지 않음)
CREATE TABLE IF NOT EXISTS academy_base (
  external_id TEXT PRIMARY KEY,
  name TEXT,
  region TEXT,
  address TEXT,
  phone TEXT,
  vphone TEXT,
  academy_type TEXT,
  latitude REAL,
  longitude REAL,
  thumb_url TEXT,
  photos TEXT,
  seo_title TEXT,
  seo_keywords TEXT,
  seo_description TEXT,
  raw_json TEXT,
  synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_academy_base_region ON academy_base(region);

-- AI 심층조사 스칼라값(base와 병존. 기본정보도 재조사해 *_researched에 나란히 저장)
CREATE TABLE IF NOT EXISTS academy_research (
  external_id TEXT PRIMARY KEY,
  name_researched TEXT,
  address_researched TEXT,
  phone_researched TEXT,
  gu TEXT,
  dong TEXT,
  jibun_address TEXT,
  hours TEXT,
  night_class TEXT,
  weekend TEXT,
  closed_days TEXT,
  shuttle_available TEXT,
  shuttle_summary TEXT,
  licenses TEXT,
  self_test TEXT,
  facilities TEXT,
  fee_summary TEXT,
  price_disclosed TEXT,
  pass_rate TEXT,
  pass_rate_scope TEXT,
  established_year TEXT,
  scale TEXT,
  homepage_url TEXT,
  naver_place_url TEXT,
  kakao_url TEXT,
  research_engine TEXT,
  research_method TEXT,
  researched_at TEXT,
  updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (external_id) REFERENCES academy_base(external_id) ON DELETE CASCADE
);

-- 과정별 가격(다건)
CREATE TABLE IF NOT EXISTS academy_courses (
  id TEXT PRIMARY KEY,
  external_id TEXT NOT NULL,
  course_name TEXT,
  price TEXT,
  exam_fee_included TEXT,
  extra_costs TEXT,
  note TEXT,
  source_url TEXT,
  verified_status TEXT NOT NULL DEFAULT 'ai_draft',
  researched_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (external_id) REFERENCES academy_base(external_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_academy_courses_ext ON academy_courses(external_id);

-- 셔틀 노선(다건. 동별 커버 포함)
CREATE TABLE IF NOT EXISTS academy_shuttle_routes (
  id TEXT PRIMARY KEY,
  external_id TEXT NOT NULL,
  route_name TEXT,
  waypoints TEXT,
  coverage TEXT,
  interval_text TEXT,
  source_url TEXT,
  verified_status TEXT NOT NULL DEFAULT 'ai_draft',
  researched_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (external_id) REFERENCES academy_base(external_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_academy_shuttle_ext ON academy_shuttle_routes(external_id);

-- 후기 원문(DrivingPlus review/blogReview 만. A안)
CREATE TABLE IF NOT EXISTS academy_reviews (
  id TEXT PRIMARY KEY,
  external_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  source_key TEXT,
  rating REAL,
  title TEXT,
  quote_text TEXT NOT NULL,
  author_masked TEXT,
  source_url TEXT,
  posted_at TEXT,
  images TEXT,
  collected_at TEXT NOT NULL,
  collect_method TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (external_id) REFERENCES academy_base(external_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_academy_reviews_uniq ON academy_reviews(external_id, platform, source_key);

-- 필드별 검증메타(UI 토글·출처·조사시점의 소스)
CREATE TABLE IF NOT EXISTS academy_field_meta (
  external_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unverified',
  source_url TEXT,
  source_name TEXT,
  confidence TEXT,
  verified_by TEXT,
  verified_at TEXT,
  note TEXT,
  updated_at TEXT,
  PRIMARY KEY (external_id, field_key),
  FOREIGN KEY (external_id) REFERENCES academy_base(external_id) ON DELETE CASCADE
);

-- 조사 실행 이력(a=전체 배치 / b=단건)
CREATE TABLE IF NOT EXISTS research_runs (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  external_id TEXT,
  region TEXT,
  engine TEXT,
  method TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  count_total INTEGER NOT NULL DEFAULT 0,
  count_done INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_research_runs_started ON research_runs(started_at DESC);
`;

// academy_research 에서 사람이 수정 가능한 스칼라 필드 화이트리스트(임의 컬럼 주입 방지)
const RESEARCH_FIELDS = new Set<string>([
  "name_researched", "address_researched", "phone_researched", "gu", "dong", "jibun_address",
  "hours", "night_class", "weekend", "closed_days", "shuttle_available", "shuttle_summary",
  "licenses", "self_test", "facilities", "fee_summary", "price_disclosed", "pass_rate",
  "pass_rate_scope", "established_year", "scale", "homepage_url", "naver_place_url", "kakao_url",
]);

export interface BaseAcademyInput {
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
  photos?: unknown;
  seo_title?: string | null;
  seo_keywords?: string | null;
  seo_description?: string | null;
  raw_json?: unknown;
}

export interface ReviewInput {
  external_id: string;
  platform: string;
  source_key?: string | null;
  rating?: number | null;
  title?: string | null;
  quote_text: string;
  author_masked?: string | null;
  source_url?: string | null;
  posted_at?: string | null;
  images?: unknown;
  collect_method?: string | null;
}

function nowIso(): string { return new Date().toISOString(); }
function jsonOrNull(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return null; }
}

// roadAddress 앞부분에서 광역시/도를 대략 추출(부산 파일럿 필터용). 확정값 아님.
export function regionFromAddress(address?: string | null): string | null {
  if (!address) return null;
  const head = String(address).trim().split(/\s+/)[0] || "";
  const map: Record<string, string> = {
    "서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구", "인천광역시": "인천",
    "광주광역시": "광주", "대전광역시": "대전", "울산광역시": "울산", "세종특별자치시": "세종",
    "경기도": "경기", "강원특별자치도": "강원", "강원도": "강원", "충청북도": "충북", "충청남도": "충남",
    "전라북도": "전북", "전북특별자치도": "전북", "전라남도": "전남", "경상북도": "경북", "경상남도": "경남",
    "제주특별자치도": "제주",
  };
  for (const [full, short] of Object.entries(map)) if (head.startsWith(full) || head.startsWith(short)) return short;
  return head || null;
}

@Injectable()
export class AcademyResearchDbService implements OnModuleInit {
  private db!: DatabaseSync;
  readonly path = resolve(process.cwd(), process.env.ACADEMY_RESEARCH_DB_PATH || DEFAULT_DB);

  onModuleInit(): void {
    this.init();
  }

  init(): void {
    if (this.db) return;
    mkdirSync(dirname(this.path), { recursive: true });
    this.db = new sqlite.DatabaseSync(this.path);
    this.db.exec(SCHEMA);
    this.seedStatusDefs();
  }

  private seedStatusDefs(): void {
    for (const def of DEFAULT_STATUS_DEFS) {
      this.run("INSERT OR IGNORE INTO field_status_defs (code, label, rank) VALUES (?, ?, ?)", [def.code, def.label, def.rank]);
    }
  }

  all(sql: string, params: any[] = []): Row[] { return this.db.prepare(sql).all(...params) as Row[]; }
  get(sql: string, params: any[] = []): Row | undefined { return this.db.prepare(sql).get(...params) as Row | undefined; }
  run(sql: string, params: any[] = []): any { return this.db.prepare(sql).run(...params); }

  // ---- 검증상태 정의 ----
  listStatusDefs(): Row[] { return this.all("SELECT code, label, rank FROM field_status_defs ORDER BY rank ASC"); }
  addStatusDef(code: string, label: string, rank: number): void {
    this.run("INSERT OR REPLACE INTO field_status_defs (code, label, rank) VALUES (?, ?, ?)", [code, label, rank]);
  }

  // ---- academy_base (DrivingPlus 미러) ----
  upsertBase(input: BaseAcademyInput): void {
    const region = input.region ?? regionFromAddress(input.address);
    this.run(
      `INSERT INTO academy_base
        (external_id, name, region, address, phone, vphone, academy_type, latitude, longitude, thumb_url, photos, seo_title, seo_keywords, seo_description, raw_json, synced_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(external_id) DO UPDATE SET
        name=excluded.name, region=excluded.region, address=excluded.address, phone=excluded.phone,
        vphone=excluded.vphone, academy_type=excluded.academy_type, latitude=excluded.latitude,
        longitude=excluded.longitude, thumb_url=excluded.thumb_url, photos=excluded.photos,
        seo_title=excluded.seo_title, seo_keywords=excluded.seo_keywords, seo_description=excluded.seo_description,
        raw_json=excluded.raw_json, synced_at=excluded.synced_at`,
      [
        input.external_id, input.name ?? null, region, input.address ?? null, input.phone ?? null,
        input.vphone ?? null, input.academy_type ?? null, input.latitude ?? null, input.longitude ?? null,
        input.thumb_url ?? null, jsonOrNull(input.photos), input.seo_title ?? null, input.seo_keywords ?? null,
        input.seo_description ?? null, jsonOrNull(input.raw_json), nowIso(),
      ],
    );
  }

  listBase(opts: { region?: string; q?: string; limit?: number } = {}): Row[] {
    const where: string[] = [];
    const params: any[] = [];
    if (opts.region) { where.push("(region = ? OR address LIKE ?)"); params.push(opts.region, `%${opts.region}%`); }
    if (opts.q) { where.push("(name LIKE ? OR address LIKE ?)"); params.push(`%${opts.q}%`, `%${opts.q}%`); }
    const limit = Math.max(1, Math.min(5000, Math.trunc(opts.limit ?? 1000)));
    const sql = `SELECT b.*, r.researched_at, r.research_engine
       FROM academy_base b LEFT JOIN academy_research r ON r.external_id = b.external_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY b.name ASC LIMIT ${limit}`;
    return this.all(sql, params);
  }

  getBase(externalId: string): Row | undefined { return this.get("SELECT * FROM academy_base WHERE external_id = ?", [externalId]); }
  countBase(region?: string): number {
    const row = region
      ? this.get("SELECT COUNT(*) AS n FROM academy_base WHERE region = ? OR address LIKE ?", [region, `%${region}%`])
      : this.get("SELECT COUNT(*) AS n FROM academy_base");
    return Number(row?.n ?? 0);
  }

  // ---- academy_reviews (원문) ----
  upsertReview(input: ReviewInput): void {
    this.run(
      `INSERT INTO academy_reviews
        (id, external_id, platform, source_key, rating, title, quote_text, author_masked, source_url, posted_at, images, collected_at, collect_method)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(external_id, platform, source_key) DO UPDATE SET
        rating=excluded.rating, title=excluded.title, quote_text=excluded.quote_text,
        author_masked=excluded.author_masked, source_url=excluded.source_url, posted_at=excluded.posted_at,
        images=excluded.images, collected_at=excluded.collected_at, collect_method=excluded.collect_method`,
      [
        randomUUID(), input.external_id, input.platform, input.source_key ?? "", input.rating ?? null,
        input.title ?? null, input.quote_text, input.author_masked ?? null, input.source_url ?? null,
        input.posted_at ?? null, jsonOrNull(input.images), nowIso(), input.collect_method ?? "drivingplus_api",
      ],
    );
  }

  listReviews(externalId: string): Row[] {
    return this.all("SELECT * FROM academy_reviews WHERE external_id = ? ORDER BY platform ASC, posted_at DESC", [externalId]);
  }

  // ---- academy_research (AI 조사 스칼라값) ----
  upsertResearch(externalId: string, fields: Record<string, unknown>, meta: { engine?: string; method?: string } = {}): void {
    const cols: string[] = [];
    const vals: any[] = [];
    for (const [key, value] of Object.entries(fields)) {
      if (!RESEARCH_FIELDS.has(key)) continue;
      cols.push(key);
      vals.push(value == null ? null : String(value));
    }
    const now = nowIso();
    // 조사메타
    const setCols = [...cols, "research_engine", "research_method", "researched_at", "updated_at"];
    const setVals = [...vals, meta.engine ?? null, meta.method ?? null, now, now];
    const placeholders = setCols.map(() => "?").join(",");
    const updates = setCols.map((c) => `${c}=excluded.${c}`).join(", ");
    this.run(
      `INSERT INTO academy_research (external_id, ${setCols.join(", ")})
       VALUES (?, ${placeholders})
       ON CONFLICT(external_id) DO UPDATE SET ${updates}`,
      [externalId, ...setVals],
    );
  }

  getResearch(externalId: string): Row | undefined { return this.get("SELECT * FROM academy_research WHERE external_id = ?", [externalId]); }

  // 웹 조사 도구가 차단된 경우: (지어냈을 수 있는) 값은 저장하지 않고, 시도 시각·엔진만 기록 + 모든 필드를 web_blocked 로 표시.
  markResearchBlocked(externalId: string, meta: { engine?: string; method?: string } = {}): void {
    this.upsertResearch(externalId, {}, meta);
    for (const key of RESEARCH_FIELDS) {
      this.setFieldMeta(externalId, key, { status: "web_blocked", source_name: `${meta.engine ?? "AI"} 웹조사 차단` });
    }
  }

  updateResearchField(externalId: string, field: string, value: unknown): boolean {
    if (!RESEARCH_FIELDS.has(field)) return false;
    // 레코드가 없으면 먼저 생성
    if (!this.getResearch(externalId)) this.run("INSERT OR IGNORE INTO academy_research (external_id) VALUES (?)", [externalId]);
    this.run(`UPDATE academy_research SET ${field}=?, updated_at=? WHERE external_id=?`, [value == null ? null : String(value), nowIso(), externalId]);
    return true;
  }

  // ---- 과정/셔틀 (다건: 조사 시 통째로 교체) ----
  replaceCourses(externalId: string, courses: Array<Record<string, unknown>>): void {
    this.run("DELETE FROM academy_courses WHERE external_id = ?", [externalId]);
    const now = nowIso();
    for (const c of courses) {
      this.run(
        `INSERT INTO academy_courses (id, external_id, course_name, price, exam_fee_included, extra_costs, note, source_url, verified_status, researched_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [randomUUID(), externalId, str(c.course_name), str(c.price), str(c.exam_fee_included), str(c.extra_costs), str(c.note), str(c.source_url), str(c.verified_status) || "ai_draft", now],
      );
    }
  }

  replaceShuttleRoutes(externalId: string, routes: Array<Record<string, unknown>>): void {
    this.run("DELETE FROM academy_shuttle_routes WHERE external_id = ?", [externalId]);
    const now = nowIso();
    for (const r of routes) {
      this.run(
        `INSERT INTO academy_shuttle_routes (id, external_id, route_name, waypoints, coverage, interval_text, source_url, verified_status, researched_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [randomUUID(), externalId, str(r.route_name), jsonOrNull(r.waypoints), jsonOrNull(r.coverage), str(r.interval_text), str(r.source_url), str(r.verified_status) || "ai_draft", now],
      );
    }
  }

  listCourses(externalId: string): Row[] { return this.all("SELECT * FROM academy_courses WHERE external_id = ? ORDER BY created_at ASC", [externalId]); }
  listShuttleRoutes(externalId: string): Row[] { return this.all("SELECT * FROM academy_shuttle_routes WHERE external_id = ? ORDER BY created_at ASC", [externalId]); }

  // ---- 필드별 검증메타 (UI 토글) ----
  setFieldMeta(externalId: string, fieldKey: string, patch: { status?: string; source_url?: string; source_name?: string; confidence?: string; verified_by?: string; note?: string }): void {
    const existing = this.get("SELECT * FROM academy_field_meta WHERE external_id=? AND field_key=?", [externalId, fieldKey]);
    const now = nowIso();
    const status = patch.status ?? existing?.status ?? "unverified";
    const verifiedAt = patch.status === "verified" ? now : existing?.verified_at ?? null;
    this.run(
      `INSERT INTO academy_field_meta (external_id, field_key, status, source_url, source_name, confidence, verified_by, verified_at, note, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(external_id, field_key) DO UPDATE SET
        status=excluded.status, source_url=COALESCE(excluded.source_url, academy_field_meta.source_url),
        source_name=COALESCE(excluded.source_name, academy_field_meta.source_name),
        confidence=COALESCE(excluded.confidence, academy_field_meta.confidence),
        verified_by=COALESCE(excluded.verified_by, academy_field_meta.verified_by),
        verified_at=excluded.verified_at,
        note=COALESCE(excluded.note, academy_field_meta.note), updated_at=excluded.updated_at`,
      [
        externalId, fieldKey, status, patch.source_url ?? null, patch.source_name ?? null, patch.confidence ?? null,
        patch.verified_by ?? null, verifiedAt, patch.note ?? null, now,
      ],
    );
  }

  listFieldMeta(externalId: string): Row[] { return this.all("SELECT * FROM academy_field_meta WHERE external_id = ?", [externalId]); }

  // 재조사 시 이전 'web_blocked' 흔적을 정리(자체 fetch 방식에선 발생하지 않음).
  clearWebBlocked(externalId: string): void {
    this.run("UPDATE academy_field_meta SET status='unverified', updated_at=? WHERE external_id=? AND status='web_blocked'", [nowIso(), externalId]);
  }

  // ---- 조사 실행 이력 ----
  createRun(input: { scope: string; external_id?: string | null; region?: string | null; engine?: string | null; method?: string | null; count_total?: number }): string {
    const id = randomUUID();
    this.run(
      "INSERT INTO research_runs (id, scope, external_id, region, engine, method, status, count_total) VALUES (?,?,?,?,?,?,?,?)",
      [id, input.scope, input.external_id ?? null, input.region ?? null, input.engine ?? null, input.method ?? null, "running", input.count_total ?? 0],
    );
    return id;
  }

  updateRun(id: string, patch: { status?: string; count_done?: number; count_total?: number; error?: string; finished?: boolean }): void {
    const sets: string[] = [];
    const params: any[] = [];
    if (patch.status !== undefined) { sets.push("status=?"); params.push(patch.status); }
    if (patch.count_done !== undefined) { sets.push("count_done=?"); params.push(patch.count_done); }
    if (patch.count_total !== undefined) { sets.push("count_total=?"); params.push(patch.count_total); }
    if (patch.error !== undefined) { sets.push("error=?"); params.push(patch.error); }
    if (patch.finished) { sets.push("finished_at=?"); params.push(nowIso()); }
    if (!sets.length) return;
    params.push(id);
    this.run(`UPDATE research_runs SET ${sets.join(", ")} WHERE id=?`, params);
  }

  listRuns(limit = 30): Row[] { return this.all("SELECT * FROM research_runs ORDER BY started_at DESC LIMIT ?", [Math.max(1, Math.min(200, limit))]); }
  getRun(id: string): Row | undefined { return this.get("SELECT * FROM research_runs WHERE id = ?", [id]); }

  // ---- 상세(집계) ----
  getFull(externalId: string): Row | null {
    const base = this.getBase(externalId);
    if (!base) return null;
    return {
      base,
      research: this.getResearch(externalId) ?? null,
      courses: this.listCourses(externalId),
      shuttle_routes: this.listShuttleRoutes(externalId),
      reviews: this.listReviews(externalId),
      field_meta: this.listFieldMeta(externalId),
    };
  }
}

function str(value: unknown): string | null {
  if (value == null) return null;
  const s = typeof value === "string" ? value : String(value);
  return s.trim() === "" ? null : s;
}
