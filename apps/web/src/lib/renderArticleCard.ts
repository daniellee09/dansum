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

	const time = document.createElement("time");
	time.className = "mt-1 block text-[13px] text-text-secondary tabular-nums";
	time.textContent = formatRelativeTime(a.publishedAt);

	headText.append(nameRow, time);
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
