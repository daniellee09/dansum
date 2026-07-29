import type { APIRoute } from "astro";
import { json } from "../../../lib/server/http";

export const GET: APIRoute = async ({ locals }) => {
	return json({ success: true, data: locals.user });
};
