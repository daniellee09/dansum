import { defineMiddleware } from "astro:middleware";
import { validateSessionToken } from "./lib/server/db";
import { awardAttendance } from "./lib/server/exp";

export const SESSION_COOKIE = "dansum_session";

/** 오늘 출석을 이미 처리했는지 표시하는 KV 키의 TTL(하루보다 넉넉히). */
const ATTENDANCE_MARK_TTL_SECONDS = 60 * 60 * 26;

function todayKey(userId: string): string {
	return `attend:${userId}:${new Date().toISOString().slice(0, 10)}`;
}

export const onRequest = defineMiddleware(async (context, next) => {
	context.locals.user = null;

	const token = context.cookies.get(SESSION_COOKIE)?.value;
	if (token) {
		const { DB, CACHE } = context.locals.runtime.env;
		const user = await validateSessionToken(DB, CACHE, token);
		context.locals.user = user;
		// 세션이 무효화됐는데도 쿠키가 남아있으면(로그아웃 없이 만료 등) 정리
		if (!user) context.cookies.delete(SESSION_COOKIE, { path: "/" });

		// 출석 경험치. 페이지 요청에서만 확인한다(API·에셋까지 훑을 이유가 없다).
		// KV 표시는 D1을 매 요청 두드리지 않기 위한 1차 필터일 뿐이고, '하루 한 번'의 진짜
		// 보장은 exp_events의 부분 UNIQUE 인덱스가 한다 — KV가 비어도 중복 적립되지 않는다.
		if (user && context.request.method === "GET" && !context.url.pathname.startsWith("/api/")) {
			const key = todayKey(user.id);
			if ((await CACHE.get(key)) === null) {
				// 응답을 붙잡지 않도록 백그라운드로 넘긴다(첫 페이지 로드가 느려지면 안 된다).
				context.locals.runtime.ctx.waitUntil(
					awardAttendance(DB, user.id).then(() =>
						CACHE.put(key, "1", { expirationTtl: ATTENDANCE_MARK_TTL_SECONDS }),
					),
				);
			}
		}
	}

	return next();
});
