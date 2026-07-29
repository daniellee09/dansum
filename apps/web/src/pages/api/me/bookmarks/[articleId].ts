import type { APIRoute } from "astro";
import { addBookmark, removeBookmark } from "../../../../lib/server/db";
import { json, unauthorized } from "../../../../lib/server/http";

export const POST: APIRoute = async ({ params, locals }) => {
	if (!locals.user) return unauthorized();
	const articleId = params.articleId;
	if (!articleId) return json({ success: false, error: "articleId가 필요합니다" }, { status: 400 });
	await addBookmark(locals.runtime.env.DB, locals.user.id, articleId);
	return json({ success: true });
};

export const DELETE: APIRoute = async ({ params, locals }) => {
	if (!locals.user) return unauthorized();
	const articleId = params.articleId;
	if (!articleId) return json({ success: false, error: "articleId가 필요합니다" }, { status: 400 });
	await removeBookmark(locals.runtime.env.DB, locals.user.id, articleId);
	return json({ success: true });
};
