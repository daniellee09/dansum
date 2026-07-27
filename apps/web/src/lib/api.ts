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
	category?: string;
	/** 매체 필터(sources.id) */
	source?: string;
	q?: string;
}) {
	const params = new URLSearchParams();
	if (options?.page) params.set("page", String(options.page));
	if (options?.category) params.set("category", options.category);
	if (options?.source) params.set("source", options.source);
	if (options?.q) params.set("q", options.q);

	const query = params.toString();
	return fetchApi<PaginatedResponse<Article>>(
		`/api/articles${query ? `?${query}` : ""}`,
	);
}

export async function getTopClusters(limit = 6) {
	return fetchApi<NewsCluster[]>(`/api/top?limit=${limit}`);
}

export async function getArticle(id: string) {
	return fetchApi<Article>(`/api/articles/${id}`);
}

export async function getRelatedArticles(id: string, limit = 5) {
	return fetchApi<Article[]>(`/api/articles/${id}/related?limit=${limit}`);
}

export async function getCategories() {
	return fetchApi<Array<{ category: string; count: number }>>("/api/categories");
}
