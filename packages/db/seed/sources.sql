-- 한국 경제 뉴스 RSS 소스
INSERT INTO sources (id, name, url, type, language, category) VALUES
  ('yonhap-economy', '연합뉴스 경제', 'https://www.yna.co.kr/rss/economy.xml', 'rss', 'ko', 'economy'),
  ('hankyung-economy', '한국경제', 'https://www.hankyung.com/feed/economy', 'rss', 'ko', 'economy'),
  ('mk-economy', '매일경제', 'https://www.mk.co.kr/rss/30100041/', 'rss', 'ko', 'economy'),
  ('sedaily', '서울경제', 'https://www.sedaily.com/RSS/Economy', 'rss', 'ko', 'economy'),
  ('cnbc-economy', 'CNBC Economy', 'https://www.cnbc.com/id/20910258/device/rss/rss.html', 'rss', 'en', 'global'),
  ('cnbc-finance', 'CNBC Finance', 'https://www.cnbc.com/id/10000664/device/rss/rss.html', 'rss', 'en', 'finance'),
  ('npr-business', 'NPR Business', 'https://feeds.npr.org/1006/rss.xml', 'rss', 'en', 'global'),
  ('fed-press', 'Federal Reserve', 'https://www.federalreserve.gov/feeds/press_all.xml', 'rss', 'en', 'policy'),
  ('marketwatch-top', 'MarketWatch', 'https://feeds.content.dowjones.io/public/rss/mw_topstories', 'rss', 'en', 'market'),
  ('yahoo-finance', 'Yahoo Finance', 'https://finance.yahoo.com/news/rssindex', 'rss', 'en', 'market');
