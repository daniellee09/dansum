import { isReportReason } from "@dansum/shared";
import type { APIRoute } from "astro";
import { json, unauthorized } from "../../../../lib/server/http";
import { reportComment } from "../../../../lib/server/reports";

// 신고는 '남의 글을 가리는' 쓰기 엔드포인트라 제한이 없으면 가장 쉬운 악용 통로가 된다.
// 댓글 작성과 같은 KV 관용구를 쓴다.
const MAX_REPORTS_PER_WINDOW = 10;
const RATE_WINDOW_SECONDS = 60 * 60;

export const POST: APIRoute = async ({ params, request, locals }) => {
	if (!locals.user) return unauthorized();
	const id = params.id;
	if (!id) return json({ success: false, error: "댓글을 찾을 수 없습니다" }, { status: 400 });

	let body: { reason?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ success: false, error: "잘못된 요청입니다" }, { status: 400 });
	}
	if (!isReportReason(body.reason)) {
		return json({ success: false, error: "신고 사유를 선택해주세요" }, { status: 400 });
	}

	const { DB, CACHE } = locals.runtime.env;

	const rateKey = `report-rate:${locals.user.id}`;
	const count = Number((await CACHE.get(rateKey)) ?? "0");
	if (count >= MAX_REPORTS_PER_WINDOW) {
		return json(
			{ success: false, error: "신고를 너무 자주 했습니다. 잠시 후 다시 시도해주세요" },
			{ status: 429 },
		);
	}

	const result = await reportComment(DB, {
		commentId: id,
		reporterId: locals.user.id,
		reason: body.reason,
	});
	if (!result.ok) {
		return json({ success: false, error: result.error }, { status: 400 });
	}

	await CACHE.put(rateKey, String(count + 1), { expirationTtl: RATE_WINDOW_SECONDS });

	// 신고 수도, 가려졌는지도 돌려주지 않는다. 브리게이딩하는 쪽에
	// "몇 개 더 모으면 되는지" 알려주는 꼴이 되기 때문이다.
	return json({ success: true });
};
