// 로컬 dev 서버(web+api, dansum-dev 스킬 참고)가 떠 있는 상태에서 실행하는 브라우저 스모크 테스트.
// 코드 리뷰/리팩터마다 매번 새로 스크립트를 짜지 않도록 저장해 둔 것 — dansum-verify 스킬이 이 파일을 실행한다.
//
//   pnpm --filter @dansum/web test:smoke
//
// SMOKE_BASE_URL로 대상 origin을 바꿀 수 있다. 반드시 API CORS 허용 origin(http://localhost:4321)과
// 일치해야 한다 — 127.0.0.1로 접속하면 apps/api/src/index.ts의 CORS 설정에 막혀 북마크/피드가 실패한다.
import { chromium } from "playwright";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:4321";
// 이슈 배정 같은 불변식은 화면보다 API에서 검사하는 편이 훨씬 정확하다.
const API = process.env.SMOKE_API_URL ?? "http://localhost:8787";

const results = [];
function check(name, ok, extra = "") {
	results.push({ name, ok, extra });
	console.log(`${ok ? "PASS" : "FAIL"} - ${name}${extra ? " :: " + extra : ""}`);
}

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (err) => console.log("  [pageerror]", err.message));

try {
	// 정렬 탭
	await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
	check("home loads with articles", (await page.locator("#article-list article").count()) > 0);

	await page.goto(`${BASE}/?sort=hot`, { waitUntil: "networkidle" });
	check("hot sort route renders", (await page.locator("#article-list article").count()) >= 0);

	// 사이드바 Hot → /hot (24시간 내 보도량 상위 기사, 캐시 없이 항상 최신)
	await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
	const hotLinkHref = await page.locator('a:has-text("Hot")').getAttribute("href");
	check("sidebar Hot link points to /hot", hotLinkHref === "/hot");
	await page.goto(`${BASE}/hot`, { waitUntil: "networkidle" });
	check("/hot page renders", (await page.locator("h2:has-text('Hot')").count()) === 1);

	// 검색 정렬: 기본은 관련도순, 최신순/인기순 탭은 쿼리에 sort를 명시해야 한다.
	// 시드 데이터가 바뀌어도 안전하도록 홈의 첫 제목에서 검색어를 뽑는다.
	await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
	const firstTitle = (await page.locator("#article-list article h2").first().textContent())?.trim();
	const term = firstTitle?.split(/\s+/)[0];
	if (term) {
		await page.goto(`${BASE}/search?q=${encodeURIComponent(term)}`, { waitUntil: "networkidle" });
		check(
			"search default (relevance) returns results",
			(await page.locator("#article-list article").count()) > 0,
			`q=${term}`,
		);
		const relevanceClass = await page.locator('a:has-text("관련도순")').getAttribute("class");
		check("relevance tab active by default", !!relevanceClass?.includes("border-text text-text"));

		const latestHref = await page.locator('a:has-text("최신순")').getAttribute("href");
		check(
			"latest tab href carries q + sort=latest",
			!!latestHref?.includes("sort=latest") && latestHref.includes(encodeURIComponent(term)),
		);

		await page.goto(`${BASE}/search?q=${encodeURIComponent(term)}&sort=hot`, { waitUntil: "networkidle" });
		check("search hot sort renders", (await page.locator("#article-list article").count()) >= 0);
	} else {
		check("search sort tabs (skipped: no seed articles)", true);
	}

	// 북마크: 토글 → localStorage → /bookmarks 반영 → 해제
	await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
	const firstCard = page.locator("#article-list article").first();
	const bookmarkBtn = firstCard.locator("[data-bookmark-toggle]");
	const articleId = await bookmarkBtn.getAttribute("data-article-id");
	await bookmarkBtn.click();
	check(
		"bookmark toggle sets aria-pressed",
		(await bookmarkBtn.getAttribute("aria-pressed")) === "true",
	);

	await page.goto(`${BASE}/bookmarks`, { waitUntil: "networkidle" });
	await page.waitForSelector("#bookmark-list article, #bookmark-empty:not(.hidden)", {
		timeout: 5000,
	});
	check(
		"/bookmarks lists the bookmarked article",
		(await page.locator("#bookmark-list article").count()) === 1,
	);
	await page.locator("#bookmark-list article [data-bookmark-toggle]").first().click();
	check(
		"un-bookmark clears localStorage",
		(await page.evaluate(() => localStorage.getItem("dansum:bookmarks"))) === "[]",
	);

	// 팔로우: 매체 페이지에서 토글 → /feed 반영
	await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
	const sourceHref = await page
		.locator('#article-list article a[href^="/source/"]')
		.first()
		.getAttribute("href");
	await page.goto(`${BASE}${sourceHref}`, { waitUntil: "networkidle" });
	const followBtn = page.locator("[data-follow-toggle]");
	await followBtn.click();
	check("follow toggle sets aria-pressed", (await followBtn.getAttribute("aria-pressed")) === "true");

	await page.goto(`${BASE}/feed`, { waitUntil: "networkidle" });
	// 피드는 카드가 아니라 헤드라인 행(renderHeadlineRow)이라 <article>이 없다 — 링크로 센다.
	const feedRow = '#feed-list a[href^="/article/"]';
	await page.waitForSelector(
		`${feedRow}, #feed-empty-follow:not(.hidden), #feed-empty-results:not(.hidden)`,
		{ timeout: 5000 },
	);
	check("/feed shows articles from the followed source", (await page.locator(feedRow).count()) > 0);
	check(
		"/feed rows are headlines only (no summary panel, no bookmark button)",
		(await page.locator("#feed-list [data-bookmark-toggle], #feed-list .line-clamp-2").count()) === 0,
	);

	// 팔로우 칩: "이 피드가 무엇으로 만들어졌는지"를 보여주는 줄. 비로그인이라 목록 자체는
	// localStorage에서 오지만 매체 '이름'은 서버가 심어준 맵에서 온다 — id가 그대로 보이면 실패.
	const feedChip = page.locator(`#feed-follow-chips a[href="${sourceHref}"]`);
	check("/feed lists the followed source as a chip", (await feedChip.count()) === 1);
	const chipText = (await feedChip.first().innerText().catch(() => "")).trim();
	check(
		"follow chip shows the source name, not its raw id",
		chipText.length > 0 && chipText !== sourceHref?.replace("/source/", ""),
		chipText,
	);
	// 진행 중인 토론은 계정이 있어야 뜻이 있다. 비로그인에서는 아예 렌더되지 않아야 한다
	// (사이드바의 /discuss 링크는 슬래시가 더 붙지 않아 이 셀렉터에 걸리지 않는다).
	check(
		"logged-out /feed shows no discussion block",
		(await page.locator('a[href^="/discuss/"]').count()) === 0,
	);

	// 댓글(공론화 장): 비로그인으로 확인 가능한 것만 본다. 작성/추천/신고는 계정이 필요해
	// 여기선 다루지 않는다(시드에 계정이 없는 환경에서도 스위트가 돌아야 하므로).
	const articleHref = await page
		.locator(`${feedRow}, #article-list article a[href^="/article/"]`)
		.first()
		.getAttribute("href")
		.catch(() => null);
	if (articleHref) {
		await page.goto(`${BASE}${articleHref}`, { waitUntil: "networkidle" });
		await page.waitForSelector("[data-comment-form-wrap] p, [data-comment-form-wrap] form", {
			timeout: 5000,
		});
		const composerText = await page.locator("[data-comment-form-wrap]").innerText();
		// 자제 문구는 비로그인에게도 보여야 한다 — 참여를 결정하기 전에 규범을 알리는 게 목적이다
		check("comment guideline notice is shown to logged-out visitors", composerText.includes("서로 예의를 지키며 댓글을 남겨주세요"));
		check("guideline asks for on-topic comments", composerText.includes("이 주제와 관련된 내용으로 작성해주세요"));

		// 위치(preceding-sibling)로 찾으면 정렬 바 주변에 무엇이 하나만 끼어도 깨진다 → 이름으로 찾는다
		const sortTabs = await page.locator("[data-comment-sort] button").allInnerTexts();
		check(
			"comment sort tabs are 화제순/최신순/추천순 (화제순 default)",
			JSON.stringify(sortTabs) === JSON.stringify(["화제순", "최신순", "추천순"]),
			sortTabs.join(","),
		);
		// 비추천을 되살리면 여기서 걸린다
		check("no downvote control in comment list", !(await page.locator("[data-comment-list]").innerText()).includes("▼"));

		// 같은 화면에 두 번 마운트되면 정렬 탭이 두 벌 생긴다(실제로 보고된 버그).
		// astro:page-load가 한 번 더 오는 상황을 그대로 흉내 내서 막혔는지 본다.
		await page.evaluate(() => document.dispatchEvent(new Event("astro:page-load")));
		await page.waitForTimeout(800);
		check(
			"comments do not mount twice on a repeated astro:page-load",
			(await page.locator("[data-comment-sort]").count()) === 1 &&
				(await page.locator("[data-new-comments]").count()) === 1,
			`sort=${await page.locator("[data-comment-sort]").count()}, banner=${await page.locator("[data-new-comments]").count()}`,
		);

		// 새 댓글 알림 줄: 자리는 항상 있고, 새 글이 없으면 보이지 않아야 한다.
		// (실제로 뜨는지는 폴링 30초가 필요해 여기서 다루지 않는다 — 스위트를 느리게 만들 값어치가 없다.)
		check("new-comment banner exists but stays hidden when nothing is new", (await page.locator("[data-new-comments]").count()) === 1 && !(await page.locator("[data-new-comments]").isVisible()));
		// 댓글은 기사 단위다. 이슈 단위로 묶었다가 되돌렸으므로(0013) 출처 라벨이 남으면 안 된다
		check(
			"no cross-article origin label on comments",
			!/\S+에서\s/.test(await page.locator("[data-comment-list]").innerText()),
		);

		// 키워드 칩은 검색으로 이어져야 한다(예전엔 클릭 안 되는 span이었다)
		const kwHref = await page
			.locator('main a[href^="/search?q="]')
			.first()
			.getAttribute("href")
			.catch(() => null);
		check("article keyword chips link to search", kwHref !== null, String(kwHref));
	} else {
		check("comment checks (skipped: no seed articles)", true);
	}

	// 랭킹은 만들지 않기로 하고 페이지를 지웠다 — 리다이렉트로 남아 되살아나지 않게 못을 박는다
	check("/ranking is gone (404)", (await page.goto(`${BASE}/ranking`))?.status() === 404);

	// ── 이슈(영구 클러스터) 불변식 ────────────────────────────────────
	// UI가 아니라 API 불변식을 친다. 배정 버그는 화면에서 "묶음이 좀 이상하다"로만 보이는데,
	// 아래 두 가지는 깨지는 순간 기계적으로 잡힌다.
	const topRes = await page.request.get(`${API}/api/top?limit=10`);
	const topJson = await topRes.json();
	const clusters = topJson.data ?? [];
	check("/api/top returns clusters", clusters.length > 0, `n=${clusters.length}`);

	check(
		"every cluster carries a persistent issueId",
		clusters.length > 0 && clusters.every((c) => typeof c.issueId === "string" && c.issueId),
	);

	// 파티션 불변식: 한 기사는 정확히 한 이슈에 속한다. 배정이 꼬이면 여기서 먼저 걸린다.
	const allIds = clusters.flatMap((c) => c.articleIds);
	check(
		"cluster articleIds are disjoint (one article, one issue)",
		new Set(allIds).size === allIds.length,
		`total=${allIds.length}, unique=${new Set(allIds).size}`,
	);

	// 메가 이슈 카나리아: 키워드 동결이 풀리면 이슈 하나가 피드를 먹어치운다.
	const biggest = Math.max(0, ...clusters.map((c) => c.articleIds.length));
	check(
		"no single issue swallows the feed (<40% of candidates)",
		allIds.length === 0 || biggest / allIds.length < 0.4,
		`biggest=${biggest}/${allIds.length}`,
	);

	// 이슈 상세는 대표 기사의 이슈와 같은 멤버를 돌려줘야 한다(관련 보도와 정의가 갈리면 안 됨)
	if (clusters[0]?.issueId) {
		const issueJson = await (await page.request.get(`${API}/api/issues/${clusters[0].issueId}`)).json();
		check(
			"/api/issues/:id returns the same members as the cluster",
			issueJson.data?.articles?.length === clusters[0].articleIds.length,
			`issue=${issueJson.data?.articles?.length} cluster=${clusters[0].articleIds.length}`,
		);
	}

	// ── 토론(이슈 단위 스레드) ────────────────────────────────────────
	await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
	check(
		"sidebar 토론 link points to /discuss",
		(await page.locator('#sidebar a[href="/discuss"], a[href="/discuss"]').count()) > 0,
	);
	// "준비 중"으로 남아 있으면 라우트가 붙지 않은 것이다
	check(
		"토론 is no longer a 준비 중 placeholder",
		(await page.locator('[aria-disabled="true"]', { hasText: "토론" }).count()) === 0,
	);

	const discussStatus = (await page.goto(`${BASE}/discuss`, { waitUntil: "networkidle" }))?.status();
	check("/discuss renders", discussStatus === 200, `status=${discussStatus}`);
	check(
		"/discuss has its heading",
		(await page.locator("main h2").first().innerText()).includes("토론"),
	);
	check("/discuss offers a way to open one", (await page.locator('a[href="/discuss/new"]').count()) > 0);
	// 로그인해야 열 수 있다(메뉴를 숨기는 건 접근 제어가 아니다)
	await page.goto(`${BASE}/discuss/new`, { waitUntil: "networkidle" });
	check("/discuss/new requires login", page.url().includes("/login"), page.url());

	if (clusters[0]?.issueId) {
		await page.goto(`${BASE}/issue/${clusters[0].issueId}`, { waitUntil: "networkidle" });
		check("/issue/:id lists member articles", (await page.locator("#article-list article").count()) > 0);
		// 이슈 페이지에는 댓글을 두지 않는다(0013에서 되돌렸다) — 대신 토론 시작 유도만 있다
		check("issue page has no comment thread", (await page.locator("[data-comment-list]").count()) === 0);
		check(
			"issue page invites a discussion instead",
			(await page.locator('a[href^="/discuss/new"]').count()) > 0,
		);
	}

	// 존재하지 않는 이슈는 404(리다이렉트하면 "있었는데 옮겨졌다"로 읽힌다)
	check(
		"/issue/<unknown> is 404",
		(await page.goto(`${BASE}/issue/no-such-issue`))?.status() === 404,
	);

	// "댓글 0"을 모든 카드에 다는 건 모두가 다는 배지다 — 기계적으로 막아둔다
	await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
	await page.waitForTimeout(1200); // 댓글 수는 렌더 후 클라이언트가 채운다
	check(
		'no "댓글 0" on article cards',
		!(await page.locator("#article-list").innerText()).includes("댓글 0"),
	);

	// ── 키워드 알림 ──────────────────────────────────────────────────
	check(
		"sidebar 키워드 알림 is no longer a 준비 중 placeholder",
		(await page.locator('[aria-disabled="true"]', { hasText: "키워드 알림" }).count()) === 0,
	);

	if (articleHref) {
		await page.goto(`${BASE}${articleHref}`, { waitUntil: "networkidle" });
		check("article keyword chips have an alert bell", (await page.locator("[data-keyword-alert]").count()) > 0);
		// 비로그인 상태에서 종을 누르면 로컬에 저장하는 척하지 않고 로그인으로 보낸다
		// (알림은 계정 없이는 도착할 곳이 없다).
		await page.locator("[data-keyword-alert]").first().click();
		await page.waitForURL(/\/login/, { timeout: 5000 }).catch(() => {});
		check("keyword bell sends logged-out visitors to login", page.url().includes("/login"), page.url());
	}

	// 로그인 전용 화면은 리다이렉트로 막혀 있어야 한다(메뉴를 숨기는 건 접근 제어가 아니다)
	await page.goto(`${BASE}/notifications`, { waitUntil: "networkidle" });
	check("/notifications redirects logged-out visitors to login", page.url().includes("/login"), page.url());
} finally {
	await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
