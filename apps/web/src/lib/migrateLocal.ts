import { getLocalBookmarkIds } from "./bookmarks";
import { getLocalFollows } from "./follows";
import { getLocalRecentlyViewedIds } from "./recentlyViewed";

/** 로그인/회원가입 성공 직후, 계정 생기기 전(익명 localStorage) 상태를 계정에 한 번 병합한다. */
export async function migrateLocalDataToAccount(): Promise<void> {
	const bookmarks = getLocalBookmarkIds();
	const { sources: followSources, categories: followCategories } = getLocalFollows();
	const recentlyViewed = getLocalRecentlyViewedIds();

	const hasAnything =
		bookmarks.length > 0 ||
		followSources.length > 0 ||
		followCategories.length > 0 ||
		recentlyViewed.length > 0;
	if (!hasAnything) return;

	await fetch("/api/me/migrate-local", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ bookmarks, followSources, followCategories, recentlyViewed }),
	}).catch(() => {});
}
