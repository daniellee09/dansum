/**
 * 북마크. 로그인 상태면 계정(서버 D1)에, 아니면 기존처럼 localStorage에 기사 id 배열로 저장한다.
 * [data-bookmark-toggle][data-article-id]가 달린 버튼이면 어떤 컴포넌트든 자동으로 동작한다
 * (ArticleCard·LoadMore가 그려낸 카드·기사 상세 액션 버튼 모두 이 한 함수로 처리).
 */

import { isLoggedIn } from "./auth";

const STORAGE_KEY = "dansum:bookmarks";

function readLocalIds(): string[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		const parsed = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function writeLocalIds(ids: string[]): void {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

// 페이지 1회 로드당 한 번만 서버에 물어보고, 이후 토글은 이 배열을 그대로 갱신해서 재사용한다.
let remoteIds: string[] | null = null;
let remoteFetch: Promise<string[]> | null = null;

async function fetchRemoteIds(): Promise<string[]> {
	if (remoteIds) return remoteIds;
	if (!remoteFetch) {
		remoteFetch = fetch("/api/me/bookmarks")
			.then((res) => (res.ok ? res.json() : { ids: [] }))
			.then((data: { ids?: string[] }) => (remoteIds = Array.isArray(data.ids) ? data.ids : []))
			.catch(() => (remoteIds = []));
	}
	return remoteFetch;
}

document.addEventListener("astro:after-swap", () => {
	remoteIds = null;
	remoteFetch = null;
});

export async function getBookmarkIds(): Promise<string[]> {
	return isLoggedIn() ? fetchRemoteIds() : readLocalIds();
}

/** 로그인 직후 계정으로 이관할 익명(localStorage) 상태를 읽는다. 로그인 여부와 무관하게 로컬 값만 본다. */
export function getLocalBookmarkIds(): string[] {
	return readLocalIds();
}

export async function isBookmarked(articleId: string): Promise<boolean> {
	return (await getBookmarkIds()).includes(articleId);
}

/** 토글 후 새 상태(true = 방금 북마크됨)를 반환 */
export async function toggleBookmark(articleId: string): Promise<boolean> {
	if (isLoggedIn()) {
		const ids = await fetchRemoteIds();
		const idx = ids.indexOf(articleId);
		const nowActive = idx < 0;
		if (nowActive) ids.unshift(articleId);
		else ids.splice(idx, 1);
		void fetch(`/api/me/bookmarks/${articleId}`, { method: nowActive ? "POST" : "DELETE" });
		return nowActive;
	}

	const ids = readLocalIds();
	const idx = ids.indexOf(articleId);
	if (idx >= 0) {
		ids.splice(idx, 1);
		writeLocalIds(ids);
		return false;
	}
	ids.unshift(articleId);
	writeLocalIds(ids);
	return true;
}

export async function removeBookmark(articleId: string): Promise<void> {
	if (isLoggedIn()) {
		const ids = await fetchRemoteIds();
		const idx = ids.indexOf(articleId);
		if (idx >= 0) ids.splice(idx, 1);
		void fetch(`/api/me/bookmarks/${articleId}`, { method: "DELETE" });
		return;
	}
	writeLocalIds(readLocalIds().filter((id) => id !== articleId));
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
export async function setupBookmarkButtons(root: ParentNode = document): Promise<void> {
	const buttons = root.querySelectorAll<HTMLButtonElement>(
		"[data-bookmark-toggle]:not([data-bound])",
	);
	if (buttons.length === 0) return;

	const ids = await getBookmarkIds();
	const idSet = new Set(ids);

	for (const btn of buttons) {
		const id = btn.dataset.articleId;
		if (!id) continue;
		btn.dataset.bound = "true";
		applyState(btn, idSet.has(id));
		btn.addEventListener("click", (e) => {
			e.preventDefault();
			toggleBookmark(id).then((active) => applyState(btn, active));
		});
	}
}
