import type { APIRoute } from "astro";
import { deleteComment } from "../../../lib/server/comments";
import { json, unauthorized } from "../../../lib/server/http";

export const DELETE: APIRoute = async ({ params, locals }) => {
	if (!locals.user) return unauthorized();
	const id = params.id;
	if (!id) return json({ success: false, error: "댓글을 찾을 수 없습니다" }, { status: 400 });

	const result = await deleteComment(locals.runtime.env.DB, id, locals.user.id);
	if (!result.ok) {
		return json({ success: false, error: result.error }, { status: 403 });
	}
	return json({ success: true });
};
