-- 이슈: 같은 사건을 다룬 기사들의 영구 식별자.
--
-- 왜 필요한가: "오늘의 주요 뉴스"의 클러스터는 읽기 시점(apps/api/src/services/article-service.ts)에
-- 매 요청 다시 계산되는 휘발성 개념이라 id가 없었다. 그래서 댓글이 붙을 곳이 없었고, 같은 사건을
-- 5개 매체가 보도하면 논의가 5조각으로 쪼개졌다. 제품의 단위는 기사가 아니라 이슈다.
--
-- ⚠️ 두 가지 불변식 — 어기면 전부 무너진다:
--
--  1) articles.issue_id는 한 번 정해지면 바뀌지 않는다. **이슈 병합 경로를 만들지 않는다.**
--     댓글이 issue_id에 매달리므로, 병합은 읽던 스레드가 조용히 다른 스레드가 되는 일이다
--     ("독자 발밑의 땅을 움직이지 않는다"의 정면 위반). 하나로 묶였어야 할 이슈가 둘로
--     갈리는 건 값싼 실패고, 스레드가 변질되는 건 되돌릴 수 없는 실패다.
--     정말 병합이 필요하면 수동 SQL + RUNBOOK 기록으로 한다. 기능으로 만들지 않는다.
--
--  2) match_keywords는 창설 기사에서 뽑아 **동결**한다. 절대 합집합으로 늘리지 않는다.
--     이유는 packages/shared/src/utils/cluster.ts의 ISSUE_MATCH_KEYWORD_MAX 주석 참고
--     (요약: 합집합으로 키우면 며칠 안에 이슈 하나가 피드 전체를 흡수한다).
--
-- 흡수 종료도 컬럼이 아니라 쿼리 조건이다: last_published_at >= -36h.

CREATE TABLE issues (
  id                 TEXT PRIMARY KEY,
  -- JSON string[] (정규화됨, 최대 ISSUE_MATCH_KEYWORD_MAX개). 창설 시점에 고정.
  match_keywords     TEXT NOT NULL,
  -- 최신 멤버 캐시. articles.issue_id와 서로를 참조하는 순환 FK가 되므로 FK는 걸지 않는다.
  lead_article_id    TEXT,
  article_count      INTEGER NOT NULL DEFAULT 0,
  source_count       INTEGER NOT NULL DEFAULT 0,
  first_published_at TEXT,
  last_published_at  TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 흡수 후보 조회(last_published_at >= -36h)와 /discuss 정렬이 쓰는 인덱스.
CREATE INDEX idx_issues_last_published ON issues(last_published_at DESC);

ALTER TABLE articles ADD COLUMN issue_id TEXT REFERENCES issues(id);

-- 이슈별 멤버 조회 + 컬렉터의 미배정 드레인(issue_id IS NULL)이 함께 쓴다.
CREATE INDEX idx_articles_issue ON articles(issue_id, published_at DESC);
