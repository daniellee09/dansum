import type { APIRoute } from "astro";
import { findUserById, toAuthUser, updateNickname } from "../../../lib/server/db";
import { json, unauthorized } from "../../../lib/server/http";

export const GET: APIRoute = async ({ locals }) => {
	if (!locals.user) return unauthorized();
	const row = await findUserById(locals.runtime.env.DB, locals.user.id);
	if (!row) return unauthorized();
	return json({ success: true, data: toAuthUser(row) });
};

export const PATCH: APIRoute = async ({ request, locals }) => {
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

	const result = await updateNickname(locals.runtime.env.DB, locals.user.id, nickname);
	if (!result.ok) {
		return json({ success: false, error: result.error }, { status: 409 });
	}

	const row = await findUserById(locals.runtime.env.DB, locals.user.id);
	return json({ success: true, data: row ? toAuthUser(row) : null });
};
