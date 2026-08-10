/**
 * 기사 카드의 "댓글 N". [data-comment-count-for="<articleId>"]가 달린 자리면 어디든 채운다
 * (ArticleCard·renderArticleCard가 그린 카드 모두 이 한 함수로 처리 — bookmarks.ts와 같은 패턴).
 *
 * 왜 /api/articles 응답에 넣지 않는가: 그 응답은 KV에 30분 캐시되고 컬렉터만 무효화하므로
 * 숫자를 박아 넣으면 최대 30분 낡는다. 여기서 채우면 항상 지금 값이다.
 *
 * 세는 단위는 기사가 아니라 **이슈**다 — 같은 사건을 다룬 기사들은 같은 숫자를 보여준다.
 * 0이면 아무것도 그리지 않는다(모든 카드에 "댓글 0"이 붙으면 그건 정보가 아니다).
 */

const MAX_IDS = 50;
// 이미 채운 자리를 다시 묻지 않도록 페이지 로드 단위로 기억한다.
let cache = new Map<string, number>();

document.addEventListener("astro:after-swap", () => {
	cache = new Map();
});

export async function setupCommentCounts(root: ParentNode = document): Promise<void> {
	const slots = [...root.querySelectorAll<HTMLElement>("[data-comment-count-for]")].filter(
		(el) => el.dataset.commentCountFilled !== "1",
	);
	if (slots.length === 0) return;

	const byId = new Map<string, HTMLElement[]>();
	for (const el of slots) {
		const id = el.dataset.commentCountFor;
		if (!id) continue;
		el.dataset.commentCountFilled = "1";
		const list = byId.get(id);
		if (list) list.push(el);
		else byId.set(id, [el]);
	}

	const unknown = [...byId.keys()].filter((id) => !cache.has(id));
	for (let i = 0; i < unknown.length; i += MAX_IDS) {
		const chunk = unknown.slice(i, i + MAX_IDS);
		try {
			const res = await fetch(`/api/comments/counts?ids=${chunk.map(encodeURIComponent).join(",")}`);
			if (!res.ok) continue;
			const data = (await res.json()) as { counts?: Record<string, number> };
			// 응답에 없는 id는 0건이다(서버가 0을 아예 담지 않는다).
			for (const id of chunk) cache.set(id, data.counts?.[id] ?? 0);
		} catch {
			// 댓글 수는 부가 정보다. 실패하면 그냥 비워 둔다.
		}
	}

	for (const [id, els] of byId) {
		const n = cache.get(id) ?? 0;
		if (n <= 0) continue;
		for (const el of els) el.textContent = `댓글 ${n}`;
	}
}
