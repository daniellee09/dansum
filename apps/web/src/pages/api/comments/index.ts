import type { APIRoute } from "astro";
import { createComment, createReplyNotification, listComments } from "../../../lib/server/comments";
import { json, unauthorized } from "../../../lib/server/http";

const MAX_COMMENTS_PER_WINDOW = 10;
const RATE_WINDOW_SECONDS = 60 * 5;

export const GET: APIRoute = async ({ url, locals }) => {
	const articleId = url.searchParams.get("articleId");
	if (!articleId) {
		return json({ success: false, error: "articleId가 필요합니다" }, { status: 400 });
	}
	const comments = await listComments(locals.runtime.env.DB, articleId, locals.user?.id ?? null);
	return json({ success: true, comments });
};

export const POST: APIRoute = async ({ request, locals }) => {
	if (!locals.user) return unauthorized();

	let body: { articleId?: string; parentCommentId?: string | null; body?: string };
	try {
		body = await request.json();
	} catch {
		return json({ success: false, error: "잘못된 요청입니다" }, { status: 400 });
	}

	const articleId = body.articleId;
	const parentCommentId = body.parentCommentId ?? null;
	const text = body.body?.trim() ?? "";
	if (!articleId) return json({ success: false, error: "articleId가 필요합니다" }, { status: 400 });
	if (text.length === 0 || text.length > 1000) {
		return json({ success: false, error: "댓글은 1~1000자여야 합니다" }, { status: 400 });
	}

	const { DB, CACHE } = locals.runtime.env;

	const rateKey = `comment-rate:${locals.user.id}`;
	const count = Number((await CACHE.get(rateKey)) ?? "0");
	if (count >= MAX_COMMENTS_PER_WINDOW) {
		return json(
			{ success: false, error: "댓글을 너무 자주 작성했습니다. 잠시 후 다시 시도해주세요" },
			{ status: 429 },
		);
	}

	const result = await createComment(DB, {
		articleId,
		userId: locals.user.id,
		parentCommentId,
		body: text,
	});
	if (!result.ok) {
		return json({ success: false, error: result.error }, { status: 400 });
	}

	await CACHE.put(rateKey, String(count + 1), { expirationTtl: RATE_WINDOW_SECONDS });

	if (result.notifyUserId) {
		await createReplyNotification(DB, {
			toUserId: result.notifyUserId,
			articleId,
			commentId: result.id,
			fromNickname: locals.user.nickname,
		});
	}

	return json({ success: true, id: result.id });
};
