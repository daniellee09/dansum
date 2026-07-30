/** 댓글 신고 + 신고 누적 자동 가림 + 관리자 처리.
 *  comments.ts에 넣지 않은 이유: 신고/가림은 댓글 본연의 CRUD와 다른 축이고,
 *  comments.ts는 이미 알림까지 안고 있어 응집도가 한계다. */

import type { ReportReason } from "@dansum/shared";
import { REPORT_HIDE_THRESHOLD } from "@dansum/shared";

/** 관리자 화면 전용. 공개 CommentDTO에는 reportCount를 넣지 않는다 —
 *  신고자에게 "몇 개 더 모으면 가려지는지" 알려주는 꼴이 된다. */
export interface ReportedCommentDTO {
	id: string;
	body: string;
	status: string;
	isHidden: boolean;
	reportCount: number;
	createdAt: string;
	author: { id: string; nickname: string };
	article: { id: string; title: string | null };
	reasons: Array<{ reason: ReportReason; count: number }>;
}

function toIso(sqliteDatetime: string): string {
	return `${sqliteDatetime.replace(" ", "T")}Z`;
}

export async function reportComment(
	db: D1Database,
	params: { commentId: string; reporterId: string; reason: ReportReason },
): Promise<{ ok: true; already: boolean } | { ok: false; error: string }> {
	const comment = await db
		.prepare("SELECT user_id, status FROM comments WHERE id = ?")
		.bind(params.commentId)
		.first<{ user_id: string; status: string }>();
	if (!comment) return { ok: false, error: "댓글을 찾을 수 없습니다" };
	if (comment.status === "deleted") return { ok: false, error: "이미 삭제된 댓글입니다" };
	if (comment.user_id === params.reporterId) {
		return { ok: false, error: "본인 댓글은 신고할 수 없습니다" };
	}

	// 복합 PK(comment_id, reporter_id) 덕분에 중복 신고는 DB가 막는다.
	const insert = await db
		.prepare(
			"INSERT OR IGNORE INTO comment_reports (comment_id, reporter_id, reason) VALUES (?, ?, ?)",
		)
		.bind(params.commentId, params.reporterId, params.reason)
		.run();
	if (insert.meta.changes === 0) return { ok: true, already: true };

	// 가입 1일 미만 계정은 임계값에서 제외한다. 이메일 인증이 없어 계정을 즉석에서 만들 수 있는데,
	// 이 한 줄이 "5분 전에 만든 계정 3개로 아무 댓글이나 묻기"와 "숙성된 계정 3개가 필요하다"의 차이다.
	// pending만 세므로 관리자가 한 번 기각하면 같은 신고들로 다시 가려지지 않는다.
	const countRow = await db
		.prepare(
			`SELECT COUNT(*) AS c FROM comment_reports r JOIN users u ON u.id = r.reporter_id
			 WHERE r.comment_id = ? AND r.status = 'pending' AND u.created_at < datetime('now', '-1 day')`,
		)
		.bind(params.commentId)
		.first<{ c: number }>();
	const count = countRow?.c ?? 0;

	if (count >= REPORT_HIDE_THRESHOLD) {
		await db
			.prepare(
				"UPDATE comments SET report_count = ?, hidden_at = COALESCE(hidden_at, datetime('now')) WHERE id = ?",
			)
			.bind(count, params.commentId)
			.run();
	} else {
		await db
			.prepare("UPDATE comments SET report_count = ? WHERE id = ?")
			.bind(count, params.commentId)
			.run();
	}

	// 가림은 댓글 수도 카르마도 건드리지 않는다. 신고 3건이라는 휴리스틱으로 이미 받은
	// 추천을 소급해 회수하면, 오탐 한 번에 되돌릴 수 없는 피해가 남는다.
	return { ok: true, already: false };
}

// ── 관리자 ────────────────────────────────────────────────────

export async function listReportedComments(
	db: D1Database,
	limit = 100,
): Promise<ReportedCommentDTO[]> {
	const { results } = await db
		.prepare(
			`SELECT c.id, c.body, c.status, c.hidden_at, c.report_count, c.created_at,
			        u.id AS author_id, u.nickname, a.id AS article_id, a.title AS article_title
			   FROM comments c
			   JOIN users u ON u.id = c.user_id
			   LEFT JOIN articles a ON a.id = c.article_id
			  WHERE EXISTS (SELECT 1 FROM comment_reports r WHERE r.comment_id = c.id AND r.status = 'pending')
			  ORDER BY c.report_count DESC, c.created_at DESC
			  LIMIT ?`,
		)
		.bind(limit)
		.all<{
			id: string;
			body: string;
			status: string;
			hidden_at: string | null;
			report_count: number;
			created_at: string;
			author_id: string;
			nickname: string;
			article_id: string | null;
			article_title: string | null;
		}>();
	if (results.length === 0) return [];

	const placeholders = results.map(() => "?").join(",");
	const { results: reasonRows } = await db
		.prepare(
			`SELECT comment_id, reason, COUNT(*) AS c FROM comment_reports
			  WHERE status = 'pending' AND comment_id IN (${placeholders})
			  GROUP BY comment_id, reason`,
		)
		.bind(...results.map((r) => r.id))
		.all<{ comment_id: string; reason: string; c: number }>();

	const reasonsByComment = new Map<string, Array<{ reason: ReportReason; count: number }>>();
	for (const row of reasonRows) {
		const list = reasonsByComment.get(row.comment_id) ?? [];
		list.push({ reason: row.reason as ReportReason, count: row.c });
		reasonsByComment.set(row.comment_id, list);
	}

	return results.map((r) => ({
		id: r.id,
		body: r.body,
		status: r.status,
		isHidden: r.hidden_at !== null,
		reportCount: r.report_count,
		createdAt: toIso(r.created_at),
		author: { id: r.author_id, nickname: r.nickname },
		article: { id: r.article_id ?? "", title: r.article_title },
		reasons: reasonsByComment.get(r.id) ?? [],
	}));
}

/** comment_reports의 status + resolved_by가 곧 감사 로그다(별도 모더레이션 테이블을 두지 않는 이유). */
export async function resolveReport(
	db: D1Database,
	params: { commentId: string; adminId: string; action: "dismiss" | "delete" },
): Promise<{ ok: true } | { ok: false; error: string }> {
	const comment = await db
		.prepare("SELECT id FROM comments WHERE id = ?")
		.bind(params.commentId)
		.first<{ id: string }>();
	if (!comment) return { ok: false, error: "댓글을 찾을 수 없습니다" };

	if (params.action === "dismiss") {
		await db.batch([
			// 가림 해제 + 카운터 초기화. 남은 신고는 dismissed가 되므로 같은 신고로 재차 가려지지 않는다.
			db
				.prepare("UPDATE comments SET hidden_at = NULL, report_count = 0 WHERE id = ?")
				.bind(params.commentId),
			db
				.prepare(
					`UPDATE comment_reports SET status = 'dismissed', resolved_at = datetime('now'), resolved_by = ?
					  WHERE comment_id = ? AND status = 'pending'`,
				)
				.bind(params.adminId, params.commentId),
		]);
		return { ok: true };
	}

	await db.batch([
		// 본인 삭제와 같은 소프트 삭제 경로를 쓴다(본문을 비우고 status만 바꾼다).
		db
			.prepare(
				"UPDATE comments SET status = 'deleted', body = '', deleted_at = datetime('now') WHERE id = ?",
			)
			.bind(params.commentId),
		db
			.prepare(
				`UPDATE comment_reports SET status = 'upheld', resolved_at = datetime('now'), resolved_by = ?
				  WHERE comment_id = ? AND status = 'pending'`,
			)
			.bind(params.adminId, params.commentId),
	]);
	return { ok: true };
}
