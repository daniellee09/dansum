import type { APIRoute } from "astro";
import { markNotificationRead } from "../../../../../lib/server/comments";
import { json, unauthorized } from "../../../../../lib/server/http";

export const POST: APIRoute = async ({ params, locals }) => {
	if (!locals.user) return unauthorized();
	const id = params.id;
	if (!id) return json({ success: false, error: "알림을 찾을 수 없습니다" }, { status: 400 });
	await markNotificationRead(locals.runtime.env.DB, locals.user.id, id);
	return json({ success: true });
};
