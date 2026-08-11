import type { APIRoute } from "astro";
import {
	DISCUSSION_BODY_MAX,
	DISCUSSION_RATE_LIMIT,
	DISCUSSION_RATE_WINDOW_SECONDS,
	DISCUSSION_TITLE_MAX,
	createDiscussion,
} from "../../../lib/server/discussions";
import { json, unauthorized } from "../../../lib/server/http";

export const POST: APIRoute = async ({ request, locals }) => {
	if (!locals.user) return unauthorized();

	let body: { title?: string; body?: string; issueId?: string | null };
	try {
		body = await request.json();
	} catch {
		return json({ success: false, error: "잘못된 요청입니다" }, { status: 400 });
	}

	const title = body.title?.trim() ?? "";
	const text = body.body?.trim() ?? "";
	if (title.length < 2 || title.length > DISCUSSION_TITLE_MAX) {
		return json(
			{ success: false, error: `제목은 2~${DISCUSSION_TITLE_MAX}자여야 합니다` },
			{ status: 400 },
		);
	}
	if (text.length === 0 || text.length > DISCUSSION_BODY_MAX) {
		return json(
			{ success: false, error: `본문은 1~${DISCUSSION_BODY_MAX}자여야 합니다` },
			{ status: 400 },
		);
	}

	const { DB, CACHE } = locals.runtime.env;

	// 토론 글은 목록 전체를 차지하므로 댓글보다 훨씬 빡빡하게 제한한다.
	const rateKey = `discussion-rate:${locals.user.id}`;
	const count = Number((await CACHE.get(rateKey)) ?? "0");
	if (count >= DISCUSSION_RATE_LIMIT) {
		return json(
			{ success: false, error: "토론을 너무 자주 열었습니다. 잠시 후 다시 시도해주세요" },
			{ status: 429 },
		);
	}

	const result = await createDiscussion(DB, {
		userId: locals.user.id,
		title,
		body: text,
		issueId: body.issueId ?? null,
	});
	if (!result.ok) return json({ success: false, error: result.error }, { status: 400 });

	await CACHE.put(rateKey, String(count + 1), { expirationTtl: DISCUSSION_RATE_WINDOW_SECONDS });

	return json({ success: true, id: result.id });
};
