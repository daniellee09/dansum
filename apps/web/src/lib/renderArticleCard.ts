import { CATEGORY_LABELS, formatRelativeTime } from "@dansum/shared";
import type { Article } from "@dansum/shared";
import { getSourceMeta } from "./source";

/**
 * ArticleCard.astro와 마크업이 동일한 카드를 순수 DOM으로 그려낸다.
 * localStorage 기반 목록(북마크·내 피드)과 LoadMore의 클라이언트 렌더 목록이 함께 쓴다 —
 * 셋 중 하나를 바꾸면 반드시 나머지도 동기화할 것(주석 컨벤션은 ArticleCard.astro 참고).
 */

// 주의: SourceIcon.astro와 마크업 중복 — 한쪽 수정 시 반드시 동기화
function renderSourceIcon(a: Article, size = 18): HTMLElement {
	const { initial, color, iconUrl } = getSourceMeta(a.sourceId, a.sourceUrl, a.sourceName);
	const wrap = document.createElement("span");
	wrap.className =
		"relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white leading-none";
	wrap.style.cssText = `width:${size}px;height:${size}px;background-color:${color};font-size:${Math.round(size * 0.5)}px`;
	wrap.setAttribute("aria-hidden", "true");
	wrap.textContent = initial;
	if (iconUrl) {
		const img = document.createElement("img");
		img.src = iconUrl;
		img.alt = "";
		img.loading = "lazy";
		img.width = size;
		img.height = size;
		img.className = "absolute inset-0 h-full w-full object-cover";
		img.addEventListener("error", () => img.remove());
		wrap.appendChild(img);
	}
	return wrap;
}

export function renderArticleCard(a: Article): HTMLElement {
	const article = document.createElement("article");
	article.className = "group -mx-4 px-4 py-5 transition-colors hover:bg-surface-alt";

	// 헤더: 아이콘 + 매체명·카테고리 / 시간
	const head = document.createElement("div");
	head.className = "flex items-start gap-x-2.5";

	const headText = document.createElement("div");
	headText.className = "min-w-0 flex-1 text-sm leading-tight";

	const nameRow = document.createElement("div");
	nameRow.className = "flex items-center gap-x-2";
	const src = document.createElement("a");
	src.href = `/source/${a.sourceId}`;
	src.className = "font-semibold text-text hover:text-brand hover:underline";
	src.textContent = a.sourceName;
	const cat = document.createElement("a");
	cat.href = `/category/${a.category}`;
	cat.className = "text-text-secondary hover:text-brand hover:underline";
	cat.textContent = (CATEGORY_LABELS as Record<string, string>)[a.category] ?? a.category;
	nameRow.append(src, cat);

	const metaRow = document.createElement("div");
	metaRow.className = "mt-1 flex items-center gap-x-2 text-[13px] text-text-secondary tabular-nums";
	const time = document.createElement("time");
	time.textContent = formatRelativeTime(a.publishedAt);
	// 논의가 붙었을 때만 채워진다(lib/commentCounts.ts). ArticleCard.astro와 같은 자리·같은 규칙.
	const commentCount = document.createElement("span");
	commentCount.dataset.commentCountFor = a.id;
	metaRow.append(time, commentCount);

	headText.append(nameRow, metaRow);
	// 아바타도 매체 목록으로(이름 링크와 중복 탭 정지가 되지 않게 포커스 대상에서 제외)
	const iconLink = document.createElement("a");
	iconLink.href = `/source/${a.sourceId}`;
	iconLink.tabIndex = -1;
	iconLink.setAttribute("aria-hidden", "true");
	iconLink.className = "shrink-0";
	iconLink.appendChild(renderSourceIcon(a, 26));

	const bookmarkBtn = document.createElement("button");
	bookmarkBtn.type = "button";
	bookmarkBtn.dataset.bookmarkToggle = "";
	bookmarkBtn.dataset.articleId = a.id;
	bookmarkBtn.setAttribute("aria-label", "북마크");
	bookmarkBtn.setAttribute("aria-pressed", "false");
	bookmarkBtn.className =
		"bookmark-btn shrink-0 -mr-1.5 -mt-1 w-8 h-8 flex items-center justify-center rounded-md text-text-secondary hover:text-text hover:bg-surface-alt transition-colors";
	bookmarkBtn.innerHTML =
		'<svg data-bookmark-icon class="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 4h12v16l-6-4-6 4V4z" /></svg>';

	head.append(iconLink, headText, bookmarkBtn);

	const link = document.createElement("a");
	link.href = `/article/${a.id}`;
	link.className = "block read-link mt-3.5";

	const h2 = document.createElement("h2");
	h2.className = "text-xl font-semibold leading-snug group-hover:text-brand transition-colors";
	h2.textContent = a.title;

	// 요약: 칸 안쪽 중첩 패널
	const panel = document.createElement("div");
	panel.className =
		"mt-3 rounded-md bg-surface-alt group-hover:bg-surface transition-colors px-4 py-3.5";
	const p = document.createElement("p");
	p.className = "text-[15px] text-text-secondary leading-relaxed line-clamp-2";
	p.textContent = a.summary;
	const more = document.createElement("span");
	more.className = "mt-2 inline-block text-sm font-semibold text-text underline";
	more.textContent = "더 보기";
	panel.append(p, more);

	link.append(h2, panel);

	article.append(head, link);
	return article;
}

/**
 * "내 피드"의 헤드라인 행. 요약 패널·카테고리·매체 아이콘·북마크·댓글 수를 전부 뺐다.
 *
 * 피드는 팔로우한 곳을 **훑는** 자리다. 카드마다 요약 패널과 버튼이 붙으면 무엇을 읽을지
 * 고르기도 전에 지친다. 고른 다음에 필요한 것들은 기사 화면에 그대로 있다.
 *
 * 남긴 한 줄은 매체명과 시간이다 — 여러 매체를 섞어 보여주는 목록이라 어디서 온 기사인지가
 * 제목 다음으로 중요하다(그게 없으면 이 목록은 그냥 제목 더미가 된다).
 *
 * 아래 renderCompactArticleRow와 모양이 닮았지만 합치지 않는다. 그쪽은 20rem 사이드바용이라
 * 글자가 한 단계 작고, 본문 칸에 그대로 쓰면 읽히지 않는다.
 */
export function renderHeadlineRow(a: Article): HTMLElement {
	const link = document.createElement("a");
	link.href = `/article/${a.id}`;
	link.className = "group block py-3.5";

	const title = document.createElement("p");
	title.className =
		"text-[15px] font-semibold leading-snug text-text transition-colors group-hover:text-brand";
	title.textContent = a.title;

	const meta = document.createElement("p");
	meta.className = "mt-1 text-xs text-text-secondary tabular-nums";
	meta.textContent = `${a.sourceName} · ${formatRelativeTime(a.publishedAt)}`;

	link.append(title, meta);
	return link;
}

/**
 * 20rem 폭 사이드바 위젯(홈 화면 "팔로우한 매체 최신 소식"·"최근 본 기사")용 컴팩트 행.
 * article/[id].astro 사이드바의 "다른 기사"/"관련 보도" 목록과 같은 톤(제목 line-clamp-2 +
 * 매체명·시간 한 줄)이지만 그쪽은 SSR 마크업이라 이 클라이언트 렌더 목록과는 별도로 둔다.
 */
export function renderCompactArticleRow(a: Article): HTMLElement {
	const link = document.createElement("a");
	link.href = `/article/${a.id}`;
	link.className = "block py-3 group";

	const title = document.createElement("p");
	title.className =
		"text-sm font-semibold leading-snug text-text line-clamp-2 group-hover:text-brand transition-colors";
	title.textContent = a.title;

	const meta = document.createElement("p");
	meta.className = "mt-1 text-[12px] text-text-secondary";
	meta.textContent = `${a.sourceName} · ${formatRelativeTime(a.publishedAt)}`;

	link.append(title, meta);
	return link;
}
