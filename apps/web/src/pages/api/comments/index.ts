import { COMMENT_MAX_LENGTH, EXP_REWARDS, parseCommentSort } from "@dansum/shared";
import type { APIRoute } from "astro";
import { createComment, createReplyNotification, listComments } from "../../../lib/server/comments";
import type { CommentTarget } from "../../../lib/server/comments";
import { json, unauthorized } from "../../../lib/server/http";
import { awardCommentCreated, awardExp } from "../../../lib/server/exp";

const MAX_COMMENTS_PER_WINDOW = 10;
const RATE_WINDOW_SECONDS = 60 * 5;

/** 댓글은 기사 하나 또는 토론 글 하나에 달린다. 한때 이슈 단위로 묶었지만 되돌렸다. */
function parseTarget(articleId: string | null, discussionId: string | null): CommentTarget | null {
	if (articleId && !discussionId) return { articleId };
	if (discussionId && !articleId) return { discussionId };
	return null;
}

export const GET: APIRoute = async ({ url, locals }) => {
	const target = parseTarget(
		url.searchParams.get("articleId"),
		url.searchParams.get("discussionId"),
	);
	if (!target) {
		return json(
			{ success: false, error: "articleId 또는 discussionId 중 하나가 필요합니다" },
			{ status: 400 },
		);
	}
	const sort = parseCommentSort(url.searchParams.get("sort"));
	const comments = await listComments(
		locals.runtime.env.DB,
		target,
		locals.user?.id ?? null,
		sort,
	);
	return json({ success: true, comments });
};

export const POST: APIRoute = async ({ request, locals }) => {
	if (!locals.user) return unauthorized();

	let body: {
		articleId?: string;
		discussionId?: string;
		parentCommentId?: string | null;
		body?: string;
	};
	try {
		body = await request.json();
	} catch {
		return json({ success: false, error: "잘못된 요청입니다" }, { status: 400 });
	}

	const target = parseTarget(body.articleId ?? null, body.discussionId ?? null);
	const parentCommentId = body.parentCommentId ?? null;
	const text = body.body?.trim() ?? "";
	if (!target) {
		return json(
			{ success: false, error: "articleId 또는 discussionId 중 하나가 필요합니다" },
			{ status: 400 },
		);
	}
	if (text.length === 0 || text.length > COMMENT_MAX_LENGTH) {
		return json(
			{ success: false, error: `댓글은 1~${COMMENT_MAX_LENGTH}자여야 합니다` },
			{ status: 400 },
		);
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
		target,
		userId: locals.user.id,
		parentCommentId,
		body: text,
	});
	if (!result.ok) {
		return json({ success: false, error: result.error }, { status: 400 });
	}

	await CACHE.put(rateKey, String(count + 1), { expirationTtl: RATE_WINDOW_SECONDS });

	// 작성 보상(하루 상한 안에서만). 배지 확인도 여기서 함께 돈다.
	await awardCommentCreated(DB, locals.user.id, result.id);

	if (result.notifyUserId) {
		// 답글을 받은 쪽에 보상 — 논의를 촉발한 댓글에 주는 몫이다.
		// 본인이 자기 글에 단 답글이면 notifyUserId가 null이라 자기 적립은 애초에 불가능하다.
		await awardExp(DB, result.notifyUserId, EXP_REWARDS.replyReceived, "reply_received", "comment", result.id);
		await createReplyNotification(DB, {
			toUserId: result.notifyUserId,
			articleId: "articleId" in target ? target.articleId : null,
			discussionId: "discussionId" in target ? target.discussionId : null,
			commentId: result.id,
			fromNickname: locals.user.nickname,
		});
	}

	return json({ success: true, id: result.id });
};
