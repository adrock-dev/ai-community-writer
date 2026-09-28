// 마이그레이션 목록. 배열 순서가 곧 버전(user_version)이다.
// 이미 배포된 항목은 고치지 말고 새 항목을 뒤에 추가한다.
// 시각은 모두 ISO 8601 UTC 문자열, JSON 컬럼은 TEXT에 JSON 문자열로 둔다.

export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- 네이버 검색광고 API 월간(최근 30일) 검색량 스냅샷. 수집일 단위로 쌓아 추세를 비교한다.
  CREATE TABLE keyword_stats (
    keyword TEXT NOT NULL,
    collected_on TEXT NOT NULL,
    pc INTEGER NOT NULL,
    mobile INTEGER NOT NULL,
    total INTEGER NOT NULL,
    competition TEXT,
    PRIMARY KEY (keyword, collected_on)
  );

  CREATE TABLE topics (
    id INTEGER PRIMARY KEY,
    primary_keyword TEXT NOT NULL,
    secondary_keywords TEXT NOT NULL DEFAULT '[]',
    channel_id TEXT NOT NULL,
    section_code TEXT NOT NULL,
    article_type TEXT NOT NULL DEFAULT '',
    score REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'candidate'
      CHECK (status IN ('candidate', 'queued', 'written', 'skipped')),
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX topics_status ON topics (status, score DESC);

  CREATE TABLE articles (
    id INTEGER PRIMARY KEY,
    topic_id INTEGER REFERENCES topics (id) ON DELETE SET NULL,
    channel_id TEXT NOT NULL,
    section_code TEXT NOT NULL,
    article_type TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    format TEXT NOT NULL,
    keywords TEXT NOT NULL DEFAULT '[]',
    audience TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'review'
      CHECK (status IN ('draft', 'review', 'approved', 'exported', 'published', 'rejected')),
    provider TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    review_note TEXT NOT NULL DEFAULT '',
    published_url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    approved_at TEXT,
    exported_at TEXT,
    published_at TEXT
  );
  CREATE INDEX articles_channel ON articles (channel_id, article_type, status);

  -- 유사도 비교용 지문. 채널 구분 없이 전체 글과 비교한다.
  CREATE TABLE article_fingerprints (
    article_id INTEGER PRIMARY KEY REFERENCES articles (id) ON DELETE CASCADE,
    outline TEXT NOT NULL DEFAULT '[]',
    intro TEXT NOT NULL DEFAULT '',
    shingles TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE jobs (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued'
      CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
    payload TEXT NOT NULL DEFAULT '{}',
    result TEXT,
    error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    run_after TEXT NOT NULL,
    wait_reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT
  );
  CREATE INDEX jobs_ready ON jobs (status, run_after);

  -- LLM 호출 기록과 호출 직후 확인한 사용률.
  CREATE TABLE llm_calls (
    id INTEGER PRIMARY KEY,
    provider TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'error', 'rate_limited', 'timeout', 'not_found')),
    error TEXT NOT NULL DEFAULT '',
    usage TEXT NOT NULL DEFAULT '[]'
  );

  -- 프로바이더별 중지 상태. blocked_until 전까지는 호출하지 않는다.
  CREATE TABLE provider_state (
    provider TEXT PRIMARY KEY,
    blocked_until TEXT,
    reason TEXT NOT NULL DEFAULT '',
    usage TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
  );

  -- 원천 API 응답 캐시 (전체 학원 목록 등 큰 응답을 매번 받지 않기 위함).
  CREATE TABLE source_cache (
    key TEXT PRIMARY KEY,
    fetched_at TEXT NOT NULL,
    payload TEXT NOT NULL
  );
  `,
];
