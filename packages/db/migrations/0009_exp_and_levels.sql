-- 카르마 → 경험치·레벨·등급 개편
--
-- 그동안 점수는 '댓글 추천'에서만 올랐고 이름이 카르마였다. 이제 여러 활동(추천받기·댓글
-- 작성·답글 받기·출석)으로 경험치를 쌓아 레벨(최대 50)을 올리고, 레벨 구간으로 등급을 나눈다.
-- 등급: 초심자(Lv.1~) 관찰자(5~) 분석가(15~) 전략가(30~) 통찰가(45~)
--
-- ⚠️ 컬럼을 rename하지 않고 새로 추가한 이유:
-- apps/web은 Cloudflare Pages가 이 마이그레이션과 무관하게 병렬로 배포한다. RENAME COLUMN을
-- 쓰면 둘 사이 구간에서 '옛 코드가 karma를 못 찾는' 창이 반드시 생긴다(어느 쪽이 먼저 뜨든).
-- 순수 추가면 옛 코드는 karma를, 새 코드는 exp를 보므로 어느 순서로 배포돼도 깨지지 않는다.
-- users.karma와 karma_events는 남겨두되 더 이상 쓰지 않는다(정리는 다음 마이그레이션에서).

ALTER TABLE users ADD COLUMN exp INTEGER NOT NULL DEFAULT 0;

-- 기존 카르마를 경험치로 그대로 이관한다(1:1). 추천 1개 = 카르마 1이었으므로 새 규칙(추천
-- 1개 = 경험치 10)과 단위가 다르지만, 과거 활동을 소급해 부풀리지 않는 쪽을 택했다.
UPDATE users SET exp = karma;

-- 새 원장. karma_events와 같은 모양이되 reason에 활동 종류가 들어간다
-- (comment_upvoted | comment_created | reply_received | attendance).
CREATE TABLE exp_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_exp_events_user ON exp_events(user_id, created_at DESC);
-- 출석은 '하루 한 번'을 DB에서 보장한다(KV만 믿으면 캐시가 날아갔을 때 중복 적립된다).
CREATE UNIQUE INDEX idx_exp_events_attendance
  ON exp_events(user_id, date(created_at))
  WHERE reason = 'attendance';

-- 과거 이력도 옮겨둔다(감사 추적이 끊기지 않게).
INSERT INTO exp_events (id, user_id, delta, reason, ref_type, ref_id, created_at)
SELECT id, user_id, delta, 'legacy_karma', ref_type, ref_id, created_at FROM karma_events;

-- 배지 기준을 카르마 수치에서 레벨로 바꾼다. 코드(code)는 karma.ts가 참조하므로 함께 갱신한다.
UPDATE badges SET code = 'level_5',  name = '관찰자',   description = '레벨 5 달성',  icon = '🌱' WHERE code = 'karma_10';
UPDATE badges SET code = 'level_15', name = '분석가',   description = '레벨 15 달성', icon = '⭐' WHERE code = 'karma_50';
UPDATE badges SET code = 'level_30', name = '전략가',   description = '레벨 30 달성', icon = '🏆' WHERE code = 'karma_100';
UPDATE badges SET description = '첫 댓글을 남겼어요' WHERE code = 'first_comment';

INSERT OR IGNORE INTO badges (id, code, name, description, icon) VALUES
  ('badge-level-45', 'level_45', '통찰가', '레벨 45 달성', '💎');
