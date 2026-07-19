-- 뉴스 소스 설정
CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'rss',
  language TEXT NOT NULL DEFAULT 'ko',
  category TEXT NOT NULL DEFAULT 'general',
  is_active INTEGER NOT NULL DEFAULT 1,
  fetch_interval_min INTEGER NOT NULL DEFAULT 30,
  last_fetched_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 수집된 원본 기사
CREATE TABLE raw_articles (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  url TEXT NOT NULL UNIQUE,
  url_hash TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  content TEXT,
  description TEXT,
  author TEXT,
  published_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 요약 완료된 기사
CREATE TABLE articles (
  id TEXT PRIMARY KEY,
  raw_article_id TEXT NOT NULL REFERENCES raw_articles(id),
  source_id TEXT NOT NULL REFERENCES sources(id),
  title TEXT NOT NULL,
  original_title TEXT,
  summary TEXT NOT NULL,
  key_points TEXT NOT NULL,
  category TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '[]',
  source_url TEXT NOT NULL,
  source_name TEXT NOT NULL,
  published_at TEXT NOT NULL,
  summarized_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 일일 다이제스트
CREATE TABLE daily_digests (
  id TEXT PRIMARY KEY,
  digest_date TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  top_articles TEXT NOT NULL,
  category_breakdown TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 인덱스
CREATE INDEX idx_articles_category ON articles(category, published_at DESC);
CREATE INDEX idx_articles_published ON articles(published_at DESC);
CREATE INDEX idx_raw_articles_status ON raw_articles(status);
CREATE INDEX idx_raw_articles_url_hash ON raw_articles(url_hash);
