import { COMMENT_MAX_LENGTH, EXP_REWARDS, parseCommentSort } from "@dansum/shared";
import type { APIRoute } from "astro";
import { createComment, createReplyNotification, listComments } from "../../../lib/server/comments";
import { json, unauthorized } from "../../../lib/server/http";
import { awardCommentCreated, awardExp } from "../../../lib/server/exp";

const MAX_COMMENTS_PER_WINDOW = 10;
const RATE_WINDOW_SECONDS = 60 * 5;

// 스레드의 단위는 이슈다. 기사 페이지는 articleId로(서버가 이슈로 환원), 이슈 페이지는
// issueId로 부른다. 쓰기(POST)는 여전히 articleId만 받는다 — 아래 주석 참고.
export const GET: APIRoute = async ({ url, locals }) => {
	const articleId = url.searchParams.get("articleId");
	const issueId = url.searchParams.get("issueId");
	if (!articleId && !issueId) {
		return json({ success: false, error: "articleId 또는 issueId가 필요합니다" }, { status: 400 });
	}
	const sort = parseCommentSort(url.searchParams.get("sort"));
	const comments = await listComments(
		locals.runtime.env.DB,
		issueId ? { issueId } : { articleId: articleId as string },
		locals.user?.id ?? null,
		sort,
	);
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

	// 쓰기는 articleId만 받는다. issue_id는 createComment가 기사에서 파생한다 —
	// 클라이언트가 그룹핑 키를 직접 정하게 두면 위조 가능하고 진실의 출처가 둘이 된다.
	const articleId = body.articleId;
	const parentCommentId = body.parentCommentId ?? null;
	const text = body.body?.trim() ?? "";
	if (!articleId) return json({ success: false, error: "articleId가 필요합니다" }, { status: 400 });
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
		articleId,
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
			articleId,
			commentId: result.id,
			fromNickname: locals.user.nickname,
		});
	}

	return json({ success: true, id: result.id });
};
