import type {
	Article,
	NewsCluster,
	PaginatedResponse,
	ApiResponse,
} from "@dansum/shared";

const API_BASE = import.meta.env.PUBLIC_API_URL ?? "http://localhost:8787";

async function fetchApi<T>(path: string): Promise<T> {
	const res = await fetch(`${API_BASE}${path}`);
	if (!res.ok) throw new Error(`API error: ${res.status}`);
	const json = (await res.json()) as ApiResponse<T>;
	if (!json.success) throw new Error(json.error ?? "Unknown error");
	return json.data;
}

export async function getArticles(options?: {
	page?: number;
	pageSize?: number;
	category?: string;
	/** 매체 필터(sources.id) */
	source?: string;
	q?: string;
	/** "hot" = 인기순, "latest" = 최신순. 검색(q)에서 생략하면 관련도순(기본) */
	sort?: "latest" | "hot";
}) {
	const params = new URLSearchParams();
	if (options?.page) params.set("page", String(options.page));
	if (options?.pageSize) params.set("pageSize", String(options.pageSize));
	if (options?.category) params.set("category", options.category);
	if (options?.source) params.set("source", options.source);
	if (options?.q) params.set("q", options.q);
	if (options?.sort) params.set("sort", options.sort);

	const query = params.toString();
	return fetchApi<PaginatedResponse<Article>>(
		`/api/articles${query ? `?${query}` : ""}`,
	);
}

export async function getTopClusters(limit = 6) {
	return fetchApi<NewsCluster[]>(`/api/top?limit=${limit}`);
}

/** "Hot!": 최근 24시간 안에서 보도량 점수가 가장 높은 개별 기사 상위 limit개. 캐시 없이 항상 최신. */
export async function getHotArticles(limit = 50) {
	return fetchApi<Article[]>(`/api/hot?limit=${limit}`);
}

export async function getArticle(id: string) {
	return fetchApi<Article>(`/api/articles/${id}`);
}

export async function getRelatedArticles(id: string, limit = 5) {
	return fetchApi<Article[]>(`/api/articles/${id}/related?limit=${limit}`);
}

/** 이슈(같은 사건을 다룬 기사 묶음) 상세. 논의(댓글)는 여기 오지 않는다 —
 *  계정 도메인이라 apps/web이 D1에서 직접 읽는다. */
export interface IssueDetail {
	id: string;
	lead: Article;
	articles: Article[];
	coverage: number;
	sourceNames: string[];
	firstPublishedAt: string | null;
	lastPublishedAt: string | null;
}

export async function getIssue(id: string) {
	return fetchApi<IssueDetail>(`/api/issues/${id}`);
}

export async function getCategories() {
	return fetchApi<Array<{ category: string; count: number }>>("/api/categories");
}
