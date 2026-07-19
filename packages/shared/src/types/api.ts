import type { Article } from "./article.js";

export interface ApiResponse<T> {
	success: boolean;
	data: T;
	error?: string;
}

export interface PaginatedResponse<T> {
	items: T[];
	total: number;
	page: number;
	pageSize: number;
	hasMore: boolean;
}

export interface ArticleListQuery {
	page?: number;
	pageSize?: number;
	category?: string;
}

export type ArticleListResponse = ApiResponse<PaginatedResponse<Article>>;
export type ArticleDetailResponse = ApiResponse<Article>;
