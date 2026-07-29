-- 참여도/랭킹: 카르마(댓글 추천/비추천으로만 적립, 자기 댓글 투표는 불가) + 배지 + 등급(순수 함수, 테이블 없음)

ALTER TABLE users ADD COLUMN karma INTEGER NOT NULL DEFAULT 0;

-- append-only 이벤트 로그(감사추적용). users.karma는 이 로그의 합계를 캐시한 값.
CREATE TABLE karma_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL, -- comment_vote_changed
  ref_type TEXT,
  ref_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_karma_events_user ON karma_events(user_id, created_at DESC);

CREATE TABLE badges (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT
);

CREATE TABLE user_badges (
  user_id TEXT NOT NULL REFERENCES users(id),
  badge_id TEXT NOT NULL REFERENCES badges(id),
  awarded_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, badge_id)
);

INSERT INTO badges (id, code, name, description, icon) VALUES
  ('badge-first-comment', 'first_comment', '첫 발걸음', '첫 댓글을 남겼어요', '💬'),
  ('badge-karma-10', 'karma_10', '새싹', '카르마 10 달성', '🌱'),
  ('badge-karma-50', 'karma_50', '단골', '카르마 50 달성', '⭐'),
  ('badge-karma-100', 'karma_100', '터줏대감', '카르마 100 달성', '🏆');
