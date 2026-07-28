/**
 * 최근 본 기사(로컬 저장). 계정 인프라가 없어 서버 대신 localStorage에 기사 id 배열로
 * 저장한다(북마크와 동일한 얕은 저장 패턴 — 상세 데이터는 매번 getArticle로 재조회).
 * 홈 화면 우측 사이드바의 "최근 본 기사" 위젯이 읽고, 기사 상세 페이지가 방문 시 기록한다.
 */

const STORAGE_KEY = "dansum:recently-viewed";
const MAX_ITEMS = 20;

function readIds(): string[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		const parsed = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export function addRecentlyViewed(articleId: string): void {
	const ids = readIds().filter((id) => id !== articleId);
	ids.unshift(articleId);
	localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(0, MAX_ITEMS)));
}

export function getRecentlyViewedIds(limit?: number): string[] {
	const ids = readIds();
	return limit ? ids.slice(0, limit) : ids;
}
