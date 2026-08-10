import { KEYWORD_ALERT_MAX_FOLLOWS, KEYWORD_MAX_LENGTH, KEYWORD_MIN_LENGTH } from "@dansum/shared";
import type { APIRoute } from "astro";
import { addFollow, countKeywordFollows, removeFollow } from "../../../../../lib/server/db";
import type { FollowType } from "../../../../../lib/server/db";
import { json, unauthorized } from "../../../../../lib/server/http";

function parseType(type: string | undefined): FollowType | null {
	return type === "source" || type === "category" || type === "keyword" ? type : null;
}

export const POST: APIRoute = async ({ params, locals }) => {
	if (!locals.user) return unauthorized();
	const type = parseType(params.type);
	const value = params.value;
	if (!type || !value) return json({ success: false, error: "잘못된 요청입니다" }, { status: 400 });

	// 키워드만 상한을 둔다. 매체·카테고리는 목록이 유한하고 화면에서 고르는 것이라
	// 무한정 늘 수 없지만, 키워드는 사용자가 자유롭게 만드는 값이라 그렇지 않다.
	if (type === "keyword") {
		if (value.length < KEYWORD_MIN_LENGTH || value.length > KEYWORD_MAX_LENGTH) {
			return json(
				{
					success: false,
					error: `키워드는 ${KEYWORD_MIN_LENGTH}~${KEYWORD_MAX_LENGTH}자여야 합니다`,
				},
				{ status: 400 },
			);
		}
		const n = await countKeywordFollows(locals.runtime.env.DB, locals.user.id);
		if (n >= KEYWORD_ALERT_MAX_FOLLOWS) {
			return json(
				{
					success: false,
					error: `키워드는 ${KEYWORD_ALERT_MAX_FOLLOWS}개까지 등록할 수 있습니다`,
				},
				{ status: 400 },
			);
		}
	}

	await addFollow(locals.runtime.env.DB, locals.user.id, type, value);
	return json({ success: true });
};

export const DELETE: APIRoute = async ({ params, locals }) => {
	if (!locals.user) return unauthorized();
	const type = parseType(params.type);
	const value = params.value;
	if (!type || !value) return json({ success: false, error: "잘못된 요청입니다" }, { status: 400 });
	await removeFollow(locals.runtime.env.DB, locals.user.id, type, value);
	return json({ success: true });
};
