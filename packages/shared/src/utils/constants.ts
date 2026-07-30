import type { Category } from "../types/article.js";
import type { CommentSort, ReportReason } from "../types/comment.js";

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

// ── 댓글 ──────────────────────────────────────────────────────

export const COMMENT_MAX_LENGTH = 1000;

/** 기본은 화제순 — '동의가 많은 댓글'이 아니라 '논의가 붙은 댓글'을 먼저 보여주려는 의도다.
 *  추천순을 기본으로 두면 다수 의견이 상단을 독점해 소수 의견이 시야에서 사라진다. */
export const COMMENT_SORTS: ReadonlyArray<{ key: CommentSort; label: string }> = [
	{ key: "active", label: "화제순" },
	{ key: "latest", label: "최신순" },
	{ key: "top", label: "추천순" },
];

export const DEFAULT_COMMENT_SORT: CommentSort = "active";

export function parseCommentSort(value: string | null): CommentSort {
	return COMMENT_SORTS.some((s) => s.key === value) ? (value as CommentSort) : DEFAULT_COMMENT_SORT;
}

/** 서로 다른 신고자 N명이 모이면 자동으로 접는다. 악용되면 이 숫자만 올리면 된다. */
export const REPORT_HIDE_THRESHOLD = 3;

/** 신고 사유 목록 자체가 정책 선언이다 — '내 의견과 다름'이 없는 것이 핵심이다.
 *  의견 불일치를 신고 사유로 제공하면 반대 의견을 묻는 새 수단을 만들어주는 셈이 된다. */
export const REPORT_REASONS: ReadonlyArray<{ key: ReportReason; label: string }> = [
	{ key: "insult", label: "인신공격·모욕" },
	{ key: "hate", label: "혐오·차별 표현" },
	{ key: "spam", label: "도배·광고" },
	{ key: "offtopic", label: "기사와 무관" },
	{ key: "etc", label: "기타" },
];

export function isReportReason(value: unknown): value is ReportReason {
	return REPORT_REASONS.some((r) => r.key === value);
}
