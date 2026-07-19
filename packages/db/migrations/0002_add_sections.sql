-- 구조화 정리 섹션: 요약과 핵심 포인트 사이에 보여줄 소제목+불릿 묶음(JSON 배열)
-- 형식: [{"heading": "...", "points": ["...", "..."]}]
ALTER TABLE articles ADD COLUMN sections TEXT NOT NULL DEFAULT '[]';
