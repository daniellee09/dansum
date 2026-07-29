-- 커뮤니티 상호작용: 댓글(1단 대댓글) + 추천/비추천 + 답글 알림

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  parent_comment_id TEXT REFERENCES comments(id), -- NULL이면 최상위. 대댓글은 1단 depth만 허용
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- active | deleted
  score INTEGER NOT NULL DEFAULT 0, -- votes 합계 캐시(정렬용)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX idx_comments_article ON comments(article_id, created_at);
CREATE INDEX idx_comments_parent ON comments(parent_comment_id);

-- comment/article 공용으로 일반화(지금은 comment만 쓰지만 향후 기사 추천에도 재사용 가능)
CREATE TABLE votes (
  user_id TEXT NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL, -- comment | article
  target_id TEXT NOT NULL,
  value INTEGER NOT NULL, -- 1 | -1
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, target_type, target_id)
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL, -- reply
  payload TEXT NOT NULL, -- JSON: {commentId, articleId, articleTitle, fromNickname}
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
