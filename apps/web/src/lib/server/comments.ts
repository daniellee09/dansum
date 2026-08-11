/** 댓글(1단 대댓글) + 추천 + 답글 알림. Phase 1의 db.ts와 분리해 응집도를 유지한다.
 *  신고/가림은 별도 축이라 server/reports.ts로 나눠 뒀다. */

import type { CommentDTO, CommentSort } from "@dansum/shared";
import { EXP_REWARDS } from "@dansum/shared";
import { awardExp } from "./exp";

interface CommentRow {
	id: string;
	article_id: string | null;
	discussion_id: string | null;
	user_id: string;
	nickname: string;
	exp: number;
	parent_comment_id: string | null;
	body: string;
	status: string;
	score: number;
	hidden_at: string | null;
	created_at: string;
}

/**
 * 댓글이 달리는 대상. 기사 하나이거나 토론 글 하나다.
 *
 * 한때 이슈(같은 사건을 다룬 기사 묶음) 단위로 묶어봤지만(0011) 되돌렸다 — 독자는 자기가
 * 읽은 기사에 대해 말하려 하는데 다른 매체 기사의 대화가 섞여 들어왔다. 넓은 주제를
 * 이야기하고 싶으면 토론 글을 연다.
 */
export type CommentTarget = { articleId: string } | { discussionId: string };

// ── 화제순 가중치 ─────────────────────────────────────────────
// '동의가 많은 댓글'이 아니라 '실제로 논의가 붙은 스레드'를 위로 올린다.
// 핵심은 답글 수보다 '서로 다른 사람 수'에 훨씬 큰 가중치를 두는 것 —
// 두 사람이 20번 주고받는 감정 싸움보다, 여덟 명이 한 번씩 붙은 쪽이 더 화제다.
// (검산: 2명 20답글 = 8.4점 vs 6명 6답글 = 12.2점 → 넓은 논의가 이긴다)
const W_PARTICIPANT = 3;
const W_REPLY = 1;
const W_UPVOTE = 0.5; // 동의는 보조 신호일 뿐이다(추천순 탭이 따로 있다)
// 답글 0개인 새 댓글이 0점이 되면, 안 보여서 답글이 안 달리고 답글이 없어서 또 안 보이는
// 콜드스타트에 갇힌다. 그래서 바닥값을 준다.
const BASE = 1;
const AGE_OFFSET_HOURS = 2;
const AGE_EXPONENT = 0.6; // HN식 gravity. 활발한 스레드도 이틀쯤 지나면 새 댓글에 자리를 내준다

function activityScore(c: CommentDTO, nowMs: number): number {
	const participants = new Set<string>([c.author.id]);
	for (const r of c.replies) participants.add(r.author.id);
	const engagement =
		BASE +
		// 자기 자신에게 단 답글은 참여자 가산이 0이 된다(participants.size - 1)
		W_PARTICIPANT * Math.log2(1 + (participants.size - 1)) +
		W_REPLY * Math.log2(1 + c.replies.length) +
		W_UPVOTE * Math.log2(1 + Math.max(0, c.score));
	const ageHours = Math.max(0, (nowMs - Date.parse(c.createdAt)) / 3_600_000);
	return engagement / (ageHours + AGE_OFFSET_HOURS) ** AGE_EXPONENT;
}

function toIso(sqliteDatetime: string): string {
	return `${sqliteDatetime.replace(" ", "T")}Z`;
}

/** 주의: 페이지네이션이 없다. 화제순은 각 최상위의 '답글 수'와 '서로 다른 참여자 수'가
 *  전부 있어야 계산되므로 SQL에 LIMIT을 걸 수 없다 — 잘라내면 랭킹이 조용히 틀어진다.
 *  기사(또는 토론)당 수백 개까진 문제없고, 수천 개가 달리면 이 쿼리 하나에서 멈춘다
 *  (알고 받는 부채). */
export async function listComments(
	db: D1Database,
	target: CommentTarget,
	viewerId: string | null,
	sort: CommentSort = "active",
): Promise<CommentDTO[]> {
	const articleId = "articleId" in target ? target.articleId : null;
	const discussionId = "discussionId" in target ? target.discussionId : null;

	const { results: rows } = await db
		.prepare(
			`SELECT c.id, c.article_id, c.discussion_id, c.user_id, u.nickname, u.exp,
			        c.parent_comment_id, c.body, c.status, c.score, c.hidden_at, c.created_at
			 FROM comments c
			 JOIN users u ON u.id = c.user_id
			 WHERE (?1 IS NOT NULL AND c.article_id = ?1)
			    OR (?2 IS NOT NULL AND c.discussion_id = ?2)
			 ORDER BY c.created_at ASC`,
		)
		.bind(articleId, discussionId)
		.all<CommentRow>();

	const upvoted = new Set<string>();
	const reported = new Set<string>();
	if (viewerId && rows.length > 0) {
		const ids = rows.map((r) => r.id);
		const placeholders = ids.map(() => "?").join(",");
		// value = 1 조건은 혹시 남아있을 비추천 행(0008에서 지웠지만)에 대한 이중 방어다.
		const { results: voteRows } = await db
			.prepare(
				`SELECT target_id FROM votes WHERE user_id = ? AND target_type = 'comment' AND value = 1 AND target_id IN (${placeholders})`,
			)
			.bind(viewerId, ...ids)
			.all<{ target_id: string }>();
		for (const v of voteRows) upvoted.add(v.target_id);

		const { results: reportRows } = await db
			.prepare(
				`SELECT comment_id FROM comment_reports WHERE reporter_id = ? AND comment_id IN (${placeholders})`,
			)
			.bind(viewerId, ...ids)
			.all<{ comment_id: string }>();
		for (const r of reportRows) reported.add(r.comment_id);
	}

	const byId = new Map<string, CommentDTO>();
	const topLevel: CommentDTO[] = [];

	for (const row of rows) {
		const dto: CommentDTO = {
			id: row.id,
			articleId: row.article_id,
			discussionId: row.discussion_id,
			author: { id: row.user_id, nickname: row.nickname, exp: row.exp },
			parentCommentId: row.parent_comment_id,
			body: row.status === "deleted" ? "" : row.body,
			status: row.status as "active" | "deleted",
			score: row.score,
			// 가려진 댓글도 본문을 그대로 실어 보낸다('펼쳐보기'를 두 번째 요청 없이 하려고).
			// 즉 자동 가림은 눈에 안 띄게 하는 마찰 장치이지 보안 통제가 아니다.
			isHidden: row.hidden_at !== null,
			createdAt: toIso(row.created_at),
			isOwner: viewerId === row.user_id,
			viewerUpvoted: upvoted.has(row.id),
			viewerReported: reported.has(row.id),
			replies: [],
		};
		byId.set(row.id, dto);
		if (!row.parent_comment_id) topLevel.push(dto);
	}

	// 대댓글은 1단만 허용하지만, 부모가 지워진 뒤 자식만 남는 경우를 대비해 안전하게 붙인다
	for (const row of rows) {
		if (!row.parent_comment_id) continue;
		const parent = byId.get(row.parent_comment_id);
		const child = byId.get(row.id);
		if (parent && child) parent.replies.push(child);
	}

	// 삭제됐는데 답글도 없는 최상위는 "삭제된 댓글입니다"만 남는 순수 노이즈라 아예 뺀다.
	// 답글이 달렸다면 스레드 맥락이 끊기므로 남긴다.
	const visible = topLevel.filter((c) => c.status !== "deleted" || c.replies.length > 0);

	// 최상위만 정렬 기준을 바꾼다(대댓글은 스레드 흐름을 위해 항상 작성순 유지).
	// 동점/동시각일 땐 최신이 위로 오도록 createdAt 내림차순을 항상 2차 기준으로 둔다.
	const now = Date.now();
	visible.sort((a, b) => {
		// 가려진 댓글은 정렬 탭과 무관하게 언제나 맨 아래로(규칙 하나로 예측 가능하게).
		if (a.isHidden !== b.isHidden) return a.isHidden ? 1 : -1;
		if (sort === "active") {
			return (
				activityScore(b, now) - activityScore(a, now) || b.createdAt.localeCompare(a.createdAt)
			);
		}
		if (sort === "top") return b.score - a.score || b.createdAt.localeCompare(a.createdAt);
		return b.createdAt.localeCompare(a.createdAt);
	});
	return visible;
}

export async function createComment(
	db: D1Database,
	params: { target: CommentTarget; userId: string; parentCommentId: string | null; body: string },
): Promise<{ ok: true; id: string; notifyUserId: string | null } | { ok: false; error: string }> {
	let notifyUserId: string | null = null;

	const articleId = "articleId" in params.target ? params.target.articleId : null;
	const discussionId = "discussionId" in params.target ? params.target.discussionId : null;

	// 대상이 실제로 있는지 본다. 예전엔 검증이 없어 아무 문자열이나 받아들였고,
	// 고아 댓글은 listNotifications의 LEFT JOIN articles도 깨뜨렸다.
	const exists = articleId
		? await db.prepare("SELECT 1 FROM articles WHERE id = ?").bind(articleId).first()
		: await db
				.prepare("SELECT 1 FROM discussions WHERE id = ? AND status = 'active'")
				.bind(discussionId)
				.first();
	if (!exists) {
		return { ok: false, error: articleId ? "기사를 찾을 수 없습니다" : "토론을 찾을 수 없습니다" };
	}

	if (params.parentCommentId) {
		const parent = await db
			.prepare(
				"SELECT article_id, discussion_id, user_id, parent_comment_id FROM comments WHERE id = ? AND status = 'active'",
			)
			.bind(params.parentCommentId)
			.first<{
				article_id: string | null;
				discussion_id: string | null;
				user_id: string;
				parent_comment_id: string | null;
			}>();

		// 부모가 같은 대상에 달려 있어야 한다(남의 기사 댓글에 답글을 심는 것을 막는다)
		const sameTarget = parent
			? articleId
				? parent.article_id === articleId
				: parent.discussion_id === discussionId
			: false;
		if (!sameTarget) return { ok: false, error: "댓글을 찾을 수 없습니다" };
		if (parent?.parent_comment_id) {
			return { ok: false, error: "대댓글에는 답글을 달 수 없습니다" };
		}
		if (parent && parent.user_id !== params.userId) notifyUserId = parent.user_id;
	}

	const id = crypto.randomUUID();
	await db
		.prepare(
			"INSERT INTO comments (id, article_id, discussion_id, user_id, parent_comment_id, body) VALUES (?, ?, ?, ?, ?, ?)",
		)
		.bind(id, articleId, discussionId, params.userId, params.parentCommentId, params.body)
		.run();

	return { ok: true, id, notifyUserId };
}

/**
 * 기사 id 목록 → 그 기사의 활성 댓글 수.
 *
 * /api/articles 응답에 넣지 않는 이유는 깔끔함이 아니라 정확성이다 — 그 응답은 KV에 30분
 * 캐시되고 컬렉터만 무효화하므로 박아 넣은 숫자는 최대 30분 낡는다.
 */
export async function countCommentsByArticleIds(
	db: D1Database,
	articleIds: string[],
): Promise<Record<string, number>> {
	if (articleIds.length === 0) return {};
	const placeholders = articleIds.map(() => "?").join(",");
	const { results } = await db
		.prepare(
			`SELECT article_id, COUNT(*) AS n FROM comments
			 WHERE article_id IN (${placeholders}) AND status = 'active' AND hidden_at IS NULL
			 GROUP BY article_id`,
		)
		.bind(...articleIds)
		.all<{ article_id: string; n: number }>();

	const counts: Record<string, number> = {};
	for (const r of results) {
		if (r.n > 0) counts[r.article_id] = r.n;
	}
	return counts;
}

/**
 * 토론 목록 정렬 점수. activityScore와 같은 뜻을 토론 글 단위로 옮긴 것이라 가중치·감쇠를
 * 그대로 재사용한다(두 곳에 흩어지면 언젠가 서로 다르게 튜닝된다).
 * 여기서도 '댓글 수'보다 '서로 다른 참여자 수'에 큰 가중치를 준다.
 */
export function discussionScore(
	/** lastAt은 ISO 문자열(toIso를 이미 통과한 값) */
	stat: { comments: number; participants: number; score: number; lastAt: string },
	nowMs: number,
): number {
	const engagement =
		BASE +
		W_PARTICIPANT * Math.log2(1 + Math.max(0, stat.participants - 1)) +
		W_REPLY * Math.log2(1 + stat.comments) +
		W_UPVOTE * Math.log2(1 + Math.max(0, stat.score));
	const ageHours = Math.max(0, (nowMs - Date.parse(stat.lastAt)) / 3_600_000);
	return engagement / (ageHours + AGE_OFFSET_HOURS) ** AGE_EXPONENT;
}

export async function deleteComment(
	db: D1Database,
	commentId: string,
	userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const row = await db
		.prepare("SELECT user_id FROM comments WHERE id = ?")
		.bind(commentId)
		.first<{ user_id: string }>();
	if (!row) return { ok: false, error: "댓글을 찾을 수 없습니다" };
	if (row.user_id !== userId) return { ok: false, error: "본인 댓글만 삭제할 수 있습니다" };

	await db
		.prepare("UPDATE comments SET status = 'deleted', body = '', deleted_at = datetime('now') WHERE id = ?")
		.bind(commentId)
		.run();
	return { ok: true };
}

/** 추천 토글. 비추천은 0008에서 폐지했다 — 반대 의견을 묻는 데 쓰였고, 작성자 카르마까지
 *  깎아서 소수 의견에 이중으로 불이익을 줬다. 반대는 답글로, 규칙 위반은 신고로 간다. */
export async function voteComment(
	db: D1Database,
	commentId: string,
	userId: string,
): Promise<{ ok: true; score: number; upvoted: boolean } | { ok: false; error: string }> {
	const comment = await db
		.prepare("SELECT user_id, status, hidden_at FROM comments WHERE id = ?")
		.bind(commentId)
		.first<{ user_id: string; status: string; hidden_at: string | null }>();
	if (!comment) return { ok: false, error: "댓글을 찾을 수 없습니다" };
	// 지금까지 status를 안 봐서 삭제된 댓글에도 투표가 되고 카르마까지 적립됐다.
	if (comment.status === "deleted") return { ok: false, error: "삭제된 댓글입니다" };
	if (comment.hidden_at !== null) return { ok: false, error: "가려진 댓글에는 추천할 수 없습니다" };
	if (comment.user_id === userId) return { ok: false, error: "본인 댓글에는 추천할 수 없습니다" };

	const existing = await db
		.prepare(
			"SELECT value FROM votes WHERE user_id = ? AND target_type = 'comment' AND target_id = ?",
		)
		.bind(userId, commentId)
		.first<{ value: number }>();
	const hadUpvote = existing !== null;
	const upvoted = !hadUpvote; // 다시 누르면 취소

	if (upvoted) {
		await db
			.prepare(
				`INSERT INTO votes (user_id, target_type, target_id, value) VALUES (?, 'comment', ?, 1)
				 ON CONFLICT(user_id, target_type, target_id) DO UPDATE SET value = 1`,
			)
			.bind(userId, commentId)
			.run();
	} else {
		await db
			.prepare("DELETE FROM votes WHERE user_id = ? AND target_type = 'comment' AND target_id = ?")
			.bind(userId, commentId)
			.run();
	}

	const scoreRow = await db
		.prepare(
			"SELECT COALESCE(SUM(value), 0) as score FROM votes WHERE target_type = 'comment' AND target_id = ?",
		)
		.bind(commentId)
		.first<{ score: number }>();
	const score = scoreRow?.score ?? 0;
	await db.prepare("UPDATE comments SET score = ? WHERE id = ?").bind(score, commentId).run();

	// 추천을 취소하면 줬던 만큼 그대로 회수한다(적립과 회수가 비대칭이면 켰다 껐다로 농사가 된다).
	await awardExp(
		db,
		comment.user_id,
		upvoted ? EXP_REWARDS.commentUpvoted : -EXP_REWARDS.commentUpvoted,
		"comment_upvoted",
		"comment",
		commentId,
	);

	return { ok: true, score, upvoted };
}

// ── 알림 ──────────────────────────────────────────────────────

export interface NotificationDTO {
	id: string;
	/** 'reply' | 'keyword'. 렌더는 lib/notifications.ts가 타입별로 분기한다. */
	type: string;
	payload: {
		articleId: string;
		articleTitle: string | null;
		/** reply 전용 */
		commentId?: string;
		fromNickname?: string;
		/** 토론 답글이면 채워진다(기사 답글이면 articleId가 채워진다) */
		discussionId?: string | null;
		/** keyword 전용 */
		issueId?: string;
		keyword?: string;
	};
	isRead: boolean;
	createdAt: string;
}

export async function createReplyNotification(
	db: D1Database,
	params: {
		toUserId: string;
		/** 기사 답글이면 채워진다. listNotifications가 이 값으로 기사 제목을 조인한다. */
		articleId: string | null;
		/** 토론 답글이면 채워진다. */
		discussionId?: string | null;
		commentId: string;
		fromNickname: string;
	},
): Promise<void> {
	await db
		.prepare("INSERT INTO notifications (id, user_id, type, payload) VALUES (?, ?, 'reply', ?)")
		.bind(
			crypto.randomUUID(),
			params.toUserId,
			JSON.stringify({
				articleId: params.articleId,
				discussionId: params.discussionId ?? null,
				commentId: params.commentId,
				fromNickname: params.fromNickname,
			}),
		)
		.run();
}

export async function listNotifications(db: D1Database, userId: string, limit = 20): Promise<NotificationDTO[]> {
	// payload의 articleId로 articles를 조인해 제목을 붙인다(apps/api를 거치지 않고 D1에서 바로).
	const { results } = await db
		.prepare(
			`SELECT n.id, n.type, n.payload, n.is_read, n.created_at,
			        COALESCE(a.title, d.title) as article_title
			 FROM notifications n
			 LEFT JOIN articles a ON a.id = json_extract(n.payload, '$.articleId')
			 LEFT JOIN discussions d ON d.id = json_extract(n.payload, '$.discussionId')
			 WHERE n.user_id = ?
			 ORDER BY n.created_at DESC LIMIT ?`,
		)
		.bind(userId, limit)
		.all<{ id: string; type: string; payload: string; is_read: number; created_at: string; article_title: string | null }>();
	return results.map((r) => ({
		id: r.id,
		type: r.type,
		payload: { ...JSON.parse(r.payload), articleTitle: r.article_title },
		isRead: r.is_read === 1,
		createdAt: toIso(r.created_at),
	}));
}

export async function countUnreadNotifications(db: D1Database, userId: string): Promise<number> {
	const row = await db
		.prepare("SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0")
		.bind(userId)
		.first<{ c: number }>();
	return row?.c ?? 0;
}

export async function markNotificationRead(db: D1Database, userId: string, notificationId: string): Promise<void> {
	await db
		.prepare("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?")
		.bind(notificationId, userId)
		.run();
}

export async function markAllNotificationsRead(db: D1Database, userId: string): Promise<void> {
	await db
		.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0")
		.bind(userId)
		.run();
}
