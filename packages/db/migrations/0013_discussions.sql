-- 토론: 유저가 직접 여는 글. 그리고 댓글을 다시 기사 단위로 되돌린다.
--
-- 왜 되돌리나: 0011에서 댓글의 단위를 기사 → 이슈로 옮겼는데, 실제로 써보니 나빴다.
-- 독자는 자기가 읽은 기사에 대해 말하려 하는데 다른 매체 기사의 대화가 섞여 들어오고,
-- 매 댓글에 "어느 기사에서 왔는지"를 달아야 겨우 읽히는 화면이 됐다. 이슈 묶음은
-- "여러 매체가 이 사건을 이렇게 다뤘다"를 보여주는 데는 좋지만 대화의 단위로는 너무 넓다.
--
-- 대신 논의는 유저가 여는 별도의 글(discussions)로 옮긴다. 무엇을 이야기할지는 사람이
-- 정하고, 시스템은 "여러 매체가 함께 다룬 사건"을 추천하는 데까지만 관여한다.
--
-- issue_id는 선택이다. 추천에서 시작한 토론에만 붙어 "어떤 사건에 대한 이야기인지"가
-- 남는다. 처음부터 자유롭게 연 글은 비어 있다.

CREATE TABLE discussions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  -- 추천으로 시작했을 때만 채워진다. 이슈는 병합되지 않으므로(0010) 이 참조는 썩지 않는다.
  issue_id     TEXT REFERENCES issues(id),
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',   -- active | deleted
  score        INTEGER NOT NULL DEFAULT 0,       -- 추천 수(비추천은 없다)
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at   TEXT,
  hidden_at    TEXT,
  report_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_discussions_created ON discussions(created_at DESC);
CREATE INDEX idx_discussions_issue ON discussions(issue_id);

-- comments 재구축: 기사 댓글과 토론 댓글이 한 표를 쓰게 한다.
-- 표를 나누지 않는 이유는 추천·신고·삭제·경험치 로직이 전부 댓글에 붙어 있어서다.
-- 나누면 그 넷을 두 벌 유지하게 된다.
--
-- SQLite는 NOT NULL을 떼지 못해 표를 다시 만든다. 0011에서 넣었던 issue_id도 여기서 없앤다
-- (댓글이 이슈에 매달리는 설계 자체를 접었으므로 남겨두면 다음 사람을 헷갈리게 한다).
--
-- comment_reports가 comments를 FK로 참조하므로 그냥 DROP하면 제약에 걸린다. D1은 마이그레이션
-- 중에 PRAGMA foreign_keys를 끌 수 없어, 참조하는 쪽을 잠시 떼었다가 다시 붙인다.
CREATE TABLE comment_reports_backup AS SELECT * FROM comment_reports;
DROP TABLE comment_reports;

CREATE TABLE comments_new (
  id                TEXT PRIMARY KEY,
  article_id        TEXT REFERENCES articles(id),
  discussion_id     TEXT REFERENCES discussions(id),
  user_id           TEXT NOT NULL REFERENCES users(id),
  parent_comment_id TEXT REFERENCES comments_new(id),
  body              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active',
  score             INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at        TEXT,
  hidden_at         TEXT,
  report_count      INTEGER NOT NULL DEFAULT 0,
  -- 댓글은 기사에 달리거나 토론에 달린다. 둘 다이거나 둘 다 아닌 건 없다.
  CHECK ((article_id IS NOT NULL) <> (discussion_id IS NOT NULL))
);

INSERT INTO comments_new
  (id, article_id, user_id, parent_comment_id, body, status, score, created_at, deleted_at, hidden_at, report_count)
SELECT id, article_id, user_id, parent_comment_id, body, status, score, created_at, deleted_at, hidden_at, report_count
FROM comments;

DROP TABLE comments;
ALTER TABLE comments_new RENAME TO comments;

CREATE INDEX idx_comments_article ON comments(article_id, created_at);
CREATE INDEX idx_comments_parent ON comments(parent_comment_id);
CREATE INDEX idx_comments_discussion ON comments(discussion_id, created_at);

-- 신고 표를 원래 정의(FK 포함) 그대로 되살린다. 0008의 정의와 한 글자도 달라선 안 된다.
CREATE TABLE comment_reports (
  comment_id  TEXT NOT NULL REFERENCES comments(id),
  reporter_id TEXT NOT NULL REFERENCES users(id),
  reason      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolved_by TEXT REFERENCES users(id),
  PRIMARY KEY (comment_id, reporter_id)
);
INSERT INTO comment_reports (comment_id, reporter_id, reason, status, created_at, resolved_at, resolved_by)
SELECT comment_id, reporter_id, reason, status, created_at, resolved_at, resolved_by
FROM comment_reports_backup;
DROP TABLE comment_reports_backup;

CREATE INDEX idx_comment_reports_status ON comment_reports(status, created_at DESC);
