import type { APIRoute } from "astro";
import { createSession, findOrCreateOAuthUser } from "../../../../lib/server/db";
import {
	OAUTH_STATE_COOKIE,
	exchangeCodeForProfile,
	parseStatePayload,
	safeRedirect,
} from "../../../../lib/server/oauth";
import { SESSION_COOKIE } from "../../../../middleware";

/** 실패는 JSON 대신 로그인 페이지로 되돌린다 — 사용자가 보는 건 브라우저 화면이지 API가 아니다. */
function fail(redirect: (path: string, status: 302) => Response, message: string): Response {
	return redirect(`/login?error=${encodeURIComponent(message)}`, 302);
}

export const GET: APIRoute = async ({ url, cookies, redirect, request, locals }) => {
	const { DB, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = locals.runtime.env;
	if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
		return fail(redirect, "구글 로그인이 설정되지 않았습니다");
	}

	// 사용자가 동의 화면에서 취소한 경우
	if (url.searchParams.get("error")) {
		return redirect("/login", 302);
	}

	const code = url.searchParams.get("code");
	const returnedState = url.searchParams.get("state");
	const cookieState = cookies.get(OAUTH_STATE_COOKIE)?.value;
	// state 쿠키는 한 번 쓰고 무조건 버린다(재사용 방지)
	cookies.delete(OAUTH_STATE_COOKIE, { path: "/" });

	if (!code || !returnedState || !cookieState || returnedState !== cookieState) {
		return fail(redirect, "로그인 요청이 만료되었습니다. 다시 시도해주세요");
	}

	const parsed = parseStatePayload(cookieState);
	if (!parsed) return fail(redirect, "로그인 요청이 올바르지 않습니다");

	const exchanged = await exchangeCodeForProfile({
		code,
		clientId: GOOGLE_CLIENT_ID,
		clientSecret: GOOGLE_CLIENT_SECRET,
		redirectUri: new URL("/api/auth/google/callback", url).toString(),
	});
	if (!exchanged.ok) return fail(redirect, exchanged.error);

	const { profile } = exchanged;
	const result = await findOrCreateOAuthUser(DB, {
		provider: "google",
		providerAccountId: profile.sub,
		email: profile.email,
		emailVerified: profile.emailVerified,
		name: profile.name,
		avatarUrl: profile.picture,
	});
	if (!result.ok) return fail(redirect, result.error);

	const { token, expiresAt } = await createSession(
		DB,
		result.user.id,
		request.headers.get("user-agent"),
	);
	cookies.set(SESSION_COOKIE, token, {
		httpOnly: true,
		secure: import.meta.env.PROD,
		sameSite: "lax",
		path: "/",
		expires: expiresAt,
	});

	// 비로그인 상태에서 localStorage에 쌓인 북마크/팔로우를 계정으로 옮긴다.
	// 서버 리다이렉트라 클라이언트 스크립트를 못 부르므로, 도착 페이지에서 처리하도록 표시만 남긴다.
	//
	// 새로 만들어진 계정은 닉네임이 구글 이름으로 임의 배정된 상태라, 목적지로 바로 보내지 않고
	// 작명 화면을 한 번 거친다. 원래 가려던 곳은 redirect로 넘겨 거기서 이어받는다.
	const destination = safeRedirect(parsed.redirect);
	const target = result.isNew
		? new URL(`/welcome?redirect=${encodeURIComponent(destination)}`, url)
		: new URL(destination, url);
	target.searchParams.set("migrate-local", "1");
	return redirect(`${target.pathname}${target.search}`, 302);
};
