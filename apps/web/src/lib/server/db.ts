import type { AuthUser } from "@dansum/shared";
import { generateSessionToken, hashToken } from "@dansum/shared";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30일
const SESSION_CACHE_TTL_SECONDS = 300; // KV 캐시(D1 원장은 항상 최신, 이건 조회 부하만 줄임)
const RECENTLY_VIEWED_MAX = 20;

/** AuthUser의 모양이 바뀌면 이 접두사를 올린다. 안 올리면 배포 직후 TTL(300초) 동안
 *  옛 모양이 캐시에서 그대로 나온다 — role을 추가했을 때 관리자가 자기 화면에서 잠기는 식이다.
 *  조회와 삭제(revokeSession) 두 곳이 반드시 같은 키를 써야 해서 상수로 묶었다.
 *  한쪽만 바꾸면 로그아웃이 엉뚱한 키를 지워 세션이 최대 300초 더 살아있게 된다. */
const SESSION_CACHE_PREFIX = "session:v2:";

interface UserRow {
	id: string;
	email: string;
	password_hash: string | null;
	nickname: string;
	avatar_url: string | null;
	status: string;
	role: string;
	/** 0009 이후로는 exp를 쓴다. karma는 남아만 있는 옛 컬럼(정리는 다음 마이그레이션에서). */
	karma: number;
	exp: number;
	nickname_changed_at: string | null;
	created_at: string;
}

export function toAuthUser(row: UserRow): AuthUser {
	return {
		id: row.id,
		email: row.email,
		nickname: row.nickname,
		avatarUrl: row.avatar_url,
		// role은 자유 문자열 컬럼이라 방어적으로 정규화한다(예상 밖 값이면 일반 유저로 처리).
		role: row.role === "admin" ? "admin" : "user",
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
/** 가입 직후에는 쿨다운을 적용하지 않는다. 소셜 로그인은 구글 이름을 임의로 배정하므로
 *  첫 작명(/welcome)과 그 직후의 오타 수정까지는 자유로워야 한다 — 여기서 30일을 걸어버리면
 *  가입하자마자 한 달을 묶이게 된다. 계정 나이로 판단하므로 별도 플래그 컬럼이 필요 없다. */
const NICKNAME_GRACE_MS = 24 * 60 * 60 * 1000; // 24시간

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

	const accountAge = Date.now() - parseSqliteUtc(current.created_at).getTime();
	const inGracePeriod = accountAge < NICKNAME_GRACE_MS;
	if (current.nickname_changed_at && !inGracePeriod) {
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

/** 소셜 전용 계정이라 password_hash는 NULL로 둔다(0005에서 이미 nullable로 잡아뒀다). */
export async function createUser(
	db: D1Database,
	params: { email: string; nickname: string; avatarUrl?: string | null },
): Promise<AuthUser> {
	const id = crypto.randomUUID();
	await db
		.prepare("INSERT INTO users (id, email, nickname, avatar_url) VALUES (?, ?, ?, ?)")
		.bind(id, params.email.toLowerCase(), params.nickname, params.avatarUrl ?? null)
		.run();
	const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
	if (!row) throw new Error("Failed to create user");
	return toAuthUser(row);
}

// ── 소셜 로그인 ───────────────────────────────────────────────

/** 구글 이름을 닉네임 규칙(2~20자, UNIQUE)에 맞춘다.
 *  이름이 없거나 너무 짧으면 이메일 아이디를 쓰고, 그것도 안 되면 "회원"으로 떨어뜨린다.
 *  사용자는 가입 후 마이페이지에서 언제든 바꿀 수 있으므로 여기선 '충돌 없이 만들기'만 신경 쓴다. */
function toNicknameBase(name: string | null, email: string): string {
	const fromName = (name ?? "").trim().slice(0, 20);
	if (fromName.length >= 2) return fromName;
	const fromEmail = email.split("@")[0]?.replace(/[^\w가-힣]/g, "").slice(0, 20) ?? "";
	if (fromEmail.length >= 2) return fromEmail;
	return "회원";
}

/** 닉네임이 UNIQUE라 충돌하면 뒤에 숫자를 붙여 빈자리를 찾는다.
 *  20자를 넘지 않도록 접미사 길이만큼 잘라낸다. */
async function findAvailableNickname(db: D1Database, base: string): Promise<string> {
	if (!(await nicknameExists(db, base))) return base;
	for (let i = 2; i < 1000; i++) {
		const suffix = String(i);
		const candidate = `${base.slice(0, 20 - suffix.length)}${suffix}`;
		if (!(await nicknameExists(db, candidate))) return candidate;
	}
	// 사실상 도달하지 않지만, 무한 루프 대신 확실히 유일한 값으로 끝낸다
	return `회원${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * 소셜 계정으로 로그인시킬 유저를 찾거나 만든다.
 *
 * 1) 이미 연동된 소셜 계정이면 그 유저
 * 2) 같은 이메일의 기존 유저가 있으면 연동만 추가 — 단 **구글이 이메일을 검증한 경우에만.**
 *    미검증 이메일로 연동을 허용하면 남의 이메일을 주장해 계정을 탈취할 수 있다.
 * 3) 없으면 새로 만든다
 */
export async function findOrCreateOAuthUser(
	db: D1Database,
	params: {
		provider: string;
		providerAccountId: string;
		email: string;
		emailVerified: boolean;
		name: string | null;
		avatarUrl: string | null;
	},
): Promise<{ ok: true; user: AuthUser; isNew: boolean } | { ok: false; error: string }> {
	const linked = await db
		.prepare(
			`SELECT u.* FROM oauth_accounts oa JOIN users u ON u.id = oa.user_id
			 WHERE oa.provider = ? AND oa.provider_account_id = ?`,
		)
		.bind(params.provider, params.providerAccountId)
		.first<UserRow>();
	if (linked) {
		if (linked.status !== "active") return { ok: false, error: "사용할 수 없는 계정입니다" };
		return { ok: true, user: toAuthUser(linked), isNew: false };
	}

	const existing = await findUserByEmail(db, params.email);
	if (existing) {
		if (!params.emailVerified) {
			return { ok: false, error: "이메일이 확인되지 않은 구글 계정입니다" };
		}
		if (existing.status !== "active") return { ok: false, error: "사용할 수 없는 계정입니다" };
		await db
			.prepare(
				"INSERT OR IGNORE INTO oauth_accounts (id, user_id, provider, provider_account_id) VALUES (?, ?, ?, ?)",
			)
			.bind(crypto.randomUUID(), existing.id, params.provider, params.providerAccountId)
			.run();
		// 기존 계정에 연동만 붙인 경우라 이미 자기 이름이 있다 — 작명 화면을 띄우지 않는다.
		return { ok: true, user: toAuthUser(existing), isNew: false };
	}

	const nickname = await findAvailableNickname(db, toNicknameBase(params.name, params.email));
	const user = await createUser(db, {
		email: params.email,
		nickname,
		avatarUrl: params.avatarUrl,
	});
	await db
		.prepare(
			"INSERT INTO oauth_accounts (id, user_id, provider, provider_account_id) VALUES (?, ?, ?, ?)",
		)
		.bind(crypto.randomUUID(), user.id, params.provider, params.providerAccountId)
		.run();
	// 닉네임을 구글 이름으로 임의 배정한 상태 — 콜백이 이 값을 보고 작명 화면으로 보낸다.
	return { ok: true, user, isNew: true };
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
	const cacheKey = `${SESSION_CACHE_PREFIX}${tokenHash}`;

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

/** 프로필(닉네임 등)을 바꾼 뒤 반드시 부른다.
 *  세션은 KV에 SESSION_CACHE_TTL_SECONDS만큼 캐시되므로, 지우지 않으면 헤더·댓글에
 *  최대 5분간 옛 닉네임이 그대로 보인다(D1은 이미 새 값인데 화면만 안 바뀐다). */
export async function invalidateSessionCache(kv: KVNamespace, token: string): Promise<void> {
	await kv.delete(`${SESSION_CACHE_PREFIX}${await hashToken(token)}`);
}

export async function revokeSession(db: D1Database, kv: KVNamespace, token: string): Promise<void> {
	const tokenHash = await hashToken(token);
	await db
		.prepare("UPDATE sessions SET revoked_at = datetime('now') WHERE token_hash = ?")
		.bind(tokenHash)
		.run();
	await kv.delete(`${SESSION_CACHE_PREFIX}${tokenHash}`);
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
