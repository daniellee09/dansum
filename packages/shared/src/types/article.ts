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
	/** 대표 이미지 URL(RSS 또는 og:image). 없으면 null */
	imageUrl: string | null;
	status: "pending" | "processing" | "completed" | "failed";
	retryCount: number;
	createdAt: string;
}

/**
 * 섹션 불릿 하나.
 * 중첩은 GeekNews와 동일하게 1단(children)까지만 허용한다. 재귀 타입으로 두지 않는 이유는
 * 모델이 깊은 트리를 뱉는 것을 스키마 차원에서 막고 렌더러를 단순하게 유지하기 위함.
 */
export interface SectionPoint {
	/** 마크다운은 ** 강조만 허용(그 외 문법 금지) */
	text: string;
	children?: string[];
}

/** 구조화 정리 묶음(소제목 + 불릿). 상세 페이지의 "주요 내용" 블록 */
export interface ArticleSection {
	heading: string;
	points: SectionPoint[];
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
	/** 대표 이미지 URL(RSS 또는 og:image). 없으면 null */
	imageUrl: string | null;
	publishedAt: string;
	summarizedAt: string;
	createdAt: string;
	/**
	 * 이 기사가 속한 이슈(같은 사건을 다룬 기사들의 영구 묶음). 수집 시점에 정해지며 바뀌지 않는다.
	 * 아직 배정되지 않은 기사(컬렉터 드레인 대기)는 null이다 — 읽기 쪽은 이 경우를 단독 이슈로 다룬다.
	 */
	issueId: string | null;
}

/** 같은 사건을 여러 매체가 보도한 묶음(보도량 기반 "오늘의 주요 뉴스") */
export interface NewsCluster {
	/** 대표 기사(클러스터 내 최신) */
	lead: Article;
	/** 이슈 페이지(/issue/[id]) 링크용. 아직 배정 전인 기사만 모인 묶음이면 null */
	issueId: string | null;
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
