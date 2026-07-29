/** 카르마 적립(댓글 추천/비추천에서만 발생) + 마일스톤 배지. 등급은 packages/shared의 순수 함수. */

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
	karma: number;
}

function toIso(sqliteDatetime: string): string {
	return `${sqliteDatetime.replace(" ", "T")}Z`;
}

/** 카르마 임계값(뉴비 제외 — 가입만 해도 받는 배지는 의미가 없다) + 댓글 작성 여부로 마일스톤 배지를 확인해 부여한다.
 *  이미 받은 배지는 PK(user_id, badge_id) 충돌로 자동 무시되므로 매번 전체를 다시 확인해도 안전하다. */
export async function checkAndAwardBadges(db: D1Database, userId: string): Promise<void> {
	const user = await db.prepare("SELECT karma FROM users WHERE id = ?").bind(userId).first<{ karma: number }>();
	if (!user) return;

	const commentCountRow = await db
		.prepare("SELECT COUNT(*) as c FROM comments WHERE user_id = ? AND status = 'active'")
		.bind(userId)
		.first<{ c: number }>();
	const commentCount = commentCountRow?.c ?? 0;

	const eligibleCodes: string[] = [];
	if (commentCount >= 1) eligibleCodes.push("first_comment");
	if (user.karma >= 10) eligibleCodes.push("karma_10");
	if (user.karma >= 50) eligibleCodes.push("karma_50");
	if (user.karma >= 100) eligibleCodes.push("karma_100");
	if (eligibleCodes.length === 0) return;

	const placeholders = eligibleCodes.map(() => "?").join(",");
	const { results: badgeRows } = await db
		.prepare(`SELECT id FROM badges WHERE code IN (${placeholders})`)
		.bind(...eligibleCodes)
		.all<{ id: string }>();
	if (badgeRows.length === 0) return;

	await db.batch(
		badgeRows.map((b) =>
			db.prepare("INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES (?, ?)").bind(userId, b.id),
		),
	);
}

/** delta만큼 카르마를 더하고(음수면 차감) 이벤트를 기록한 뒤 배지를 재확인한다. delta=0이면 아무 것도 하지 않는다. */
export async function awardKarma(
	db: D1Database,
	userId: string,
	delta: number,
	reason: string,
	refType?: string,
	refId?: string,
): Promise<void> {
	if (delta === 0) return;
	await db
		.prepare("INSERT INTO karma_events (id, user_id, delta, reason, ref_type, ref_id) VALUES (?, ?, ?, ?, ?, ?)")
		.bind(crypto.randomUUID(), userId, delta, reason, refType ?? null, refId ?? null)
		.run();
	await db.prepare("UPDATE users SET karma = karma + ? WHERE id = ?").bind(delta, userId).run();
	await checkAndAwardBadges(db, userId);
}

export async function getUserBadges(db: D1Database, userId: string): Promise<BadgeDTO[]> {
	const { results } = await db
		.prepare(
			`SELECT b.code, b.name, b.description, b.icon, ub.awarded_at
			 FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
			 WHERE ub.user_id = ? ORDER BY ub.awarded_at ASC`,
		)
		.bind(userId)
		.all<{ code: string; name: string; description: string | null; icon: string | null; awarded_at: string }>();
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
		.prepare("SELECT id, nickname, karma FROM users WHERE karma > 0 ORDER BY karma DESC, created_at ASC LIMIT ?")
		.bind(limit)
		.all<RankingEntry>();
	return results;
}
