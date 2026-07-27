-- 기사 대표 이미지 URL.
-- raw_articles: RSS(media:content/thumbnail, enclosure, description 내 img)에서 수집 시 채우고,
--   비어 있으면 fetcher가 본문 HTML의 og:image로 보강한다.
-- articles: 요약 생성 시 raw_articles에서 복사해 API가 바로 내려줄 수 있게 한다.
ALTER TABLE raw_articles ADD COLUMN image_url TEXT;
ALTER TABLE articles ADD COLUMN image_url TEXT;

-- 이미 요약된 기사도 원본에 이미지가 있으면 끌어온다(재요약 없이 노출되도록).
UPDATE articles
SET image_url = (
  SELECT r.image_url FROM raw_articles r WHERE r.id = articles.raw_article_id
)
WHERE image_url IS NULL;
