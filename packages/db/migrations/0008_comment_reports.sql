-- 공론화 장 전환: 비추천 폐지(→ 신고로 대체) + 신고 누적 자동 가림
--
-- 배경: 비추천은 '저품질'이 아니라 '반대 의견'에 눌렸고, voteComment가 비추천 1개당
-- 작성자 카르마를 1 깎았다. 소수 의견을 내면 점수가 내려가는 데 그치지 않고 등급까지
-- 손해를 보는 구조라, 정치적 편가르기를 시스템이 직접 보상하고 있었다.
-- 반대는 답글로, 규칙 위반은 신고로 분리한다.

-- ── 가림(hidden) ──────────────────────────────────────────────
-- status에 'hidden'을 추가하지 않고 별도 컬럼을 쓴다. 삭제와 가림은 직교하는 축이라
-- (가려진 댓글도 작성자가 삭제할 수 있어야 하고, 관리자가 가림을 풀면 원래 status로
-- 돌아가야 한다) status에 넣으면 '가리기 전 상태'를 따로 기억해야 한다.
-- hidden_at은 그 자체로 감사 시각도 된다.
ALTER TABLE comments ADD COLUMN hidden_at TEXT;

-- comments.score와 같은 이유로 denormalize한다(임계값 평가 중 어차피 세므로 쓰기가 공짜).
ALTER TABLE comments ADD COLUMN report_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE comment_reports (
  comment_id  TEXT NOT NULL REFERENCES comments(id),
  reporter_id TEXT NOT NULL REFERENCES users(id),
  reason      TEXT NOT NULL,                   -- insult | hate | spam | offtopic | etc
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | dismissed | upheld
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolved_by TEXT REFERENCES users(id),
  -- 복합 PK가 중복 신고 방지 + 고유 신고자 카운터를 겸한다.
  -- INSERT OR IGNORE 후 meta.changes === 0이면 '이미 신고함'.
  PRIMARY KEY (comment_id, reporter_id)
);

-- 관리자 화면은 pending을 최신순으로만 훑는다.
CREATE INDEX idx_comment_reports_status ON comment_reports(status, created_at DESC);

-- ── 기존 비추천 데이터 정리 ────────────────────────────────────
-- 주의: karma_events의 음수 delta를 되돌리는 방식은 쓸 수 없다.
-- voteComment는 '추천 취소'도 (0 - 1) = -1로 기록해서 신규 비추천과 구분이 안 된다.
-- 원장만으로는 판별 불가하므로, 실제 ground truth인 votes에서 재계산한다.

-- 1) 비추천 표 삭제. 남겨두면 없어진 기능이 점수에 유령으로 계속 남는다.
DELETE FROM votes WHERE target_type = 'comment' AND value = -1;

-- 2) score 캐시를 남은 추천만으로 재계산.
UPDATE comments SET score = (
  SELECT COALESCE(SUM(v.value), 0) FROM votes v
   WHERE v.target_type = 'comment' AND v.target_id = comments.id
);

-- 3) karma_events는 append-only 원장이라 과거 행을 고치거나 지우지 않는다.
--    새 규칙상 정답(= 내 댓글이 받은 추천 수)과 현재 users.karma의 차액만큼 보정 1건을 남긴다.
INSERT INTO karma_events (id, user_id, delta, reason, ref_type, ref_id)
SELECT
  lower(hex(randomblob(16))),
  u.id,
  (SELECT COUNT(*) FROM votes v JOIN comments c ON c.id = v.target_id
    WHERE v.target_type = 'comment' AND c.user_id = u.id) - u.karma,
  'downvote_removal_adjustment',
  'migration',
  '0008'
FROM users u
WHERE (SELECT COUNT(*) FROM votes v JOIN comments c ON c.id = v.target_id
        WHERE v.target_type = 'comment' AND c.user_id = u.id) <> u.karma;

-- 4) 캐시를 원장 합계와 재동기화. 굳이 votes가 아니라 원장에서 다시 유도하는 이유는,
--    3과 4가 어긋나면 조용히 자가교정되는 대신 눈에 보이는 버그가 되게 하려는 것이다.
UPDATE users SET karma = (
  SELECT COALESCE(SUM(delta), 0) FROM karma_events ke WHERE ke.user_id = users.id
);

-- 배지는 회수하지 않는다. user_badges에 회수 경로가 없고, 카르마가 임계값 아래로
-- 내려간 몇 명 때문에 만들 가치가 없다(이미 받은 격려를 뺏는 것도 이상하다).
