import type { APIRoute } from "astro";
import { voteComment } from "../../../../lib/server/comments";
import { json, unauthorized } from "../../../../lib/server/http";

export const POST: APIRoute = async ({ params, request, locals }) => {
	if (!locals.user) return unauthorized();
	const id = params.id;
	if (!id) return json({ success: false, error: "댓글을 찾을 수 없습니다" }, { status: 400 });

	// 추천 전용 토글이라 본문이 필요 없다. 다만 배포 전에 열려 있던 탭은 여전히
	// {value:-1}을 보낼 수 있는데, 이를 조용히 추천으로 처리하면 사용자가 누른 것의
	// 정반대가 게시된다. 명시적으로 거부하고 새로고침을 요구한다.
	const raw = await request.text();
	if (raw) {
		try {
			const body = JSON.parse(raw) as { value?: number };
			if (body.value === -1) {
				return json(
					{
						success: false,
						error: "비추천은 더 이상 지원하지 않습니다. 페이지를 새로고침해주세요",
					},
					{ status: 400 },
				);
			}
		} catch {
			// 본문이 없거나 깨졌으면 그냥 토글로 처리한다
		}
	}

	const result = await voteComment(locals.runtime.env.DB, id, locals.user.id);
	if (!result.ok) {
		return json({ success: false, error: result.error }, { status: 400 });
	}
	return json({ success: true, score: result.score, upvoted: result.upvoted });
};
