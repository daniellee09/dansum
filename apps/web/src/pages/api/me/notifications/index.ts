import type { APIRoute } from "astro";
import { countUnreadNotifications, listNotifications } from "../../../../lib/server/comments";
import { json, unauthorized } from "../../../../lib/server/http";

export const GET: APIRoute = async ({ locals }) => {
	if (!locals.user) return unauthorized();
	const { DB } = locals.runtime.env;
	const [notifications, unreadCount] = await Promise.all([
		listNotifications(DB, locals.user.id),
		countUnreadNotifications(DB, locals.user.id),
	]);
	return json({ success: true, notifications, unreadCount });
};
