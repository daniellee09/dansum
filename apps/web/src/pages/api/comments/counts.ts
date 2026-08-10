import type { APIRoute } from "astro";
import { countCommentsByArticleIds } from "../../../lib/server/comments";
import { json } from "../../../lib/server/http";

// 라우트 주의: 같은 폴더의 [id].ts와 겹쳐 보이지만 Astro는 정적 세그먼트를 동적 세그먼트보다
// 먼저 매칭하고, [id].ts에는 GET 핸들러 자체가 없다. 충돌하지 않는다.

// D1 바인드 파라미터 상한(100)에 여유를 두고 자른다. 한 화면에 뿌리는 카드 수보다 넉넉하다.
const MAX_IDS = 50;

/**
 * 기사 id 목록 → 그 기사가 속한 이슈의 댓글 수. 0인 기사는 아예 응답에 담지 않는다
 * (모든 카드에 "댓글 0"이 붙으면 모두가 다는 배지가 되어 정보가 아니게 된다).
 */
export const GET: APIRoute = async ({ url, locals }) => {
	const ids = (url.searchParams.get("ids") ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
		.slice(0, MAX_IDS);
	if (ids.length === 0) return json({ success: true, counts: {} });

	const counts = await countCommentsByArticleIds(locals.runtime.env.DB, ids);
	return json({ success: true, counts });
};
