/**
 * 상세 화면의 "← 목록으로" 링크.
 *
 * 같은 사이트 안에서 들어왔으면 href로 이동하는 대신 history.back()을 쓴다. 그래야 읽던
 * 목록의 **스크롤 위치와 정렬 탭**이 그대로 남는다 — /discuss?sort=latest에서 들어왔는데
 * href로 /discuss에 떨구면 고른 정렬이 조용히 풀린다.
 *
 * document.referrer를 쓰지 않는다. ClientRouter(뷰 트랜지션)로 옮겨 다니면 문서가 새로
 * 로드되지 않아 referrer가 처음 들어온 주소에 멈춰 있다. 예전 기사 상세 구현이 이걸 쓰고
 * 있었는데, 폴백 href가 마침 정답과 같아서 동작하는 것처럼 보였을 뿐이다(직접 확인함).
 * 그래서 이동 이력을 직접 들고 있는다.
 */

const PREV_KEY = "dansum:prev-url";
const CUR_KEY = "dansum:cur-url";

function currentUrl(): string {
	return location.pathname + location.search;
}

/** 페이지가 바뀔 때마다 '직전 주소'를 갱신한다. BaseLayout이 모든 화면에서 부른다.
 *  sessionStorage를 쓰는 건 전체 새로고침을 건너뛴 이동에도 이력이 이어지게 하려는 것. */
export function trackNavigation(): void {
	try {
		const current = currentUrl();
		const last = sessionStorage.getItem(CUR_KEY);
		if (last && last !== current) sessionStorage.setItem(PREV_KEY, last);
		sessionStorage.setItem(CUR_KEY, current);
	} catch {
		// 프라이빗 모드 등 sessionStorage가 막힌 환경 — 폴백 href로 충분하다
	}
}

/**
 * @param elementId  링크의 id
 * @param cameFromList  직전 주소가 "이 링크가 약속하는 목록"인지 판단한다.
 *   약속과 실제 동작이 어긋나면 안 되므로 판단을 호출부에 맡긴다 — 예를 들어 "토론 목록"이라
 *   적힌 링크가 /feed로 돌아가면 거짓말이 된다.
 */
export function setupBackLink(
	elementId: string,
	cameFromList: (previousUrl: string) => boolean,
): void {
	const back = document.getElementById(elementId);
	if (!back || back.dataset.bound) return;

	let prev: string | null = null;
	try {
		prev = sessionStorage.getItem(PREV_KEY);
	} catch {
		return;
	}
	if (!prev || !cameFromList(prev)) return; // 기록이 없거나 다른 데서 왔으면 href 폴백

	back.dataset.bound = "true";
	back.addEventListener("click", (e) => {
		e.preventDefault();
		history.back();
	});
}
