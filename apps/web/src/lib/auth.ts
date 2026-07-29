/**
 * 현재 로그인한 유저 정보(클라이언트). BaseLayout이 SSR 시점에 `Astro.locals.user`를
 * <script type="application/json" id="dansum-auth-state">로 내려주고, 여기서 동기적으로 읽는다.
 * 페이지 전환(View Transitions) 시 서버가 새로 렌더하므로 astro:after-swap에서 캐시를 비운다.
 */

export interface CurrentUser {
	id: string;
	email: string;
	nickname: string;
	avatarUrl: string | null;
}

let cached: CurrentUser | null | undefined;

export function getCurrentUser(): CurrentUser | null {
	if (cached !== undefined) return cached;
	try {
		const el = document.getElementById("dansum-auth-state");
		cached = el?.textContent ? (JSON.parse(el.textContent) as CurrentUser) : null;
	} catch {
		cached = null;
	}
	return cached;
}

export function isLoggedIn(): boolean {
	return getCurrentUser() !== null;
}

document.addEventListener("astro:after-swap", () => {
	cached = undefined;
});
