import type { Category } from "../types/article.js";

export const CATEGORY_LABELS: Record<Category, string> = {
	finance: "금융",
	market: "증시",
	industry: "산업·기업",
	realestate: "부동산",
	trade: "무역·통상",
	macro: "거시·정책",
	general: "일반",
};

/** 헤더 네비 등 노출 순서(폴백 general 제외) */
export const CATEGORY_ORDER: Category[] = [
	"finance",
	"market",
	"industry",
	"realestate",
	"trade",
	"macro",
];

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_RETRY_COUNT = 3;
// 콘텐츠는 cron으로 30분마다만 갱신되므로 피드 캐시도 30분(무료 KV put 한도 절약).
export const FEED_CACHE_TTL = 1800; // 30분
// 기사 요약은 생성 후 불변 → 길게 캐시해 재기록(put) 최소화.
export const ARTICLE_CACHE_TTL = 86400; // 1일
