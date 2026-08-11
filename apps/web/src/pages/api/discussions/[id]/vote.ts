import { EXP_REWARDS } from "@dansum/shared";
import type { APIRoute } from "astro";
import { awardExp } from "../../../../lib/server/exp";
import { toggleDiscussionVote } from "../../../../lib/server/discussions";
import { json, unauthorized } from "../../../../lib/server/http";

/** 추천 토글. 비추천은 없다(0008에서 폐지) — 반대는 댓글로, 규칙 위반은 신고로 간다. */
export const POST: APIRoute = async ({ params, locals }) => {
	if (!locals.user) return unauthorized();
	const id = params.id;
	if (!id) return json({ success: false, error: "잘못된 요청입니다" }, { status: 400 });

	const { DB } = locals.runtime.env;
	const result = await toggleDiscussionVote(DB, id, locals.user.id);
	if (!result.ok) return json({ success: false, error: result.error }, { status: 400 });

	// 글쓴이 경험치. 껐다 켰다로 농사가 되지 않게 되돌릴 때 같은 양을 회수한다.
	const author = await DB.prepare("SELECT user_id FROM discussions WHERE id = ?")
		.bind(id)
		.first<{ user_id: string }>();
	if (author) {
		const delta = result.upvoted ? EXP_REWARDS.commentUpvoted : -EXP_REWARDS.commentUpvoted;
		await awardExp(DB, author.user_id, delta, "comment_upvoted", "discussion", id);
	}

	return json({ success: true, score: result.score, upvoted: result.upvoted });
};
