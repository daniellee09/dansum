import type { APIRoute } from "astro";
import {
	findUserById,
	invalidateSessionCache,
	toAuthUser,
	updateNickname,
} from "../../../lib/server/db";
import { json, unauthorized } from "../../../lib/server/http";
import { SESSION_COOKIE } from "../../../middleware";

export const GET: APIRoute = async ({ locals }) => {
	if (!locals.user) return unauthorized();
	const row = await findUserById(locals.runtime.env.DB, locals.user.id);
	if (!row) return unauthorized();
	return json({ success: true, data: toAuthUser(row) });
};

export const PATCH: APIRoute = async ({ request, cookies, locals }) => {
	if (!locals.user) return unauthorized();

	let body: { nickname?: string };
	try {
		body = await request.json();
	} catch {
		return json({ success: false, error: "잘못된 요청입니다" }, { status: 400 });
	}

	const nickname = body.nickname?.trim();
	if (!nickname) {
		return json({ success: false, error: "닉네임을 입력해주세요" }, { status: 400 });
	}
	if (nickname.length < 2 || nickname.length > 20) {
		return json({ success: false, error: "닉네임은 2~20자여야 합니다" }, { status: 400 });
	}

	const { DB, CACHE } = locals.runtime.env;
	const result = await updateNickname(DB, locals.user.id, nickname);
	if (!result.ok) {
		return json({ success: false, error: result.error }, { status: 409 });
	}

	// 세션은 KV에 300초 캐시되므로 지우지 않으면 헤더·댓글에 옛 닉네임이 계속 보인다.
	const token = cookies.get(SESSION_COOKIE)?.value;
	if (token) await invalidateSessionCache(CACHE, token);

	const row = await findUserById(DB, locals.user.id);
	return json({ success: true, data: row ? toAuthUser(row) : null });
};
