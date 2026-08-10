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

// ── 경험치 ────────────────────────────────────────────────────

/**
 * 활동별 경험치. **추천받기에 가장 큰 비중을 둔 것이 핵심이다** —
 * 남이 가치 있다고 봐줘야만 크게 오르므로, 아무 말이나 많이 써서 레벨을 올릴 수 없다.
 * 작성/출석은 참여를 유도하는 최소한의 양념이고, 도배를 막기 위해 작성은 일일 상한을 둔다.
 */
export const EXP_REWARDS = {
	/** 내 댓글이 추천을 받았을 때(취소하면 같은 값만큼 회수) */
	commentUpvoted: 10,
	/** 댓글을 썼을 때. EXP_DAILY_COMMENT_LIMIT건까지만 인정 */
	commentCreated: 3,
	/** 내 댓글에 답글이 달렸을 때. 논쟁적인 글도 답글이 많이 달리므로 비중을 작게 둔다 */
	replyReceived: 2,
	/** 하루 첫 방문 */
	attendance: 1,
} as const;

/** 하루에 경험치를 인정하는 댓글 수. 넘겨서 써도 되지만 경험치는 더 오르지 않는다. */
export const EXP_DAILY_COMMENT_LIMIT = 5;

/** 신고 사유 목록 자체가 정책 선언이다 — '내 의견과 다름'이 없는 것이 핵심이다.
 *  의견 불일치를 신고 사유로 제공하면 반대 의견을 묻는 새 수단을 만들어주는 셈이 된다. */
export const REPORT_REASONS: ReadonlyArray<{ key: ReportReason; label: string }> = [
	{ key: "insult", label: "인신공격·모욕" },
	{ key: "hate", label: "혐오·차별 표현" },
	{ key: "spam", label: "도배·광고" },
	// 스레드가 기사 단위에서 이슈 단위로 바뀌어(0011) 한 스레드에 여러 매체의 기사가 섞인다.
	// "기사와 무관"은 이제 "내가 보고 있는 기사와 무관"으로 잘못 읽힌다.
	{ key: "offtopic", label: "주제와 무관" },
	{ key: "etc", label: "기타" },
];

export function isReportReason(value: unknown): value is ReportReason {
	return REPORT_REASONS.some((r) => r.key === value);
}

// ── 키워드 알림 ────────────────────────────────────────────────
/** 한 사람이 팔로우할 수 있는 키워드 수. 알림은 많을수록 덜 읽히므로 넉넉함보다 적당함이 낫다. */
export const KEYWORD_ALERT_MAX_FOLLOWS = 20;
/** 한 사람이 파이프라인 한 번(30분)에 받을 수 있는 키워드 알림 수 상한.
 *  큰 사건이 터지면 한 tick에 관련 이슈가 여럿 생기는데, 그때 종이 20개 울리면 안 된다. */
export const KEYWORD_ALERTS_PER_RUN = 3;
/** 너무 짧은 키워드는 아무 데나 걸린다(부분 문자열 매칭이라 더 그렇다). */
export const KEYWORD_MIN_LENGTH = 2;
export const KEYWORD_MAX_LENGTH = 20;
