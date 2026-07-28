/**
 * 북마크(로컬 저장). 계정 인프라가 없어 서버 대신 localStorage에 기사 id 배열로 저장한다.
 * [data-bookmark-toggle][data-article-id]가 달린 버튼이면 어떤 컴포넌트든 자동으로 동작한다
 * (ArticleCard·LoadMore가 그려낸 카드·기사 상세 액션 버튼 모두 이 한 함수로 처리).
 */

const STORAGE_KEY = "dansum:bookmarks";

function readIds(): string[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		const parsed = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function writeIds(ids: string[]): void {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

export function getBookmarkIds(): string[] {
	return readIds();
}

export function isBookmarked(articleId: string): boolean {
	return readIds().includes(articleId);
}

/** 토글 후 새 상태(true = 방금 북마크됨)를 반환 */
export function toggleBookmark(articleId: string): boolean {
	const ids = readIds();
	const idx = ids.indexOf(articleId);
	if (idx >= 0) {
		ids.splice(idx, 1);
		writeIds(ids);
		return false;
	}
	ids.unshift(articleId);
	writeIds(ids);
	return true;
}

export function removeBookmark(articleId: string): void {
	writeIds(readIds().filter((id) => id !== articleId));
}

function applyState(btn: HTMLElement, active: boolean): void {
	btn.setAttribute("aria-pressed", String(active));
	btn.classList.toggle("text-brand", active);
	const icon = btn.querySelector<SVGElement>("[data-bookmark-icon]");
	icon?.setAttribute("fill", active ? "currentColor" : "none");
	const label = btn.querySelector<HTMLElement>("[data-bookmark-label]");
	if (label) label.textContent = active ? "북마크됨" : "북마크";
}

/** root 안의 [data-bookmark-toggle] 버튼들에 현재 상태를 반영하고 클릭 핸들러를 붙인다.
 *  이미 바인딩된 버튼(data-bound)은 건너뛰어 중복 리스너를 막는다. */
export function setupBookmarkButtons(root: ParentNode = document): void {
	const buttons = root.querySelectorAll<HTMLButtonElement>(
		"[data-bookmark-toggle]:not([data-bound])",
	);
	for (const btn of buttons) {
		const id = btn.dataset.articleId;
		if (!id) continue;
		btn.dataset.bound = "true";
		applyState(btn, isBookmarked(id));
		btn.addEventListener("click", (e) => {
			e.preventDefault();
			applyState(btn, toggleBookmark(id));
		});
	}
}
