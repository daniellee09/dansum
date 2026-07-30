/**
 * 세션 토큰 유틸. Workers 런타임 내장 Web Crypto만 사용(npm 의존성 없음).
 *
 * 비밀번호 해싱(PBKDF2)은 제거했다 — 인증은 구글 OAuth만 쓴다.
 * Workers 무료 플랜은 요청당 CPU 10ms인데 OWASP 권장치(PBKDF2-SHA256 210,000회)는
 * 그 두 배 가까이 걸려서, 운영에서 회원가입이 항상 빈 500으로 죽었다.
 * 반복 횟수를 한도에 맞게 낮추면 해시 강도가 권장치의 5% 아래로 떨어져 그것대로 위험해,
 * 비밀번호를 아예 저장하지 않는 쪽을 택했다(users.password_hash는 계속 NULL).
 */

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
