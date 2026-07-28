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

// 이보다 오래 heartbeat 가 없으면 프로세스가 죽은 것으로 본다.
// 학원 1곳이 2~3분이므로 한 곳 처리 중 재시작돼도 살아남을 만큼 여유를 둔다.
const STALE_RUN_MS = 15 * 60 * 1000;

// 검증상태 기본 3단계(미확인→AI초안→검증완료). 코드 테이블이라 추후 상태 추가가 마이그레이션 없이 가능.
const DEFAULT_STATUS_DEFS: Array<{ code: string; label: string; rank: number }> = [
  { code: "unverified", label: "미확인", rank: 0 },
  { code: "ai_draft", label: "AI 초안", rank: 1 },
  { code: "verified", label: "검증완료", rank: 2 },
  // 웹 조사 도구가 차단돼 실제 웹검증을 못 한 상태(값을 신뢰할 수 없어 저장하지 않음). 웹 활성화 후 재조사 필요.
  { code: "web_blocked", label: "웹조사 차단", rank: 3 },
  // 저장은 했지만 그라운딩 검사에 걸린 값 — 수집 소스에서 근거를 못 찾았거나, 그 필드에
  // 담기면 안 되는 값(광고 문구·개인거래 가격)이다. 사유는 academy_field_meta.note 에 남는다.
  { code: "needs_review", label: "검토 필요", rank: 4 },
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
  source TEXT NOT NULL DEFAULT 'drivingplus',
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
  enrollment_prep TEXT,
  booking_channel TEXT,
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
  finished_at TEXT,
  heartbeat_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_research_runs_started ON research_runs(started_at DESC);
`;

// academy_research 에서 사람이 수정 가능한 스칼라 필드 화이트리스트(임의 컬럼 주입 방지)
const RESEARCH_FIELDS = new Set<string>([
  "name_researched", "address_researched", "phone_researched", "gu", "dong", "jibun_address",
  "hours", "night_class", "weekend", "closed_days", "shuttle_available", "shuttle_summary",
  "licenses", "self_test", "facilities", "fee_summary", "price_disclosed", "pass_rate",
  "pass_rate_scope", "established_year", "scale", "homepage_url", "naver_place_url", "kakao_url",
  "enrollment_prep", "booking_channel",
]);

export interface BaseAcademyInput {
  external_id: string;
  /** 'drivingplus'(원천 동기화) 또는 'manual'(사람이 직접 등록). 기본은 원천. */
  source?: string | null;
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

/** 원천에 없는 학원을 사람이 등록할 때 받는 값. 예전 도메인 「수동 자료 보완」 폼과 같은 항목이다. */
export interface ManualAcademyInput {
  external_id?: string | null;
  name: string;
  region?: string | null;
  address?: string | null;
  phone?: string | null;
  academy_type?: string | null;
  price?: string | null;
  shuttle?: string | null;
  hours?: string | null;
  pass_rate?: string | null;
  source_name?: string | null;
  source_url?: string | null;
  review?: string | null;
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
function text(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s === "" ? null : s;
}
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
    this.migrate();
    this.seedStatusDefs();
    this.recoverStaleRuns();
  }

  private migrate(): void {
    const baseCols = new Set(this.all("PRAGMA table_info(academy_base)").map((r) => r.name));
    // 원천 목록에 아직 있는지. 삭제하지 않는 이유는 FK CASCADE 로 조사·검증상태까지 함께 날아가기 때문이다.
    // 대신 목록·동기화 대상에서 빼서 노출과 헛수고를 막는다.
    if (!baseCols.has("active")) this.db.exec("ALTER TABLE academy_base ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
    // 수동 등록 학원 구분. 원천 목록에 없다는 이유로 꺼지면 안 되기 때문이다(setActiveByExternalIds).
    if (!baseCols.has("source")) this.db.exec("ALTER TABLE academy_base ADD COLUMN source TEXT NOT NULL DEFAULT 'drivingplus'");

    const runCols = new Set(this.all("PRAGMA table_info(research_runs)").map((r) => r.name));
    // 실행 결과 요약(JSON). 동기화는 학원 수 외에 리뷰 건수도 남겨야 해서 진행률 컬럼만으로는 부족하다.
    if (!runCols.has("result")) this.db.exec("ALTER TABLE research_runs ADD COLUMN result TEXT");
    // 취소 요청 플래그. 실행 루프가 매 항목마다 읽어 스스로 멈춘다(중간에 끊지 않으므로 데이터가 깨지지 않는다).
    if (!runCols.has("cancel_requested")) this.db.exec("ALTER TABLE research_runs ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0");
    // 살아 있음 표시. 조사는 API 밖(research:once)에서도 돌기 때문에, 기동 시점만으로
    // 유령 여부를 판단할 수 없다(아래 recoverStaleRuns 주석).
    if (!runCols.has("heartbeat_at")) this.db.exec("ALTER TABLE research_runs ADD COLUMN heartbeat_at TEXT");

    // 학원 홈페이지 표본 조사(2026-07-28)에서 공통으로 나왔는데 스키마에 자리가 없던 항목.
    // "입학안내·준비사항" 5곳 · "온라인 예약·상담신청" 4곳. 원천은 둘 다 주지 않는다.
    const researchCols = new Set(this.all("PRAGMA table_info(academy_research)").map((r) => r.name));
    if (!researchCols.has("enrollment_prep")) this.db.exec("ALTER TABLE academy_research ADD COLUMN enrollment_prep TEXT");
    if (!researchCols.has("booking_channel")) this.db.exec("ALTER TABLE academy_research ADD COLUMN booking_channel TEXT");
  }

  /**
   * 죽은 실행 정리. 안 하면 UI 버튼이 영원히 잠긴다.
   *
   * 예전에는 "기동 시점에 running 이면 유령" 으로 봤다. 조사가 API 프로세스 안에서만 돌던
   * 시절에는 맞았지만, research:once 로 밖에서도 돌게 되면서 **살아 있는 실행을 죽었다고
   * 표시**하는 사고가 났다(2026-07-28: 별도 프로세스가 24/30 까지 진행 중인데 API 가 재시작하며
   * error 로 찍어 CLI 가 스스로 종료). 반대로 CLI 가 뜰 때 API 쪽 실행을 죽이는 일도 생긴다.
   *
   * 그래서 시간으로 판단한다. 배치는 학원 1곳마다 heartbeat 를 갱신하므로(updateRun),
   * 그보다 한참 지난 실행만 유령으로 본다. 학원 1곳이 2~3분이라 여유를 크게 둔다.
   */
  // API 재시작뿐 아니라 실행 목록 폴링에서도 호출한다. 프로세스가 사라진 뒤 서버가
  // 살아 있어도 UI가 `취소 중`으로 영구 고정되지 않게 한다.
  recoverStaleRuns(): number {
    const cutoff = new Date(Date.now() - STALE_RUN_MS).toISOString();
    const result = this.run(
      `UPDATE research_runs SET status='error', error=COALESCE(error, ?), finished_at=?
       WHERE status='running' AND (heartbeat_at IS NULL OR heartbeat_at < ?)`,
      ["응답이 끊겨 중단 처리됨(프로세스 종료 추정)", nowIso(), cutoff],
    );
    return Number(result.changes ?? 0);
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
        (external_id, name, region, address, phone, vphone, academy_type, latitude, longitude, thumb_url, photos, seo_title, seo_keywords, seo_description, raw_json, source, synced_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
        input.seo_description ?? null, jsonOrNull(input.raw_json), input.source ?? "drivingplus", nowIso(),
      ],
    );
  }

  // 이번 동기화가 받아온 목록만 활성으로 남긴다. 취소로 중간에 끊겨도 결과가 어긋나지 않도록
  // 목록을 확보한 직후 한 문장으로 처리한다(학원별 upsert 에 맡기면 미처리분이 비활성으로 남는다).
  setActiveByExternalIds(externalIds: string[]): { active: number; inactive: number } {
    if (!externalIds.length) return { active: 0, inactive: this.countBase({ includeInactive: true }) };
    const placeholders = externalIds.map(() => "?").join(",");
    // 수동 등록분은 원천 목록에 없는 게 정상이다. 함께 끄면 동기화할 때마다 사라진다.
    this.run(
      `UPDATE academy_base SET active = CASE WHEN external_id IN (${placeholders}) THEN 1 ELSE 0 END
       WHERE source <> 'manual'`,
      externalIds,
    );
    return {
      active: Number(this.get("SELECT COUNT(*) AS n FROM academy_base WHERE active = 1")?.n ?? 0),
      inactive: Number(this.get("SELECT COUNT(*) AS n FROM academy_base WHERE active = 0")?.n ?? 0),
    };
  }

  countInactive(): number {
    return Number(this.get("SELECT COUNT(*) AS n FROM academy_base WHERE active = 0")?.n ?? 0);
  }

  listBase(opts: {
    region?: string;
    q?: string;
    limit?: number;
    offset?: number;
    includeInactive?: boolean;
    onlyUnresearched?: boolean;
    oldestResearchFirst?: boolean;
  } = {}): Row[] {
    const where: string[] = [];
    const params: any[] = [];
    // 기본은 최신 동기화에 포함된 학원만. 원천에서 내려간 행은 보관만 하고 쓰지 않는다.
    if (!opts.includeInactive) where.push("b.active = 1");
    // 아직 조사되지 않은 학원만. 조사 배치는 API 프로세스 안의 루프라 파일 저장 한 번에
    // 사라지는데, 이 필터가 있으면 "다시 실행 = 이어서 진행" 이 된다(재개 기능 대용).
    if (opts.onlyUnresearched) where.push("r.researched_at IS NULL");
    if (opts.region) { where.push("(region = ? OR address LIKE ?)"); params.push(opts.region, `%${opts.region}%`); }
    if (opts.q) { where.push("(name LIKE ? OR address LIKE ?)"); params.push(`%${opts.q}%`, `%${opts.q}%`); }
    const limit = Math.max(1, Math.min(5000, Math.trunc(opts.limit ?? 1000)));
    const offset = Math.max(0, Math.trunc(opts.offset ?? 0));
    // 재조사를 허용한 배치는, 미조사 → 가장 오래 전에 조사한 순으로 고른다.
    // 성공 저장된 항목은 최신 시각으로 밀려, 같은 limit 연속 실행이 다음 묶음으로 진행된다.
    const orderBy = opts.oldestResearchFirst
      ? "CASE WHEN r.researched_at IS NULL THEN 0 ELSE 1 END ASC, r.researched_at ASC, b.external_id ASC"
      : "b.name ASC";
    const sql = `SELECT b.*, r.researched_at, r.research_engine
       FROM academy_base b LEFT JOIN academy_research r ON r.external_id = b.external_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`;
    return this.all(sql, params);
  }

  getBase(externalId: string): Row | undefined { return this.get("SELECT * FROM academy_base WHERE external_id = ?", [externalId]); }

  /**
   * 원천에 없는 학원을 사람이 직접 등록한다.
   *
   * 예전에는 도메인의 원천 데이터 탭에서 admin.db `academies` 에 바로 넣었다. 그러면 수동분이
   * 도메인마다 따로 존재하고, 연결을 끊을 때(도메인 학원 전체 삭제) 함께 사라진다 — 원천 동기화로
   * 복구되는 다른 행과 달리 되살릴 방법이 없다. 학원 자료는 도메인이 아니라 업종의 자산이므로
   * 수집처인 조사 DB 에 둔다. 도메인에는 연결로만 나타난다.
   *
   * external_id 에 `manual-` 을 붙이는 이유: 원천 id 와 절대 겹치지 않아야 하고,
   * setActiveByExternalIds 가 "원천 목록에 없다"는 이유로 끄면 안 되기 때문이다(source 로 제외).
   */
  createManualBase(input: ManualAcademyInput): string {
    const name = String(input.name ?? "").trim();
    if (!name) throw new Error("학원 이름은 필수입니다.");
    const externalId = String(input.external_id ?? "").trim() || `manual-${randomUUID()}`;
    const address = text(input.address);
    // raw_json 은 원천 응답 원본을 담는 자리이고, 도메인 연결(AcademyLinkService)이 그 형태를 기대한다.
    // 수동분도 같은 형태로 맞춰 두면 연결 경로에 예외 분기를 만들지 않아도 된다.
    // 구조화할 수 없는 사람 입력(수강료 문장 등)은 __manual 로 따로 싣는다 — 원천 값과 섞지 않는다.
    const raw = {
      id: externalId,
      title: name,
      roadAddress: address,
      phone: text(input.phone),
      type: text(input.academy_type),
      __manual: {
        price: text(input.price),
        shuttle: text(input.shuttle),
        hours: text(input.hours),
        pass_rate: text(input.pass_rate),
        source_name: text(input.source_name),
        source_url: text(input.source_url),
        review: text(input.review),
      },
    };
    this.upsertBase({
      external_id: externalId,
      name,
      region: text(input.region),
      address,
      phone: text(input.phone),
      academy_type: text(input.academy_type),
      raw_json: raw,
      source: "manual",
    });
    return externalId;
  }

  /** 수동 등록분만 지운다. 원천 미러는 동기화가 관리하므로 여기서 지우면 다음 동기화에 되살아난다. */
  deleteManualBase(externalId: string): boolean {
    const row = this.getBase(externalId);
    if (!row || String(row.source ?? "") !== "manual") return false;
    this.run("DELETE FROM academy_reviews WHERE external_id = ?", [externalId]);
    this.run("DELETE FROM academy_field_meta WHERE external_id = ?", [externalId]);
    this.run("DELETE FROM academy_research WHERE external_id = ?", [externalId]);
    this.run("DELETE FROM academy_base WHERE external_id = ?", [externalId]);
    return true;
  }

  countManual(): number {
    return Number(this.get("SELECT COUNT(*) AS n FROM academy_base WHERE source = 'manual'")?.n ?? 0);
  }

  /**
   * 주어진 학원들의 조사 현황 요약.
   *
   * 조사 DB 는 도메인 개념이 없다(학원 하나 = 한 행). 도메인 화면에서 "내 학원들이 얼마나
   * 조사됐나"를 보려면 도메인 쪽 external_id 목록을 받아 대조하는 수밖에 없다.
   * 두 DB 가 파일로 분리돼 있어 조인이 불가능하기 때문이다.
   */
  summarizeByExternalIds(externalIds: string[]): { matched: number; researched: number; needs_review: number; last_researched_at: string | null } {
    const ids = [...new Set(externalIds.map((id) => String(id)).filter(Boolean))];
    if (!ids.length) return { matched: 0, researched: 0, needs_review: 0, last_researched_at: null };
    // SQLite 변수 상한(기본 999)을 넘기지 않도록 나눠 센다.
    const chunkSize = 500;
    let matched = 0;
    let researched = 0;
    let needsReview = 0;
    let last: string | null = null;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const marks = chunk.map(() => "?").join(",");
      matched += Number(this.get(`SELECT COUNT(*) AS n FROM academy_base WHERE external_id IN (${marks})`, chunk)?.n ?? 0);
      const done = this.get(
        `SELECT COUNT(*) AS n, MAX(researched_at) AS last FROM academy_research WHERE researched_at IS NOT NULL AND external_id IN (${marks})`,
        chunk,
      );
      researched += Number(done?.n ?? 0);
      if (done?.last && (!last || String(done.last) > last)) last = String(done.last);
      // 검토 필요는 필드 단위로 센다 — 한 학원에 여러 건이 걸릴 수 있다.
      needsReview += Number(this.get(
        `SELECT COUNT(*) AS n FROM academy_field_meta WHERE status = 'needs_review' AND external_id IN (${marks})`,
        chunk,
      )?.n ?? 0);
    }
    return { matched, researched, needs_review: needsReview, last_researched_at: last };
  }
  countBase(opts: { region?: string; includeInactive?: boolean } = {}): number {
    const where: string[] = [];
    const params: any[] = [];
    if (!opts.includeInactive) where.push("active = 1");
    if (opts.region) { where.push("(region = ? OR address LIKE ?)"); params.push(opts.region, `%${opts.region}%`); }
    const row = this.get(`SELECT COUNT(*) AS n FROM academy_base${where.length ? " WHERE " + where.join(" AND ") : ""}`, params);
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

  // 해당 학원·플랫폼의 후기를 원천이 준 목록으로 통째 교체한다.
  // 누적하면 원천에서 내려간 후기가 영구히 근거로 남으므로(작성자가 지운 후기 인용 위험) 교체가 기본이다.
  // 삭제 직후 프로세스가 죽어도 후기가 비지 않도록 트랜잭션으로 묶는다.
  replaceReviews(externalId: string, platform: string, reviews: ReviewInput[]): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.run("DELETE FROM academy_reviews WHERE external_id = ? AND platform = ?", [externalId, platform]);
      for (const review of reviews) this.upsertReview(review);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
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

  /**
   * 검토 대기 목록 — 학원을 가로질러 필드 단위로 모은다.
   *
   * 사용 관문이 "사람이 검증완료로 올린 값만 쓴다" 인데, 어느 학원의 어느 필드가 대기 중인지
   * 찾을 화면이 없어 380곳을 하나씩 열어야 했다. 그러면 verified 모드를 실질적으로 못 쓴다.
   *
   * 값은 academy_research 의 컬럼이라 field_key 로 동적 접근이 필요하다. 컬럼명을 SQL 에
   * 끼워 넣지 않고 행을 통째로 읽어 코드에서 고른다(임의 컬럼 주입 차단).
   */
  listReviewQueue(opts: { statuses?: string[]; q?: string; limit?: number } = {}): { items: Row[]; total: number } {
    const statuses = (opts.statuses ?? ["needs_review", "ai_draft"]).filter((s) => typeof s === "string" && s.trim());
    if (!statuses.length) return { items: [], total: 0 };
    const limit = Math.max(1, Math.min(1000, Math.trunc(opts.limit ?? 200)));
    const where = [`m.status IN (${statuses.map(() => "?").join(",")})`, "b.active = 1"];
    const params: any[] = [...statuses];
    if (opts.q) { where.push("(b.name LIKE ? OR b.address LIKE ?)"); params.push(`%${opts.q}%`, `%${opts.q}%`); }
    const clause = `FROM academy_field_meta m JOIN academy_base b ON b.external_id = m.external_id WHERE ${where.join(" AND ")}`;

    const total = Number(this.get(`SELECT COUNT(*) AS n ${clause}`, params)?.n ?? 0);
    // 검토가 급한 순서: 검토 필요 → 나머지. 그 안에서는 학원명·항목 순으로 안정 정렬한다.
    const rows = this.all(
      `SELECT m.external_id, m.field_key, m.status, m.note, m.source_url, m.updated_at, b.name, b.address
       ${clause}
       ORDER BY CASE m.status WHEN 'needs_review' THEN 0 ELSE 1 END, b.name ASC, m.field_key ASC
       LIMIT ${limit}`,
      params,
    );

    const research = new Map<string, Row>();
    for (const externalId of new Set(rows.map((r) => String(r.external_id)))) {
      const row = this.getResearch(externalId);
      if (row) research.set(externalId, row);
    }
    const items = rows.map((r) => ({
      ...r,
      value: RESEARCH_FIELDS.has(String(r.field_key)) ? (research.get(String(r.external_id))?.[String(r.field_key)] ?? null) : null,
    }));
    return { items, total };
  }

  // 재조사 시 이전 'web_blocked' 흔적을 정리(자체 fetch 방식에선 발생하지 않음).
  clearWebBlocked(externalId: string): void {
    this.run("UPDATE academy_field_meta SET status='unverified', updated_at=? WHERE external_id=? AND status='web_blocked'", [nowIso(), externalId]);
  }

  // ---- 조사 실행 이력 ----
  createRun(input: { scope: string; external_id?: string | null; region?: string | null; engine?: string | null; method?: string | null; count_total?: number }): string {
    const id = randomUUID();
    this.run(
      // 생성 시점에 heartbeat 를 찍는다. 첫 학원이 끝나기 전(2~3분)에 다른 프로세스가 뜨면
      // heartbeat 가 NULL 이라는 이유로 갓 시작한 실행이 유령으로 정리된다.
      "INSERT INTO research_runs (id, scope, external_id, region, engine, method, status, count_total, heartbeat_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [id, input.scope, input.external_id ?? null, input.region ?? null, input.engine ?? null, input.method ?? null, "running", input.count_total ?? 0, nowIso()],
    );
    return id;
  }

  updateRun(id: string, patch: { status?: string; count_done?: number; count_total?: number; error?: string; result?: unknown; finished?: boolean }): void {
    const sets: string[] = [];
    const params: any[] = [];
    if (patch.status !== undefined) { sets.push("status=?"); params.push(patch.status); }
    if (patch.count_done !== undefined) { sets.push("count_done=?"); params.push(patch.count_done); }
    if (patch.count_total !== undefined) { sets.push("count_total=?"); params.push(patch.count_total); }
    if (patch.error !== undefined) { sets.push("error=?"); params.push(patch.error); }
    if (patch.result !== undefined) { sets.push("result=?"); params.push(jsonOrNull(patch.result)); }
    if (patch.finished) { sets.push("finished_at=?"); params.push(nowIso()); }
    if (!sets.length) return;
    // 진행이 보고될 때마다 살아 있음을 남긴다. 이 값이 recoverStaleRuns 의 유일한 판단 근거다.
    sets.push("heartbeat_at=?");
    params.push(nowIso());
    params.push(id);
    this.run(`UPDATE research_runs SET ${sets.join(", ")} WHERE id=?`, params);
  }

  listRuns(limit = 30): Row[] {
    this.recoverStaleRuns();
    return this.all("SELECT * FROM research_runs ORDER BY started_at DESC LIMIT ?", [Math.max(1, Math.min(200, limit))]);
  }

  // 취소 요청. 실행 중인 것만 대상으로 한다(이미 끝난 실행에 표시해 봐야 의미가 없다).
  requestCancel(id: string): boolean {
    const run = this.getRun(id);
    if (!run || run.status !== "running") return false;
    this.run("UPDATE research_runs SET cancel_requested=1 WHERE id=?", [id]);
    return true;
  }

  isCancelRequested(id: string): boolean {
    return Number(this.get("SELECT cancel_requested FROM research_runs WHERE id=?", [id])?.cancel_requested ?? 0) === 1;
  }

  // 진행 중인 실행(스코프별). 재시작 유령은 init 에서 정리되므로 여기 걸리면 실제로 도는 중이다.
  findRunningRun(scope?: string): Row | undefined {
    return scope
      ? this.get("SELECT * FROM research_runs WHERE status='running' AND scope=? ORDER BY started_at DESC", [scope])
      : this.get("SELECT * FROM research_runs WHERE status='running' ORDER BY started_at DESC");
  }
  /** 이 학원을 지금 조사 중인 단건 실행. 같은 학원을 두 번 겹쳐 돌리면 서로의 값을 덮는다. */
  findRunningRunForAcademy(externalId: string): Row | undefined {
    return this.get("SELECT * FROM research_runs WHERE status='running' AND scope='single' AND external_id=?", [externalId]);
  }
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
