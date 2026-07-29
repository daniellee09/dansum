import type { AuthUser } from "@dansum/shared";
import { generateSessionToken, hashToken } from "@dansum/shared";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30일
const SESSION_CACHE_TTL_SECONDS = 300; // KV 캐시(D1 원장은 항상 최신, 이건 조회 부하만 줄임)
const RECENTLY_VIEWED_MAX = 20;

interface UserRow {
	id: string;
	email: string;
	password_hash: string | null;
	nickname: string;
	avatar_url: string | null;
	status: string;
	karma: number;
	nickname_changed_at: string | null;
	created_at: string;
}

export function toAuthUser(row: UserRow): AuthUser {
	return {
		id: row.id,
		email: row.email,
		nickname: row.nickname,
		avatarUrl: row.avatar_url,
		// SQLite datetime('now')는 "YYYY-MM-DD HH:MM:SS"(UTC, 표기 없음) — 표준 ISO로 정규화
		createdAt: `${row.created_at.replace(" ", "T")}Z`,
	};
}

// ── 회원가입/조회 ──────────────────────────────────────────────

export async function findUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
	return db
		.prepare("SELECT * FROM users WHERE email = ?")
		.bind(email.toLowerCase())
		.first<UserRow>();
}

export async function nicknameExists(db: D1Database, nickname: string): Promise<boolean> {
	const row = await db.prepare("SELECT 1 FROM users WHERE nickname = ?").bind(nickname).first();
	return row !== null;
}

export async function findUserById(db: D1Database, id: string): Promise<UserRow | null> {
	return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
}

const NICKNAME_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30일

/** SQLite datetime('now')는 "YYYY-MM-DD HH:MM:SS"(UTC, 타임존 표기 없음)를 반환한다 */
function parseSqliteUtc(value: string): Date {
	return new Date(`${value.replace(" ", "T")}Z`);
}

export async function updateNickname(
	db: D1Database,
	userId: string,
	nickname: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const current = await findUserById(db, userId);
	if (!current) return { ok: false, error: "사용자를 찾을 수 없습니다" };
	if (current.nickname === nickname) return { ok: true };

	if (current.nickname_changed_at) {
		const elapsed = Date.now() - parseSqliteUtc(current.nickname_changed_at).getTime();
		if (elapsed < NICKNAME_COOLDOWN_MS) {
			const daysLeft = Math.ceil((NICKNAME_COOLDOWN_MS - elapsed) / (24 * 60 * 60 * 1000));
			return { ok: false, error: `닉네임은 ${daysLeft}일 후에 다시 변경할 수 있습니다` };
		}
	}

	if (await nicknameExists(db, nickname)) {
		return { ok: false, error: "이미 사용 중인 닉네임입니다" };
	}

	await db
		.prepare(
			"UPDATE users SET nickname = ?, nickname_changed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
		)
		.bind(nickname, userId)
		.run();
	return { ok: true };
}

export async function getSourceNames(
	db: D1Database,
	ids: string[],
): Promise<Record<string, string>> {
	if (ids.length === 0) return {};
	const placeholders = ids.map(() => "?").join(",");
	const { results } = await db
		.prepare(`SELECT id, name FROM sources WHERE id IN (${placeholders})`)
		.bind(...ids)
		.all<{ id: string; name: string }>();
	const map: Record<string, string> = {};
	for (const r of results) map[r.id] = r.name;
	return map;
}

export async function createUser(
	db: D1Database,
	params: { email: string; passwordHash: string; nickname: string },
): Promise<AuthUser> {
	const id = crypto.randomUUID();
	await db
		.prepare(
			"INSERT INTO users (id, email, password_hash, nickname) VALUES (?, ?, ?, ?)",
		)
		.bind(id, params.email.toLowerCase(), params.passwordHash, params.nickname)
		.run();
	const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
	if (!row) throw new Error("Failed to create user");
	return toAuthUser(row);
}

// ── 세션 ──────────────────────────────────────────────────────

export async function createSession(
	db: D1Database,
	userId: string,
	userAgent: string | null,
): Promise<{ token: string; expiresAt: Date }> {
	const token = generateSessionToken();
	const tokenHash = await hashToken(token);
	const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
	await db
		.prepare(
			"INSERT INTO sessions (id, user_id, token_hash, user_agent, expires_at) VALUES (?, ?, ?, ?, ?)",
		)
		.bind(crypto.randomUUID(), userId, tokenHash, userAgent, expiresAt.toISOString())
		.run();
	return { token, expiresAt };
}

/** 세션 토큰을 검증해 로그인된 유저를 반환한다. 만료/무효화/정지 계정이면 null. */
export async function validateSessionToken(
	db: D1Database,
	kv: KVNamespace,
	token: string,
): Promise<AuthUser | null> {
	const tokenHash = await hashToken(token);
	const cacheKey = `session:${tokenHash}`;

	const cached = await kv.get(cacheKey);
	if (cached === "invalid") return null;
	if (cached) {
		try {
			return JSON.parse(cached) as AuthUser;
		} catch {
			// 캐시 손상 시 무시하고 D1로 폴백
		}
	}

	const row = await db
		.prepare(
			`SELECT u.* FROM sessions s
			 JOIN users u ON u.id = s.user_id
			 WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > datetime('now')`,
		)
		.bind(tokenHash)
		.first<UserRow>();

	if (!row || row.status !== "active") {
		await kv.put(cacheKey, "invalid", { expirationTtl: SESSION_CACHE_TTL_SECONDS });
		return null;
	}

	const user = toAuthUser(row);
	await kv.put(cacheKey, JSON.stringify(user), { expirationTtl: SESSION_CACHE_TTL_SECONDS });
	return user;
}

export async function revokeSession(db: D1Database, kv: KVNamespace, token: string): Promise<void> {
	const tokenHash = await hashToken(token);
	await db
		.prepare("UPDATE sessions SET revoked_at = datetime('now') WHERE token_hash = ?")
		.bind(tokenHash)
		.run();
	await kv.delete(`session:${tokenHash}`);
}

// ── 북마크 ────────────────────────────────────────────────────

export async function listBookmarkIds(db: D1Database, userId: string): Promise<string[]> {
	const { results } = await db
		.prepare("SELECT article_id FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC")
		.bind(userId)
		.all<{ article_id: string }>();
	return results.map((r) => r.article_id);
}

export async function addBookmark(db: D1Database, userId: string, articleId: string): Promise<void> {
	await db
		.prepare("INSERT OR IGNORE INTO bookmarks (user_id, article_id) VALUES (?, ?)")
		.bind(userId, articleId)
		.run();
}

export async function removeBookmark(db: D1Database, userId: string, articleId: string): Promise<void> {
	await db
		.prepare("DELETE FROM bookmarks WHERE user_id = ? AND article_id = ?")
		.bind(userId, articleId)
		.run();
}

// ── 팔로우 ────────────────────────────────────────────────────

export async function listFollows(
	db: D1Database,
	userId: string,
): Promise<{ sources: string[]; categories: string[] }> {
	const { results } = await db
		.prepare("SELECT target_type, target_value FROM follows WHERE user_id = ?")
		.bind(userId)
		.all<{ target_type: string; target_value: string }>();
	const sources: string[] = [];
	const categories: string[] = [];
	for (const r of results) {
		if (r.target_type === "source") sources.push(r.target_value);
		else if (r.target_type === "category") categories.push(r.target_value);
	}
	return { sources, categories };
}

export async function addFollow(
	db: D1Database,
	userId: string,
	type: "source" | "category",
	value: string,
): Promise<void> {
	await db
		.prepare(
			"INSERT OR IGNORE INTO follows (user_id, target_type, target_value) VALUES (?, ?, ?)",
		)
		.bind(userId, type, value)
		.run();
}

export async function removeFollow(
	db: D1Database,
	userId: string,
	type: "source" | "category",
	value: string,
): Promise<void> {
	await db
		.prepare(
			"DELETE FROM follows WHERE user_id = ? AND target_type = ? AND target_value = ?",
		)
		.bind(userId, type, value)
		.run();
}

// ── 최근 본 기사 ──────────────────────────────────────────────

export async function listRecentlyViewedIds(
	db: D1Database,
	userId: string,
	limit = RECENTLY_VIEWED_MAX,
): Promise<string[]> {
	const { results } = await db
		.prepare("SELECT article_id FROM recently_viewed WHERE user_id = ? ORDER BY viewed_at DESC LIMIT ?")
		.bind(userId, limit)
		.all<{ article_id: string }>();
	return results.map((r) => r.article_id);
}

export async function addRecentlyViewed(db: D1Database, userId: string, articleId: string): Promise<void> {
	await db
		.prepare(
			`INSERT INTO recently_viewed (user_id, article_id, viewed_at) VALUES (?, ?, datetime('now'))
			 ON CONFLICT(user_id, article_id) DO UPDATE SET viewed_at = excluded.viewed_at`,
		)
		.bind(userId, articleId)
		.run();
	// MAX_ITEMS를 넘는 오래된 항목 정리
	await db
		.prepare(
			`DELETE FROM recently_viewed WHERE user_id = ? AND article_id NOT IN (
				SELECT article_id FROM recently_viewed WHERE user_id = ? ORDER BY viewed_at DESC LIMIT ?
			)`,
		)
		.bind(userId, userId, RECENTLY_VIEWED_MAX)
		.run();
}

// ── 로그인 직후 localStorage → 계정 이관 ─────────────────────

export async function migrateLocalData(
	db: D1Database,
	userId: string,
	data: {
		bookmarks?: string[];
		followSources?: string[];
		followCategories?: string[];
		recentlyViewed?: string[];
	},
): Promise<void> {
	const statements = [
		...(data.bookmarks ?? []).map((articleId) =>
			db
				.prepare("INSERT OR IGNORE INTO bookmarks (user_id, article_id) VALUES (?, ?)")
				.bind(userId, articleId),
		),
		...(data.followSources ?? []).map((value) =>
			db
				.prepare(
					"INSERT OR IGNORE INTO follows (user_id, target_type, target_value) VALUES (?, 'source', ?)",
				)
				.bind(userId, value),
		),
		...(data.followCategories ?? []).map((value) =>
			db
				.prepare(
					"INSERT OR IGNORE INTO follows (user_id, target_type, target_value) VALUES (?, 'category', ?)",
				)
				.bind(userId, value),
		),
		...(data.recentlyViewed ?? []).map((articleId) =>
			db
				.prepare(
					"INSERT OR IGNORE INTO recently_viewed (user_id, article_id) VALUES (?, ?)",
				)
				.bind(userId, articleId),
		),
	];
	if (statements.length === 0) return;
	await db.batch(statements);
}
