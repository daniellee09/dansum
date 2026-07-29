/**
 * 팔로우. 로그인 상태면 계정(서버 D1)에, 아니면 기존처럼 localStorage에 매체 id/카테고리 배열로
 * 저장한다. "내 피드"(/feed)가 이 목록을 읽어 기존 /api/articles 필터(source/category)로 조회한다.
 */

import { isLoggedIn } from "./auth";

const SOURCE_KEY = "dansum:follows:sources";
const CATEGORY_KEY = "dansum:follows:categories";

function readLocalList(key: string): string[] {
	try {
		const raw = localStorage.getItem(key);
		const parsed = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function writeLocalList(key: string, list: string[]): void {
	localStorage.setItem(key, JSON.stringify(list));
}

function toggleLocal(key: string, value: string): boolean {
	const list = readLocalList(key);
	const idx = list.indexOf(value);
	if (idx >= 0) {
		list.splice(idx, 1);
		writeLocalList(key, list);
		return false;
	}
	list.unshift(value);
	writeLocalList(key, list);
	return true;
}

// 페이지 1회 로드당 한 번만 서버에 물어보고, 이후 토글은 이 값을 그대로 갱신해서 재사용한다.
let remote: { sources: string[]; categories: string[] } | null = null;
let remoteFetch: Promise<{ sources: string[]; categories: string[] }> | null = null;

async function fetchRemote(): Promise<{ sources: string[]; categories: string[] }> {
	if (remote) return remote;
	if (!remoteFetch) {
		remoteFetch = fetch("/api/me/follows")
			.then((res) => (res.ok ? res.json() : { sources: [], categories: [] }))
			.then((data: { sources?: string[]; categories?: string[] }) => {
				remote = {
					sources: Array.isArray(data.sources) ? data.sources : [],
					categories: Array.isArray(data.categories) ? data.categories : [],
				};
				return remote;
			})
			.catch(() => (remote = { sources: [], categories: [] }));
	}
	return remoteFetch;
}

document.addEventListener("astro:after-swap", () => {
	remote = null;
	remoteFetch = null;
});

export async function getFollowedSources(): Promise<string[]> {
	return isLoggedIn() ? (await fetchRemote()).sources : readLocalList(SOURCE_KEY);
}

export async function getFollowedCategories(): Promise<string[]> {
	return isLoggedIn() ? (await fetchRemote()).categories : readLocalList(CATEGORY_KEY);
}

/** 로그인 직후 계정으로 이관할 익명(localStorage) 팔로우 목록 */
export function getLocalFollows(): { sources: string[]; categories: string[] } {
	return { sources: readLocalList(SOURCE_KEY), categories: readLocalList(CATEGORY_KEY) };
}

export async function isFollowingSource(sourceId: string): Promise<boolean> {
	return (await getFollowedSources()).includes(sourceId);
}

export async function isFollowingCategory(category: string): Promise<boolean> {
	return (await getFollowedCategories()).includes(category);
}

async function toggleRemote(type: "source" | "category", value: string): Promise<boolean> {
	const state = await fetchRemote();
	const list = type === "source" ? state.sources : state.categories;
	const idx = list.indexOf(value);
	const nowActive = idx < 0;
	if (nowActive) list.unshift(value);
	else list.splice(idx, 1);
	void fetch(`/api/me/follows/${type}/${encodeURIComponent(value)}`, {
		method: nowActive ? "POST" : "DELETE",
	});
	return nowActive;
}

export async function toggleFollowSource(sourceId: string): Promise<boolean> {
	return isLoggedIn() ? toggleRemote("source", sourceId) : toggleLocal(SOURCE_KEY, sourceId);
}

export async function toggleFollowCategory(category: string): Promise<boolean> {
	return isLoggedIn() ? toggleRemote("category", category) : toggleLocal(CATEGORY_KEY, category);
}

// 활성 상태의 실제 색/배경은 각 버튼이 자기 자리에서 Tailwind aria-pressed: 변형으로 스스로
// 정의한다(카드마다 톤이 달라서 — 예: 사이드바 카드는 채워진 버튼, 헤더는 아웃라인 버튼).
function applyState(btn: HTMLElement, active: boolean): void {
	btn.setAttribute("aria-pressed", String(active));
	btn.textContent = active ? "팔로우 중" : "팔로우";
}

/** root 안의 [data-follow-toggle] 버튼(source/category 헤더, 기사 상세 매체 정보 카드)에
 *  현재 상태를 반영하고 클릭 핸들러를 붙인다. */
export async function setupFollowButtons(root: ParentNode = document): Promise<void> {
	const buttons = root.querySelectorAll<HTMLButtonElement>(
		"[data-follow-toggle]:not([data-bound])",
	);
	if (buttons.length === 0) return;

	const [sources, categories] = await Promise.all([getFollowedSources(), getFollowedCategories()]);
	const sourceSet = new Set(sources);
	const categorySet = new Set(categories);

	for (const btn of buttons) {
		const type = btn.dataset.followType;
		const value = btn.dataset.followValue;
		if (!type || !value) continue;
		btn.dataset.bound = "true";
		applyState(btn, type === "source" ? sourceSet.has(value) : categorySet.has(value));
		btn.addEventListener("click", () => {
			const toggle = type === "source" ? toggleFollowSource : toggleFollowCategory;
			toggle(value).then((active) => applyState(btn, active));
		});
	}
}
