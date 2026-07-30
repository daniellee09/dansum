import type { APIRoute } from "astro";
import { isAdmin } from "../../../../lib/server/admin";
import { forbidden, json, unauthorized } from "../../../../lib/server/http";
import { resolveReport } from "../../../../lib/server/reports";

export const POST: APIRoute = async ({ params, request, locals }) => {
	// 페이지(reports.astro)가 이미 걸렀더라도 여기서 독립적으로 다시 확인한다.
	if (!locals.user) return unauthorized();
	if (!isAdmin(locals.user)) return forbidden();

	const id = params.id;
	if (!id) return json({ success: false, error: "댓글을 찾을 수 없습니다" }, { status: 400 });

	let body: { action?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ success: false, error: "잘못된 요청입니다" }, { status: 400 });
	}
	if (body.action !== "dismiss" && body.action !== "delete") {
		return json(
			{ success: false, error: "action은 dismiss 또는 delete여야 합니다" },
			{ status: 400 },
		);
	}

	const result = await resolveReport(locals.runtime.env.DB, {
		commentId: id,
		adminId: locals.user.id,
		action: body.action,
	});
	if (!result.ok) {
		return json({ success: false, error: result.error }, { status: 400 });
	}
	return json({ success: true });
};
