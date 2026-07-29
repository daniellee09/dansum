import type { APIRoute } from "astro";
import { listRecentlyViewedIds } from "../../../../lib/server/db";
import { json, unauthorized } from "../../../../lib/server/http";

export const GET: APIRoute = async ({ locals, url }) => {
	if (!locals.user) return unauthorized();
	const limitParam = url.searchParams.get("limit");
	const limit = limitParam ? Number(limitParam) : undefined;
	const ids = await listRecentlyViewedIds(locals.runtime.env.DB, locals.user.id, limit);
	return json({ success: true, ids });
};
