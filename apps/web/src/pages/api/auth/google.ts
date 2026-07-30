import type { APIRoute } from "astro";
import { json } from "../../../lib/server/http";
import {
	OAUTH_STATE_COOKIE,
	OAUTH_STATE_TTL_SECONDS,
	buildAuthorizeUrl,
	buildStatePayload,
	safeRedirect,
} from "../../../lib/server/oauth";

/** 로그인 버튼이 링크로 거는 진입점 — 구글 동의 화면으로 넘긴다. */
export const GET: APIRoute = async ({ url, cookies, redirect, locals }) => {
	const { GOOGLE_CLIENT_ID } = locals.runtime.env;
	if (!GOOGLE_CLIENT_ID) {
		return json({ success: false, error: "구글 로그인이 설정되지 않았습니다" }, { status: 500 });
	}

	const state = buildStatePayload(safeRedirect(url.searchParams.get("redirect")));
	cookies.set(OAUTH_STATE_COOKIE, state, {
		httpOnly: true,
		secure: import.meta.env.PROD,
		// 구글에서 우리 사이트로 되돌아오는 top-level 이동에도 쿠키가 실려야 하므로 lax.
		// (strict면 콜백에서 쿠키가 사라져 state 검증이 항상 실패한다)
		sameSite: "lax",
		path: "/",
		maxAge: OAUTH_STATE_TTL_SECONDS,
	});

	return redirect(
		buildAuthorizeUrl({
			clientId: GOOGLE_CLIENT_ID,
			redirectUri: new URL("/api/auth/google/callback", url).toString(),
			state,
		}),
		302,
	);
};
