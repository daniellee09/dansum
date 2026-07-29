/**
 * 계정 인증용 암호 유틸. Workers 런타임 내장 Web Crypto만 사용(bcrypt/argon2 등 npm 의존성 없음).
 */

const PBKDF2_ITERATIONS = 210_000;

function toBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(b64url: string): Uint8Array {
	const b64 = b64url
		.replace(/-/g, "+")
		.replace(/_/g, "/")
		.padEnd(Math.ceil(b64url.length / 4) * 4, "=");
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(password),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
		keyMaterial,
		256,
	);
	return new Uint8Array(bits);
}

/** 저장 포맷: pbkdf2$<iterations>$<salt_b64url>$<hash_b64url> — 알고리즘 교체 여지를 남겨둔다 */
export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
	return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const parts = stored.split("$");
	if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
	const iterations = Number(parts[1]);
	if (!Number.isFinite(iterations) || iterations <= 0) return false;
	const salt = fromBase64Url(parts[2]);
	const expected = fromBase64Url(parts[3]);
	const actual = await pbkdf2(password, salt, iterations);
	if (actual.length !== expected.length) return false;
	// 타이밍 공격 방지를 위한 상수 시간 비교
	let diff = 0;
	for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
	return diff === 0;
}

/** 브라우저 쿠키로 내려줄 원문 세션 토큰(32바이트 랜덤) */
export function generateSessionToken(): string {
	return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** DB엔 원문 토큰 대신 이 해시만 저장한다 */
export async function hashToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}
