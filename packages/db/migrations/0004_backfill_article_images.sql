-- articles.image_url 백필.
--
-- 0003으로 컬럼은 생겼지만, 실제로 도는 collector가 articles INSERT에서 image_url을
-- 빠뜨리고 있어 계속 NULL로만 쌓였다. collector를 고친 뒤, 원본(raw_articles)에
-- 이미지가 있는데 기사에는 비어 있는 행을 한 번 메운다.
--
-- 0003 끝에도 같은 성격의 UPDATE가 있지만, 그때는 raw_articles.image_url 자체가
-- (컬럼이 막 생겨) 전부 비어 있어서 실질적으로 채워진 게 없었다.
UPDATE articles
SET image_url = (
  SELECT r.image_url FROM raw_articles r WHERE r.id = articles.raw_article_id
)
WHERE image_url IS NULL
  AND EXISTS (
    SELECT 1 FROM raw_articles r
    WHERE r.id = articles.raw_article_id AND r.image_url IS NOT NULL
  );
