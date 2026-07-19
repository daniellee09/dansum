export interface SourceConfig {
	id: string;
	name: string;
	url: string;
	type: "rss";
	language: "ko" | "en";
	category: string;
}

export const NEWS_SOURCES: SourceConfig[] = [
	{
		id: "yonhap-economy",
		name: "연합뉴스 경제",
		url: "https://www.yna.co.kr/rss/economy.xml",
		type: "rss",
		language: "ko",
		category: "economy",
	},
	{
		id: "hankyung-economy",
		name: "한국경제",
		url: "https://www.hankyung.com/feed/economy",
		type: "rss",
		language: "ko",
		category: "economy",
	},
	{
		id: "mk-economy",
		name: "매일경제",
		url: "https://www.mk.co.kr/rss/30100041/",
		type: "rss",
		language: "ko",
		category: "economy",
	},
	{
		id: "sedaily",
		name: "서울경제",
		url: "https://www.sedaily.com/RSS/Economy",
		type: "rss",
		language: "ko",
		category: "economy",
	},
	// 미국 무료 접근 소스 (영문 → summarizer가 한국어 번역/요약)
	{
		id: "cnbc-economy",
		name: "CNBC Economy",
		url: "https://www.cnbc.com/id/20910258/device/rss/rss.html",
		type: "rss",
		language: "en",
		category: "global",
	},
	{
		id: "cnbc-finance",
		name: "CNBC Finance",
		url: "https://www.cnbc.com/id/10000664/device/rss/rss.html",
		type: "rss",
		language: "en",
		category: "finance",
	},
	{
		id: "npr-business",
		name: "NPR Business",
		url: "https://feeds.npr.org/1006/rss.xml",
		type: "rss",
		language: "en",
		category: "global",
	},
	{
		id: "fed-press",
		name: "Federal Reserve",
		url: "https://www.federalreserve.gov/feeds/press_all.xml",
		type: "rss",
		language: "en",
		category: "policy",
	},
	{
		id: "marketwatch-top",
		name: "MarketWatch",
		url: "https://feeds.content.dowjones.io/public/rss/mw_topstories",
		type: "rss",
		language: "en",
		category: "market",
	},
	{
		id: "yahoo-finance",
		name: "Yahoo Finance",
		url: "https://finance.yahoo.com/news/rssindex",
		type: "rss",
		language: "en",
		category: "market",
	},
];
