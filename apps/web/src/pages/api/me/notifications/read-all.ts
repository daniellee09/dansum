import type { APIRoute } from "astro";
import { markAllNotificationsRead } from "../../../../lib/server/comments";
import { json, unauthorized } from "../../../../lib/server/http";

export const POST: APIRoute = async ({ locals }) => {
	if (!locals.user) return unauthorized();
	await markAllNotificationsRead(locals.runtime.env.DB, locals.user.id);
	return json({ success: true });
};
