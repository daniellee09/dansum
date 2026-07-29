import type { APIRoute } from "astro";
import { listFollows } from "../../../../lib/server/db";
import { json, unauthorized } from "../../../../lib/server/http";

export const GET: APIRoute = async ({ locals }) => {
	if (!locals.user) return unauthorized();
	const follows = await listFollows(locals.runtime.env.DB, locals.user.id);
	return json({ success: true, ...follows });
};
