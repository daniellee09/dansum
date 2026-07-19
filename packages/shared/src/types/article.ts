export interface Source {
	id: string;
	name: string;
	url: string;
	type: "rss" | "api";
	language: "ko" | "en";
	/** 수집 출처 분류(운영용). 화면 노출 카테고리는 Article.category(LLM 분류)를 쓴다. */
	category: string;
	isActive: boolean;
	fetchIntervalMin: number;
	lastFetchedAt: string | null;
	createdAt: string;
}

export interface RawArticle {
	id: string;
	sourceId: string;
	url: string;
	urlHash: string;
	title: string;
	content: string | null;
	description: string | null;
	author: string | null;
	publishedAt: string | null;
	status: "pending" | "processing" | "completed" | "failed";
	retryCount: number;
	createdAt: string;
}

/** 요약과 핵심 포인트 사이에 보여줄 구조화 정리 묶음(소제목 + 불릿) */
export interface ArticleSection {
	heading: string;
	points: string[];
}

export interface Article {
	id: string;
	rawArticleId: string;
	sourceId: string;
	title: string;
	originalTitle: string | null;
	summary: string;
	/** 본문을 주제별로 묶어 정리한 섹션(GeekNews 스타일). 빈약하면 빈 배열 */
	sections: ArticleSection[];
	keyPoints: string[];
	category: Category;
	/** 클러스터링(보도량)용 한국어 핵심 키워드 */
	keywords: string[];
	sourceUrl: string;
	sourceName: string;
	publishedAt: string;
	summarizedAt: string;
	createdAt: string;
}

/** 같은 사건을 여러 매체가 보도한 묶음(보도량 기반 "오늘의 주요 뉴스") */
export interface NewsCluster {
	/** 대표 기사(클러스터 내 최신) */
	lead: Article;
	/** 보도 매체 수(distinct source) = 화제성 지표 */
	coverage: number;
	/** 보도 매체 이름 목록 */
	sourceNames: string[];
	/** 클러스터에 속한 전체 기사 id */
	articleIds: string[];
	/**
	 * 지난 스냅샷 대비 순위 변동.
	 * 양수 = 상승(prevRank - currentRank), 음수 = 하락, 0 = 유지, null = 신규 진입
	 */
	rankChange: number | null;
}

export interface DailyDigest {
	id: string;
	digestDate: string;
	title: string;
	summary: string;
	topArticles: string[];
	categoryBreakdown: Record<string, number>;
	createdAt: string;
}

export type Category =
	| "finance"
	| "market"
	| "industry"
	| "realestate"
	| "trade"
	| "macro"
	| "general";
