import type { APIRoute } from "astro";
import { voteComment } from "../../../../lib/server/comments";
import { json, unauthorized } from "../../../../lib/server/http";

export const POST: APIRoute = async ({ params, request, locals }) => {
	if (!locals.user) return unauthorized();
	const id = params.id;
	if (!id) return json({ success: false, error: "댓글을 찾을 수 없습니다" }, { status: 400 });

	let body: { value?: number };
	try {
		body = await request.json();
	} catch {
		return json({ success: false, error: "잘못된 요청입니다" }, { status: 400 });
	}
	if (body.value !== 1 && body.value !== -1) {
		return json({ success: false, error: "value는 1 또는 -1이어야 합니다" }, { status: 400 });
	}

	const result = await voteComment(locals.runtime.env.DB, id, locals.user.id, body.value);
	if (!result.ok) {
		return json({ success: false, error: result.error }, { status: 400 });
	}
	return json({ success: true, score: result.score });
};
