/**
 * 경험치 적립 + 마일스톤 배지. 레벨·등급 계산은 packages/shared의 순수 함수가 맡는다.
 *
 * 설계 원칙: **추천받기에 가장 큰 비중을 둔다.** 남이 가치 있다고 봐줘야만 크게 오르므로
 * 아무 말이나 많이 써서 레벨을 올릴 수 없다. 작성/출석은 참여를 유도하는 최소한의 양념이고,
 * 도배 방지를 위해 작성은 하루 EXP_DAILY_COMMENT_LIMIT건까지만 인정한다.
 *
 * 저장 위치: users.exp(캐시) + exp_events(append-only 원장).
 * 0009 이전의 users.karma / karma_events는 더 이상 쓰지 않는다.
 */

import { EXP_DAILY_COMMENT_LIMIT, EXP_REWARDS, getLevel } from "@dansum/shared";

export interface BadgeDTO {
	code: string;
	name: string;
	description: string | null;
	icon: string | null;
	awardedAt: string;
}

export interface RankingEntry {
	id: string;
	nickname: string;
	exp: number;
}

export type ExpReason = "comment_upvoted" | "comment_created" | "reply_received" | "attendance";

function toIso(sqliteDatetime: string): string {
	return `${sqliteDatetime.replace(" ", "T")}Z`;
}

/** 레벨 임계값으로 마일스톤 배지를 확인해 부여한다.
 *  이미 받은 배지는 PK(user_id, badge_id) 충돌로 무시되므로 매번 전체를 확인해도 안전하다. */
export async function checkAndAwardBadges(db: D1Database, userId: string): Promise<void> {
	const user = await db
		.prepare("SELECT exp FROM users WHERE id = ?")
		.bind(userId)
		.first<{ exp: number }>();
	if (!user) return;

	const level = getLevel(user.exp);
	const commentCountRow = await db
		.prepare("SELECT COUNT(*) as c FROM comments WHERE user_id = ? AND status = 'active'")
		.bind(userId)
		.first<{ c: number }>();

	const eligibleCodes: string[] = [];
	if ((commentCountRow?.c ?? 0) >= 1) eligibleCodes.push("first_comment");
	if (level >= 5) eligibleCodes.push("level_5");
	if (level >= 15) eligibleCodes.push("level_15");
	if (level >= 30) eligibleCodes.push("level_30");
	if (level >= 45) eligibleCodes.push("level_45");
	if (eligibleCodes.length === 0) return;

	const placeholders = eligibleCodes.map(() => "?").join(",");
	const { results: badgeRows } = await db
		.prepare(`SELECT id FROM badges WHERE code IN (${placeholders})`)
		.bind(...eligibleCodes)
		.all<{ id: string }>();
	if (badgeRows.length === 0) return;

	await db.batch(
		badgeRows.map((b) =>
			db
				.prepare("INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES (?, ?)")
				.bind(userId, b.id),
		),
	);
}

/** delta만큼 경험치를 더하고(음수면 차감) 원장에 남긴 뒤 배지를 재확인한다. */
export async function awardExp(
	db: D1Database,
	userId: string,
	delta: number,
	reason: ExpReason | "legacy_karma",
	refType?: string,
	refId?: string,
): Promise<void> {
	if (delta === 0) return;
	await db
		.prepare(
			"INSERT INTO exp_events (id, user_id, delta, reason, ref_type, ref_id) VALUES (?, ?, ?, ?, ?, ?)",
		)
		.bind(crypto.randomUUID(), userId, delta, reason, refType ?? null, refId ?? null)
		.run();
	// 경험치는 음수로 내려가지 않는다(추천 취소로 0 밑으로 떨어지면 레벨 계산이 이상해진다).
	await db.prepare("UPDATE users SET exp = MAX(0, exp + ?) WHERE id = ?").bind(delta, userId).run();
	await checkAndAwardBadges(db, userId);
}

/** 댓글 작성 보상. 하루 상한을 넘으면 조용히 건너뛴다(작성 자체는 막지 않는다). */
export async function awardCommentCreated(
	db: D1Database,
	userId: string,
	commentId: string,
): Promise<void> {
	const row = await db
		.prepare(
			`SELECT COUNT(*) AS c FROM exp_events
			  WHERE user_id = ? AND reason = 'comment_created' AND date(created_at) = date('now')`,
		)
		.bind(userId)
		.first<{ c: number }>();
	if ((row?.c ?? 0) >= EXP_DAILY_COMMENT_LIMIT) return;
	await awardExp(db, userId, EXP_REWARDS.commentCreated, "comment_created", "comment", commentId);
}

/**
 * 하루 첫 방문 보상. exp_events의 부분 UNIQUE 인덱스가 '하루 한 번'을 DB에서 보장하므로,
 * 동시 요청이 겹쳐도 두 번 적립되지 않는다(두 번째는 제약 위반으로 던지고 여기서 삼킨다).
 * KV 캐시만으로 막으면 캐시가 비었을 때 중복 적립된다.
 */
export async function awardAttendance(db: D1Database, userId: string): Promise<boolean> {
	try {
		await db
			.prepare("INSERT INTO exp_events (id, user_id, delta, reason) VALUES (?, ?, ?, 'attendance')")
			.bind(crypto.randomUUID(), userId, EXP_REWARDS.attendance)
			.run();
	} catch {
		return false; // 오늘 이미 받음
	}
	await db
		.prepare("UPDATE users SET exp = MAX(0, exp + ?) WHERE id = ?")
		.bind(EXP_REWARDS.attendance, userId)
		.run();
	await checkAndAwardBadges(db, userId);
	return true;
}

export async function getUserBadges(db: D1Database, userId: string): Promise<BadgeDTO[]> {
	const { results } = await db
		.prepare(
			`SELECT b.code, b.name, b.description, b.icon, ub.awarded_at
			 FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
			 WHERE ub.user_id = ? ORDER BY ub.awarded_at ASC`,
		)
		.bind(userId)
		.all<{
			code: string;
			name: string;
			description: string | null;
			icon: string | null;
			awarded_at: string;
		}>();
	return results.map((r) => ({
		code: r.code,
		name: r.name,
		description: r.description,
		icon: r.icon,
		awardedAt: toIso(r.awarded_at),
	}));
}

export async function getRanking(db: D1Database, limit = 50): Promise<RankingEntry[]> {
	const { results } = await db
		.prepare(
			"SELECT id, nickname, exp FROM users WHERE exp > 0 ORDER BY exp DESC, created_at ASC LIMIT ?",
		)
		.bind(limit)
		.all<RankingEntry>();
	return results;
}
