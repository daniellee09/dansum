import type { APIRoute } from "astro";
import { listBookmarkIds } from "../../../../lib/server/db";
import { json, unauthorized } from "../../../../lib/server/http";

export const GET: APIRoute = async ({ locals }) => {
	if (!locals.user) return unauthorized();
	const ids = await listBookmarkIds(locals.runtime.env.DB, locals.user.id);
	return json({ success: true, ids });
};
