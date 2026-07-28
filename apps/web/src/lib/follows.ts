/**
 * 팔로우(로컬 저장). 계정 인프라가 없어 서버 대신 localStorage에 매체 id/카테고리 배열로 저장한다.
 * "내 피드"(/feed)가 이 목록을 읽어 기존 /api/articles 필터(source/category)로 조회한다.
 */

const SOURCE_KEY = "dansum:follows:sources";
const CATEGORY_KEY = "dansum:follows:categories";

function readList(key: string): string[] {
	try {
		const raw = localStorage.getItem(key);
		const parsed = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function writeList(key: string, list: string[]): void {
	localStorage.setItem(key, JSON.stringify(list));
}

function toggle(key: string, value: string): boolean {
	const list = readList(key);
	const idx = list.indexOf(value);
	if (idx >= 0) {
		list.splice(idx, 1);
		writeList(key, list);
		return false;
	}
	list.unshift(value);
	writeList(key, list);
	return true;
}

export function getFollowedSources(): string[] {
	return readList(SOURCE_KEY);
}

export function getFollowedCategories(): string[] {
	return readList(CATEGORY_KEY);
}

export function isFollowingSource(sourceId: string): boolean {
	return readList(SOURCE_KEY).includes(sourceId);
}

export function isFollowingCategory(category: string): boolean {
	return readList(CATEGORY_KEY).includes(category);
}

export function toggleFollowSource(sourceId: string): boolean {
	return toggle(SOURCE_KEY, sourceId);
}

export function toggleFollowCategory(category: string): boolean {
	return toggle(CATEGORY_KEY, category);
}

// 활성 상태의 실제 색/배경은 각 버튼이 자기 자리에서 Tailwind aria-pressed: 변형으로 스스로
// 정의한다(카드마다 톤이 달라서 — 예: 사이드바 카드는 채워진 버튼, 헤더는 아웃라인 버튼).
function applyState(btn: HTMLElement, active: boolean): void {
	btn.setAttribute("aria-pressed", String(active));
	btn.textContent = active ? "팔로우 중" : "팔로우";
}

/** root 안의 [data-follow-toggle] 버튼(source/category 헤더, 기사 상세 매체 정보 카드)에
 *  현재 상태를 반영하고 클릭 핸들러를 붙인다. */
export function setupFollowButtons(root: ParentNode = document): void {
	const buttons = root.querySelectorAll<HTMLButtonElement>(
		"[data-follow-toggle]:not([data-bound])",
	);
	for (const btn of buttons) {
		const type = btn.dataset.followType;
		const value = btn.dataset.followValue;
		if (!type || !value) continue;
		btn.dataset.bound = "true";
		const isActive = () =>
			type === "source" ? isFollowingSource(value) : isFollowingCategory(value);
		applyState(btn, isActive());
		btn.addEventListener("click", () => {
			const nowActive =
				type === "source" ? toggleFollowSource(value) : toggleFollowCategory(value);
			applyState(btn, nowActive);
		});
	}
}
