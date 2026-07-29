import type { APIRoute } from "astro";
import { revokeSession } from "../../../lib/server/db";
import { json } from "../../../lib/server/http";
import { SESSION_COOKIE } from "../../../middleware";

export const POST: APIRoute = async ({ cookies, locals }) => {
	const token = cookies.get(SESSION_COOKIE)?.value;
	if (token) {
		const { DB, CACHE } = locals.runtime.env;
		await revokeSession(DB, CACHE, token);
	}
	cookies.delete(SESSION_COOKIE, { path: "/" });
	return json({ success: true });
};
