/**
 * 구글 OAuth 2.0 로그인. 비밀번호 인증은 폐기했다 —
 * Workers 무료 플랜 CPU 한도(요청당 10ms)에서 안전한 반복 횟수의 PBKDF2를 돌릴 수 없어
 * 운영에서 가입이 항상 500으로 죽었다(210,000회 ≈ 17ms). 자세한 건 RUNBOOK 참고.
 *
 * 흐름: /api/auth/google → 구글 동의 화면 → /api/auth/google/callback
 * state는 CSRF 방어용이며 KV 대신 짧은 httpOnly 쿠키에 담는다(왕복 한 번을 아낀다).
 */

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export const OAUTH_STATE_COOKIE = "dansum_oauth_state";
/** 동의 화면에서 머무는 시간까지 감안한 여유. 길게 두면 CSRF 창이 넓어지므로 10분으로 제한. */
export const OAUTH_STATE_TTL_SECONDS = 600;

export interface GoogleProfile {
	sub: string;
	email: string;
	emailVerified: boolean;
	name: string | null;
	picture: string | null;
}

/** state와 로그인 후 돌아갈 경로를 한 쿠키에 담는다(구글은 state를 그대로 되돌려준다). */
export function buildStatePayload(redirect: string): string {
	const nonce = crypto.randomUUID().replace(/-/g, "");
	return `${nonce}:${redirect}`;
}

export function parseStatePayload(payload: string): { nonce: string; redirect: string } | null {
	const idx = payload.indexOf(":");
	if (idx <= 0) return null;
	return { nonce: payload.slice(0, idx), redirect: payload.slice(idx + 1) };
}

/** 오픈 리다이렉트 방지: 우리 사이트 안의 절대경로만 허용한다.
 *  "//evil.com"이나 "https://evil.com"은 전부 "/"로 떨어뜨린다. */
export function safeRedirect(target: string | null | undefined): string {
	if (!target) return "/";
	if (!target.startsWith("/") || target.startsWith("//")) return "/";
	return target;
}

export function buildAuthorizeUrl(params: {
	clientId: string;
	redirectUri: string;
	state: string;
}): string {
	const url = new URL(GOOGLE_AUTH_URL);
	url.searchParams.set("client_id", params.clientId);
	url.searchParams.set("redirect_uri", params.redirectUri);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("scope", "openid email profile");
	url.searchParams.set("state", params.state);
	// 계정 선택을 매번 띄운다(여러 구글 계정을 쓰는 사용자가 원치 않는 계정으로 묶이는 걸 막는다)
	url.searchParams.set("prompt", "select_account");
	return url.toString();
}

export async function exchangeCodeForProfile(params: {
	code: string;
	clientId: string;
	clientSecret: string;
	redirectUri: string;
}): Promise<{ ok: true; profile: GoogleProfile } | { ok: false; error: string }> {
	const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			code: params.code,
			client_id: params.clientId,
			client_secret: params.clientSecret,
			redirect_uri: params.redirectUri,
			grant_type: "authorization_code",
		}),
	});
	if (!tokenRes.ok) {
		return { ok: false, error: "구글 인증에 실패했습니다" };
	}
	const token = (await tokenRes.json()) as { access_token?: string };
	if (!token.access_token) return { ok: false, error: "구글 인증에 실패했습니다" };

	const userRes = await fetch(GOOGLE_USERINFO_URL, {
		headers: { Authorization: `Bearer ${token.access_token}` },
	});
	if (!userRes.ok) return { ok: false, error: "구글 프로필을 가져오지 못했습니다" };

	const profile = (await userRes.json()) as {
		sub?: string;
		email?: string;
		email_verified?: boolean;
		name?: string;
		picture?: string;
	};
	if (!profile.sub || !profile.email) {
		return { ok: false, error: "구글 계정에서 이메일을 가져오지 못했습니다" };
	}

	return {
		ok: true,
		profile: {
			sub: profile.sub,
			email: profile.email.toLowerCase(),
			emailVerified: profile.email_verified === true,
			name: profile.name ?? null,
			picture: profile.picture ?? null,
		},
	};
}
