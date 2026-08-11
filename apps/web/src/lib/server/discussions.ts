/**
 * 토론: 유저가 직접 여는 글. 댓글(server/comments.ts)과 같은 표를 공유하므로 추천·신고·삭제·
 * 경험치 로직은 그대로 재사용된다.
 *
 * 왜 이 기능이 생겼나: 댓글을 이슈 단위로 묶어봤지만(0011) 대화의 단위로는 너무 넓었다.
 * 넓은 주제를 이야기하고 싶으면 사람이 직접 자리를 연다. 시스템은 "여러 매체가 함께 다룬
 * 사건"을 추천하는 데까지만 관여하고, 무엇을 이야기할지는 정하지 않는다.
 */

import { discussionScore } from "./comments";

export const DISCUSSION_TITLE_MAX = 120;
export const DISCUSSION_BODY_MAX = 4000;
/** 도배 방지. 댓글(5분 10건)보다 훨씬 빡빡하게 — 토론 글은 목록 전체를 차지한다. */
export const DISCUSSION_RATE_LIMIT = 3;
export const DISCUSSION_RATE_WINDOW_SECONDS = 60 * 60;

export interface DiscussionAuthor {
	id: string;
	nickname: string;
	exp: number;
}

export interface DiscussionListItem {
	id: string;
	title: string;
	author: DiscussionAuthor;
	/** 추천에서 시작했다면 그 이슈의 대표 기사 제목. 자유 주제면 null */
	issueId: string | null;
	issueTitle: string | null;
	comments: number;
	participants: number;
	score: number;
	createdAt: string;
	lastAt: string;
}

export interface DiscussionDetail extends DiscussionListItem {
	body: string;
	isOwner: boolean;
	viewerUpvoted: boolean;
	isHidden: boolean;
	status: "active" | "deleted";
}

function toIso(sqliteDatetime: string): string {
	return `${sqliteDatetime.replace(" ", "T")}Z`;
}

interface Row {
	id: string;
	user_id: string;
	nickname: string;
	exp: number;
	issue_id: string | null;
	issue_title: string | null;
	title: string;
	body: string;
	status: string;
	score: number;
	hidden_at: string | null;
	created_at: string;
	comments: number;
	participants: number;
	last_at: string | null;
}

/** 목록·상세가 공유하는 SELECT. 이슈 제목은 lead_article_id로 조인해 가져온다
 *  (issues에 title을 비정규화해두지 않은 이유는 0010 주석 참고). */
const SELECT_BASE = `
	SELECT d.id, d.user_id, u.nickname, u.exp, d.issue_id, a.title AS issue_title,
	       d.title, d.body, d.status, d.score, d.hidden_at, d.created_at,
	       (SELECT COUNT(*) FROM comments c
	         WHERE c.discussion_id = d.id AND c.status = 'active' AND c.hidden_at IS NULL) AS comments,
	       (SELECT COUNT(DISTINCT c.user_id) FROM comments c
	         WHERE c.discussion_id = d.id AND c.status = 'active' AND c.hidden_at IS NULL) AS participants,
	       (SELECT MAX(c.created_at) FROM comments c
	         WHERE c.discussion_id = d.id AND c.status = 'active') AS last_at
	FROM discussions d
	JOIN users u ON u.id = d.user_id
	LEFT JOIN issues i ON i.id = d.issue_id
	LEFT JOIN articles a ON a.id = i.lead_article_id`;

function toListItem(r: Row): DiscussionListItem {
	return {
		id: r.id,
		title: r.title,
		author: { id: r.user_id, nickname: r.nickname, exp: r.exp },
		issueId: r.issue_id,
		issueTitle: r.issue_title,
		comments: r.comments,
		participants: r.participants,
		score: r.score,
		createdAt: toIso(r.created_at),
		lastAt: toIso(r.last_at ?? r.created_at),
	};
}

/**
 * 토론 목록. 정렬은 하나뿐이다 — 추천순 탭을 따로 두면 "다수 의견이 상단을 독점"이 모자만
 * 바꿔 쓴 것이 된다. 가려진 글은 목록에서 뺀다(댓글과 달리 '펼쳐보기'로 확인할 맥락이 없다).
 */
export async function listDiscussions(db: D1Database, limit = 30): Promise<DiscussionListItem[]> {
	const { results } = await db
		.prepare(`${SELECT_BASE} WHERE d.status = 'active' AND d.hidden_at IS NULL LIMIT 200`)
		.all<Row>();

	const now = Date.now();
	return results
		.map(toListItem)
		.sort((a, b) => discussionScore(b, now) - discussionScore(a, now) || b.lastAt.localeCompare(a.lastAt))
		.slice(0, limit);
}

export async function getDiscussion(
	db: D1Database,
	id: string,
	viewerId: string | null,
): Promise<DiscussionDetail | null> {
	const row = await db.prepare(`${SELECT_BASE} WHERE d.id = ?`).bind(id).first<Row>();
	if (!row) return null;

	let viewerUpvoted = false;
	if (viewerId) {
		const v = await db
			.prepare(
				"SELECT 1 FROM votes WHERE user_id = ? AND target_type = 'discussion' AND target_id = ? AND value = 1",
			)
			.bind(viewerId, id)
			.first();
		viewerUpvoted = v !== null;
	}

	return {
		...toListItem(row),
		body: row.status === "deleted" ? "" : row.body,
		status: row.status as "active" | "deleted",
		isHidden: row.hidden_at !== null,
		isOwner: viewerId === row.user_id,
		viewerUpvoted,
	};
}

export async function createDiscussion(
	db: D1Database,
	params: { userId: string; title: string; body: string; issueId: string | null },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
	// 이슈 연결은 선택이지만, 붙일 거라면 실재해야 한다(없는 이슈를 가리키면 목록에서
	// 제목이 비어 보인다).
	if (params.issueId) {
		const issue = await db
			.prepare("SELECT 1 FROM issues WHERE id = ?")
			.bind(params.issueId)
			.first();
		if (!issue) return { ok: false, error: "연결하려는 이슈를 찾을 수 없습니다" };
	}

	const id = crypto.randomUUID();
	await db
		.prepare("INSERT INTO discussions (id, user_id, issue_id, title, body) VALUES (?, ?, ?, ?, ?)")
		.bind(id, params.userId, params.issueId, params.title, params.body)
		.run();
	return { ok: true, id };
}

/** 본인 글만 지운다. 댓글과 같은 소프트 삭제 — 답글이 달려 있으면 맥락이 끊기므로 행은 남긴다. */
export async function deleteDiscussion(
	db: D1Database,
	id: string,
	userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const row = await db
		.prepare("SELECT user_id FROM discussions WHERE id = ?")
		.bind(id)
		.first<{ user_id: string }>();
	if (!row) return { ok: false, error: "토론을 찾을 수 없습니다" };
	if (row.user_id !== userId) return { ok: false, error: "본인 글만 삭제할 수 있습니다" };

	await db
		.prepare(
			"UPDATE discussions SET status = 'deleted', deleted_at = datetime('now') WHERE id = ?",
		)
		.bind(id)
		.run();
	return { ok: true };
}

/**
 * 추천 토글. 댓글과 같은 규칙이다 — 비추천은 없고, 껐다 켰다로 농사가 되지 않게
 * 되돌릴 때 같은 양을 회수한다(경험치 처리는 호출부가 한다).
 */
export async function toggleDiscussionVote(
	db: D1Database,
	id: string,
	userId: string,
): Promise<{ ok: true; score: number; upvoted: boolean } | { ok: false; error: string }> {
	const row = await db
		.prepare("SELECT user_id, status FROM discussions WHERE id = ?")
		.bind(id)
		.first<{ user_id: string; status: string }>();
	if (!row || row.status !== "active") return { ok: false, error: "토론을 찾을 수 없습니다" };
	if (row.user_id === userId) return { ok: false, error: "자기 글에는 추천할 수 없습니다" };

	const existing = await db
		.prepare(
			"SELECT 1 FROM votes WHERE user_id = ? AND target_type = 'discussion' AND target_id = ?",
		)
		.bind(userId, id)
		.first();

	if (existing) {
		await db
			.prepare(
				"DELETE FROM votes WHERE user_id = ? AND target_type = 'discussion' AND target_id = ?",
			)
			.bind(userId, id)
			.run();
		await db
			.prepare("UPDATE discussions SET score = MAX(0, score - 1) WHERE id = ?")
			.bind(id)
			.run();
	} else {
		await db
			.prepare(
				"INSERT INTO votes (user_id, target_type, target_id, value) VALUES (?, 'discussion', ?, 1)",
			)
			.bind(userId, id)
			.run();
		await db.prepare("UPDATE discussions SET score = score + 1 WHERE id = ?").bind(id).run();
	}

	const after = await db
		.prepare("SELECT score FROM discussions WHERE id = ?")
		.bind(id)
		.first<{ score: number }>();
	return { ok: true, score: after?.score ?? 0, upvoted: !existing };
}

export interface SuggestedTopic {
	issueId: string;
	title: string;
	coverage: number;
	sourceNames: string[];
	articleId: string;
}

/**
 * "가장 많이 보도된 주제로 토론해보세요" 추천.
 *
 * 보도 매체 수가 많은 최근 이슈 중, **아직 토론이 열리지 않은 것**만 고른다 — 이미 자리가
 * 있는 주제를 또 열라고 권하면 같은 이야기가 두 곳으로 갈린다.
 */
export async function suggestTopics(db: D1Database, limit = 3): Promise<SuggestedTopic[]> {
	const { results } = await db
		.prepare(
			`SELECT i.id AS issue_id, i.source_count, a.id AS article_id, a.title
			 FROM issues i
			 JOIN articles a ON a.id = i.lead_article_id
			 WHERE i.source_count > 1
			   AND i.last_published_at >= datetime('now','-3 days')
			   AND NOT EXISTS (
			     SELECT 1 FROM discussions d WHERE d.issue_id = i.id AND d.status = 'active'
			   )
			 ORDER BY i.source_count DESC, i.last_published_at DESC
			 LIMIT ?`,
		)
		.bind(limit)
		.all<{ issue_id: string; source_count: number; article_id: string; title: string }>();
	if (results.length === 0) return [];

	// 매체 이름은 추천 카드에 "누가 다뤘는지"를 보여주려고 함께 가져온다.
	const placeholders = results.map(() => "?").join(",");
	const { results: names } = await db
		.prepare(
			`SELECT issue_id, source_name FROM articles
			 WHERE issue_id IN (${placeholders}) GROUP BY issue_id, source_name`,
		)
		.bind(...results.map((r) => r.issue_id))
		.all<{ issue_id: string; source_name: string }>();

	const byIssue = new Map<string, string[]>();
	for (const n of names) {
		const list = byIssue.get(n.issue_id);
		if (list) list.push(n.source_name);
		else byIssue.set(n.issue_id, [n.source_name]);
	}

	return results.map((r) => ({
		issueId: r.issue_id,
		title: r.title,
		coverage: r.source_count,
		sourceNames: byIssue.get(r.issue_id) ?? [],
		articleId: r.article_id,
	}));
}
