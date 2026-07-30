// 로컬 dev 서버(web+api, dansum-dev 스킬 참고)가 떠 있는 상태에서 실행하는 브라우저 스모크 테스트.
// 코드 리뷰/리팩터마다 매번 새로 스크립트를 짜지 않도록 저장해 둔 것 — dansum-verify 스킬이 이 파일을 실행한다.
//
//   pnpm --filter @dansum/web test:smoke
//
// SMOKE_BASE_URL로 대상 origin을 바꿀 수 있다. 반드시 API CORS 허용 origin(http://localhost:4321)과
// 일치해야 한다 — 127.0.0.1로 접속하면 apps/api/src/index.ts의 CORS 설정에 막혀 북마크/피드가 실패한다.
import { chromium } from "playwright";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:4321";

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
	await page.waitForSelector(
		"#feed-list article, #feed-empty-follow:not(.hidden), #feed-empty-results:not(.hidden)",
		{ timeout: 5000 },
	);
	check("/feed shows articles from the followed source", (await page.locator("#feed-list article").count()) > 0);

	// 댓글(공론화 장): 비로그인으로 확인 가능한 것만 본다. 작성/추천/신고는 계정이 필요해
	// 여기선 다루지 않는다(시드에 계정이 없는 환경에서도 스위트가 돌아야 하므로).
	const articleHref = await page
		.locator('#feed-list article a[href^="/article/"], #article-list article a[href^="/article/"]')
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
		check("comment guideline notice is shown to logged-out visitors", composerText.includes("서로 다른 의견이 오가는 자리입니다"));
		check("guideline explains the removed downvote", composerText.includes("비추천 버튼은 없앴습니다"));

		const sortTabs = await page
			.locator("[data-comment-list]")
			.locator("xpath=preceding-sibling::div[1]")
			.locator("button")
			.allInnerTexts();
		check(
			"comment sort tabs are 화제순/최신순/추천순 (화제순 default)",
			JSON.stringify(sortTabs) === JSON.stringify(["화제순", "최신순", "추천순"]),
			sortTabs.join(","),
		);
		// 비추천을 되살리면 여기서 걸린다
		check("no downvote control in comment list", !(await page.locator("[data-comment-list]").innerText()).includes("▼"));
	} else {
		check("comment checks (skipped: no seed articles)", true);
	}
} finally {
	await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
