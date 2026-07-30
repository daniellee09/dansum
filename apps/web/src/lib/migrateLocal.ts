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

/**
 * 소셜 로그인은 서버 리다이렉트로 끝나서 로그인 페이지의 스크립트가 실행될 틈이 없다.
 * 그래서 콜백이 도착 URL에 ?migrate-local=1을 붙여 보내고, 여기서 그 표시를 보고 한 번 옮긴다.
 * 표시는 즉시 URL에서 지운다 — 남아 있으면 새로고침·공유 때마다 다시 돌고, 주소창에도 지저분하다.
 */
export function runPostLoginMigrationIfFlagged(): void {
	const url = new URL(window.location.href);
	if (url.searchParams.get("migrate-local") !== "1") return;
	url.searchParams.delete("migrate-local");
	window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
	void migrateLocalDataToAccount();
}
