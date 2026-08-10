-- 댓글을 기사가 아니라 이슈에 매단다.
--
-- 지금까지 댓글의 단위는 기사였다. 그런데 제품의 단위는 이슈다 — 같은 사건을 5개 매체가
-- 보도하면 논의가 5조각으로 쪼개져, 홈은 "여러 매체가 함께 보도한 이슈"를 보여주면서
-- 정작 그 이슈에 대해 말하려면 매체 하나를 골라 그 기사의 빈 댓글창에 혼자 써야 했다.
--
-- article_id는 지우지 않는다. "어느 기사에서 썼는가"는 그 자체로 맥락이고(다른 매체 기사에서
-- 온 댓글에 매체명을 붙여준다), 이슈가 아직 배정되지 않은 기사의 폴백 경로이기도 하다.

ALTER TABLE comments ADD COLUMN issue_id TEXT;

-- 이슈 단위 스레드 조회(listComments)와 카드의 댓글 수 집계가 함께 쓴다.
CREATE INDEX idx_comments_issue ON comments(issue_id, created_at);

-- 기존 댓글을 소속 기사의 이슈로 옮긴다.
-- 빈 DB(CI의 migrations 잡)에서는 대상이 0행이라 no-op이다 — 어떤 마이그레이션도
-- 데이터가 있다고 가정해서는 안 된다.
UPDATE comments
   SET issue_id = (SELECT a.issue_id FROM articles a WHERE a.id = comments.article_id)
 WHERE issue_id IS NULL;
