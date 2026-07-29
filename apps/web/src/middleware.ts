import { defineMiddleware } from "astro:middleware";
import { validateSessionToken } from "./lib/server/db";

export const SESSION_COOKIE = "dansum_session";

export const onRequest = defineMiddleware(async (context, next) => {
	context.locals.user = null;

	const token = context.cookies.get(SESSION_COOKIE)?.value;
	if (token) {
		const { DB, CACHE } = context.locals.runtime.env;
		const user = await validateSessionToken(DB, CACHE, token);
		context.locals.user = user;
		// 세션이 무효화됐는데도 쿠키가 남아있으면(로그아웃 없이 만료 등) 정리
		if (!user) context.cookies.delete(SESSION_COOKIE, { path: "/" });
	}

	return next();
});
