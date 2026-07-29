-- 계정 시스템: users/sessions + 기존 localStorage 3종(북마크/팔로우/최근본기사)의 서버 이관처

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,              -- 소셜 전용 계정은 NULL 허용(추후 oauth_accounts 연동 대비)
  nickname TEXT NOT NULL UNIQUE,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'user',     -- user | admin
  status TEXT NOT NULL DEFAULT 'active', -- active | suspended | deleted
  nickname_changed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 소셜 로그인은 후속 과제. 스키마만 미리 마련해 나중에 마이그레이션 없이 붙일 수 있게 한다.
CREATE TABLE oauth_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,          -- kakao | google | naver
  provider_account_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, provider_account_id)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE, -- 원문 토큰은 저장하지 않음(SHA-256 해시만)
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE bookmarks (
  user_id TEXT NOT NULL REFERENCES users(id),
  article_id TEXT NOT NULL REFERENCES articles(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, article_id)
);

-- follows.ts의 type/value 추상을 그대로 반영(소스/카테고리 공용 테이블)
CREATE TABLE follows (
  user_id TEXT NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL,       -- source | category
  target_value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, target_type, target_value)
);

CREATE TABLE recently_viewed (
  user_id TEXT NOT NULL REFERENCES users(id),
  article_id TEXT NOT NULL REFERENCES articles(id),
  viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, article_id)
);
CREATE INDEX idx_recently_viewed_user ON recently_viewed(user_id, viewed_at DESC);
