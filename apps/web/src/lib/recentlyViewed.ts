/**
 * 최근 본 기사. 로그인 상태면 계정(서버 D1)에, 아니면 기존처럼 localStorage에 기사 id 배열로
 * 저장한다(북마크와 동일한 얕은 저장 패턴 — 상세 데이터는 매번 getArticle로 재조회).
 * 홈 화면 우측 사이드바의 "최근 본 기사" 위젯이 읽고, 기사 상세 페이지가 방문 시 기록한다.
 */

import { isLoggedIn } from "./auth";

const STORAGE_KEY = "dansum:recently-viewed";
const MAX_ITEMS = 20;

function readLocalIds(): string[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		const parsed = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export async function addRecentlyViewed(articleId: string): Promise<void> {
	if (isLoggedIn()) {
		void fetch(`/api/me/recently-viewed/${articleId}`, { method: "POST" });
		return;
	}
	const ids = readLocalIds().filter((id) => id !== articleId);
	ids.unshift(articleId);
	localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(0, MAX_ITEMS)));
}

/** 로그인 직후 계정으로 이관할 익명(localStorage) 최근본기사 목록 */
export function getLocalRecentlyViewedIds(): string[] {
	return readLocalIds();
}

export async function getRecentlyViewedIds(limit?: number): Promise<string[]> {
	if (isLoggedIn()) {
		const res = await fetch(`/api/me/recently-viewed${limit ? `?limit=${limit}` : ""}`).catch(
			() => null,
		);
		const data = res?.ok ? await res.json() : null;
		return Array.isArray(data?.ids) ? data.ids : [];
	}
	const ids = readLocalIds();
	return limit ? ids.slice(0, limit) : ids;
}
