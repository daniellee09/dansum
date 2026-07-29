/** 댓글(1단 대댓글) + 추천/비추천 + 답글 알림. Phase 1의 db.ts와 분리해 응집도를 유지한다. */

import { awardKarma } from "./karma";

export interface CommentDTO {
	id: string;
	articleId: string;
	author: { id: string; nickname: string; karma: number };
	parentCommentId: string | null;
	body: string;
	status: "active" | "deleted";
	score: number;
	createdAt: string;
	isOwner: boolean;
	viewerVote: 1 | -1 | 0;
	replies: CommentDTO[];
}

interface CommentRow {
	id: string;
	article_id: string;
	user_id: string;
	nickname: string;
	karma: number;
	parent_comment_id: string | null;
	body: string;
	status: string;
	score: number;
	created_at: string;
}

function toIso(sqliteDatetime: string): string {
	return `${sqliteDatetime.replace(" ", "T")}Z`;
}

export async function listComments(
	db: D1Database,
	articleId: string,
	viewerId: string | null,
	sort: "latest" | "top" = "latest",
): Promise<CommentDTO[]> {
	const { results: rows } = await db
		.prepare(
			`SELECT c.id, c.article_id, c.user_id, u.nickname, u.karma, c.parent_comment_id, c.body, c.status, c.score, c.created_at
			 FROM comments c JOIN users u ON u.id = c.user_id
			 WHERE c.article_id = ?
			 ORDER BY c.created_at ASC`,
		)
		.bind(articleId)
		.all<CommentRow>();

	const voteMap = new Map<string, 1 | -1>();
	if (viewerId && rows.length > 0) {
		const ids = rows.map((r) => r.id);
		const placeholders = ids.map(() => "?").join(",");
		const { results: voteRows } = await db
			.prepare(
				`SELECT target_id, value FROM votes WHERE user_id = ? AND target_type = 'comment' AND target_id IN (${placeholders})`,
			)
			.bind(viewerId, ...ids)
			.all<{ target_id: string; value: number }>();
		for (const v of voteRows) voteMap.set(v.target_id, v.value as 1 | -1);
	}

	const byId = new Map<string, CommentDTO>();
	const topLevel: CommentDTO[] = [];

	for (const row of rows) {
		const dto: CommentDTO = {
			id: row.id,
			articleId: row.article_id,
			author: { id: row.user_id, nickname: row.nickname, karma: row.karma },
			parentCommentId: row.parent_comment_id,
			body: row.status === "deleted" ? "" : row.body,
			status: row.status as "active" | "deleted",
			score: row.score,
			createdAt: toIso(row.created_at),
			isOwner: viewerId === row.user_id,
			viewerVote: voteMap.get(row.id) ?? 0,
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

	// 최상위만 정렬 기준을 바꾼다(대댓글은 스레드 흐름을 위해 항상 작성순 유지).
	// 동점/동시각일 땐 최신이 위로 오도록 createdAt 내림차순을 항상 2차 기준으로 둔다.
	if (sort === "top") {
		topLevel.sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt));
	} else {
		topLevel.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}
	return topLevel;
}

export async function createComment(
	db: D1Database,
	params: { articleId: string; userId: string; parentCommentId: string | null; body: string },
): Promise<{ ok: true; id: string; notifyUserId: string | null } | { ok: false; error: string }> {
	let notifyUserId: string | null = null;

	if (params.parentCommentId) {
		const parent = await db
			.prepare("SELECT article_id, user_id, parent_comment_id FROM comments WHERE id = ? AND status = 'active'")
			.bind(params.parentCommentId)
			.first<{ article_id: string; user_id: string; parent_comment_id: string | null }>();
		if (!parent || parent.article_id !== params.articleId) {
			return { ok: false, error: "댓글을 찾을 수 없습니다" };
		}
		if (parent.parent_comment_id) {
			return { ok: false, error: "대댓글에는 답글을 달 수 없습니다" };
		}
		if (parent.user_id !== params.userId) notifyUserId = parent.user_id;
	}

	const id = crypto.randomUUID();
	await db
		.prepare(
			"INSERT INTO comments (id, article_id, user_id, parent_comment_id, body) VALUES (?, ?, ?, ?, ?)",
		)
		.bind(id, params.articleId, params.userId, params.parentCommentId, params.body)
		.run();

	return { ok: true, id, notifyUserId };
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

export async function voteComment(
	db: D1Database,
	commentId: string,
	userId: string,
	value: 1 | -1,
): Promise<{ ok: true; score: number } | { ok: false; error: string }> {
	const comment = await db
		.prepare("SELECT user_id FROM comments WHERE id = ?")
		.bind(commentId)
		.first<{ user_id: string }>();
	if (!comment) return { ok: false, error: "댓글을 찾을 수 없습니다" };
	if (comment.user_id === userId) return { ok: false, error: "본인 댓글에는 투표할 수 없습니다" };

	const existing = await db
		.prepare("SELECT value FROM votes WHERE user_id = ? AND target_type = 'comment' AND target_id = ?")
		.bind(userId, commentId)
		.first<{ value: number }>();
	const oldValue = existing?.value ?? 0;
	const newValue = existing?.value === value ? 0 : value; // 같은 값을 다시 누르면 취소

	if (newValue === 0) {
		await db
			.prepare("DELETE FROM votes WHERE user_id = ? AND target_type = 'comment' AND target_id = ?")
			.bind(userId, commentId)
			.run();
	} else {
		await db
			.prepare(
				`INSERT INTO votes (user_id, target_type, target_id, value) VALUES (?, 'comment', ?, ?)
				 ON CONFLICT(user_id, target_type, target_id) DO UPDATE SET value = excluded.value`,
			)
			.bind(userId, commentId, newValue)
			.run();
	}

	const scoreRow = await db
		.prepare("SELECT COALESCE(SUM(value), 0) as score FROM votes WHERE target_type = 'comment' AND target_id = ?")
		.bind(commentId)
		.first<{ score: number }>();
	const score = scoreRow?.score ?? 0;
	await db.prepare("UPDATE comments SET score = ? WHERE id = ?").bind(score, commentId).run();

	await awardKarma(db, comment.user_id, newValue - oldValue, "comment_vote_changed", "comment", commentId);

	return { ok: true, score };
}

// ── 알림 ──────────────────────────────────────────────────────

export interface NotificationDTO {
	id: string;
	type: string;
	payload: { articleId: string; commentId: string; fromNickname: string; articleTitle: string | null };
	isRead: boolean;
	createdAt: string;
}

export async function createReplyNotification(
	db: D1Database,
	params: { toUserId: string; articleId: string; commentId: string; fromNickname: string },
): Promise<void> {
	await db
		.prepare("INSERT INTO notifications (id, user_id, type, payload) VALUES (?, ?, 'reply', ?)")
		.bind(
			crypto.randomUUID(),
			params.toUserId,
			JSON.stringify({
				articleId: params.articleId,
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
			`SELECT n.id, n.type, n.payload, n.is_read, n.created_at, a.title as article_title
			 FROM notifications n
			 LEFT JOIN articles a ON a.id = json_extract(n.payload, '$.articleId')
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
