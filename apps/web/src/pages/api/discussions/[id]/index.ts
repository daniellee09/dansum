import type { APIRoute } from "astro";
import { deleteDiscussion } from "../../../../lib/server/discussions";
import { json, unauthorized } from "../../../../lib/server/http";

export const DELETE: APIRoute = async ({ params, locals }) => {
	if (!locals.user) return unauthorized();
	const id = params.id;
	if (!id) return json({ success: false, error: "잘못된 요청입니다" }, { status: 400 });

	const result = await deleteDiscussion(locals.runtime.env.DB, id, locals.user.id);
	if (!result.ok) return json({ success: false, error: result.error }, { status: 400 });
	return json({ success: true });
};
