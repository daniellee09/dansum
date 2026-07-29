/**
 * 댓글(1단 대댓글) + 추천/비추천. 클라이언트에서 전부 그린다(계정 데이터라 SSR 없이
 * bookmarks.astro/feed.astro와 같은 방식 — mypage 등과 달리 여기선 초기 렌더도 클라이언트가 맡는다).
 * 작성/투표/삭제 후에는 매번 목록을 다시 불러와 그린다(부분 DOM 패치 대신 전체 재렌더로 단순화).
 */

import { formatRelativeTime } from "@dansum/shared";
import { isLoggedIn } from "./auth";
import { getInitialAvatar } from "./userAvatar";

interface CommentDTO {
	id: string;
	articleId: string;
	author: { id: string; nickname: string };
	parentCommentId: string | null;
	body: string;
	status: "active" | "deleted";
	score: number;
	createdAt: string;
	isOwner: boolean;
	viewerVote: 1 | -1 | 0;
	replies: CommentDTO[];
}

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

async function fetchComments(articleId: string, sort: "latest" | "top"): Promise<CommentDTO[]> {
	const res = await fetch(`/api/comments?articleId=${encodeURIComponent(articleId)}&sort=${sort}`);
	if (!res.ok) return [];
	const data = (await res.json()) as { comments?: CommentDTO[] };
	return Array.isArray(data.comments) ? data.comments : [];
}

function countAll(comments: CommentDTO[]): number {
	let n = 0;
	for (const c of comments) n += 1 + c.replies.length;
	return n;
}

function renderComment(c: CommentDTO, articleId: string, depth: number, refresh: () => void): HTMLElement {
	const avatar = getInitialAvatar(c.author.id, c.author.nickname);
	const wrap = el("div", "flex gap-3 py-4");
	wrap.dataset.commentId = c.id;

	const avatarEl = el("span", "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white", avatar.initial);
	avatarEl.style.backgroundColor = avatar.color;
	wrap.appendChild(avatarEl);

	const body = el("div", "min-w-0 flex-1");
	wrap.appendChild(body);

	const head = el("div", "flex items-center gap-2 text-sm");
	head.appendChild(el("span", "font-semibold text-text", c.author.nickname));
	head.appendChild(el("span", "text-text-secondary text-xs", formatRelativeTime(c.createdAt)));
	body.appendChild(head);

	const bodyText = el(
		"p",
		c.status === "deleted" ? "text-[15px] mt-1 text-text-secondary italic" : "text-[15px] mt-1 whitespace-pre-wrap break-words",
		c.status === "deleted" ? "삭제된 댓글입니다" : c.body,
	);
	body.appendChild(bodyText);

	if (c.status !== "deleted") {
		const actions = el("div", "mt-2 flex items-center gap-3 text-xs text-text-secondary");

		const upBtn = el("button", `hover:text-brand transition-colors ${c.viewerVote === 1 ? "text-brand font-bold" : ""}`, "▲");
		upBtn.type = "button";
		const scoreEl = el("span", "tabular-nums", String(c.score));
		const downBtn = el("button", `hover:text-hot transition-colors ${c.viewerVote === -1 ? "text-hot font-bold" : ""}`, "▼");
		downBtn.type = "button";

		const vote = async (value: 1 | -1) => {
			if (!isLoggedIn()) {
				window.location.href = `/login?redirect=${encodeURIComponent(location.pathname)}`;
				return;
			}
			await fetch(`/api/comments/${c.id}/vote`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ value }),
			}).catch(() => {});
			refresh();
		};
		upBtn.addEventListener("click", () => vote(1));
		downBtn.addEventListener("click", () => vote(-1));
		actions.append(upBtn, scoreEl, downBtn);

		if (depth === 0) {
			const replyBtn = el("button", "hover:text-text transition-colors", "답글");
			replyBtn.type = "button";
			replyBtn.addEventListener("click", () => {
				if (!isLoggedIn()) {
					window.location.href = `/login?redirect=${encodeURIComponent(location.pathname)}`;
					return;
				}
				replyForm.classList.toggle("hidden");
				if (!replyForm.classList.contains("hidden")) replyForm.querySelector("textarea")?.focus();
			});
			actions.appendChild(replyBtn);
		}

		if (c.isOwner) {
			const deleteBtn = el("button", "hover:text-hot transition-colors", "삭제");
			deleteBtn.type = "button";
			deleteBtn.addEventListener("click", async () => {
				if (!confirm("댓글을 삭제할까요?")) return;
				await fetch(`/api/comments/${c.id}`, { method: "DELETE" }).catch(() => {});
				refresh();
			});
			actions.appendChild(deleteBtn);
		}

		body.appendChild(actions);
	}

	const replyForm = el("form", "hidden mt-2 flex flex-col gap-2");
	const textarea = el("textarea", "w-full rounded-md border border-border bg-surface-alt px-3 py-2 text-sm outline-none focus:border-brand focus:bg-surface focus:ring-2 focus:ring-brand/40");
	textarea.rows = 2;
	textarea.placeholder = "답글을 입력하세요";
	const replySubmit = el("button", "self-end rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:brightness-110 transition-colors", "등록");
	replySubmit.type = "submit";
	replyForm.append(textarea, replySubmit);
	replyForm.addEventListener("submit", async (e) => {
		e.preventDefault();
		const text = textarea.value.trim();
		if (!text) return;
		await submitComment(articleId, text, c.id);
		refresh();
	});
	body.appendChild(replyForm);

	if (c.replies.length > 0) {
		const repliesWrap = el("div", "mt-2 pl-4 border-l border-border divide-y divide-border");
		for (const reply of c.replies) repliesWrap.appendChild(renderComment(reply, articleId, depth + 1, refresh));
		body.appendChild(repliesWrap);
	}

	return wrap;
}

async function submitComment(articleId: string, body: string, parentCommentId: string | null): Promise<void> {
	await fetch("/api/comments", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ articleId, body, parentCommentId }),
	}).catch(() => {});
}

export async function mountComments(container: HTMLElement, articleId: string): Promise<void> {
	const countEl = container.querySelector<HTMLElement>("[data-comment-count]");
	const listEl = container.querySelector<HTMLElement>("[data-comment-list]");
	const formWrap = container.querySelector<HTMLElement>("[data-comment-form-wrap]");
	if (!listEl) return;

	let sort: "latest" | "top" = "latest";

	const refresh = async () => {
		const comments = await fetchComments(articleId, sort);
		if (countEl) countEl.textContent = String(countAll(comments));
		listEl.innerHTML = "";
		if (comments.length === 0) {
			listEl.appendChild(el("p", "py-8 text-center text-sm text-text-secondary", "첫 댓글을 남겨보세요"));
			return;
		}
		const wrap = el("div", "divide-y divide-border");
		for (const c of comments) wrap.appendChild(renderComment(c, articleId, 0, refresh));
		listEl.appendChild(wrap);
	};

	// 정렬 탭(기본 최신순). SortTabs.astro와 같은 밑줄 탭 시각 언어를 쓰되, 여기는
	// 페이지 이동 없이 JS로 다시 불러오는 위젯이라 <a href> 대신 버튼으로 구현한다.
	const SORT_TABS: Array<{ key: "latest" | "top"; label: string }> = [
		{ key: "latest", label: "최신순" },
		{ key: "top", label: "추천순" },
	];
	const sortBar = el("div", "mb-3 flex items-center gap-4 text-sm");
	const tabButtons = SORT_TABS.map((tab) => {
		const btn = el("button", undefined, tab.label);
		btn.type = "button";
		sortBar.appendChild(btn);
		return btn;
	});
	const syncTabStyles = () => {
		tabButtons.forEach((btn, i) => {
			const active = SORT_TABS[i].key === sort;
			btn.className = `border-b-2 px-0.5 py-2 font-semibold transition-colors ${active ? "border-text text-text" : "border-transparent text-text-secondary hover:text-text"}`;
		});
	};
	tabButtons.forEach((btn, i) => {
		btn.addEventListener("click", () => {
			if (sort === SORT_TABS[i].key) return;
			sort = SORT_TABS[i].key;
			syncTabStyles();
			refresh();
		});
	});
	syncTabStyles();
	listEl.before(sortBar);

	if (formWrap) {
		formWrap.innerHTML = "";
		if (isLoggedIn()) {
			const form = el("form", "flex flex-col gap-2");
			const textarea = el(
				"textarea",
				"w-full rounded-md border border-border bg-surface-alt px-3 py-2.5 text-[15px] outline-none focus:border-brand focus:bg-surface focus:ring-2 focus:ring-brand/40",
			);
			textarea.rows = 3;
			textarea.placeholder = "댓글을 입력하세요";
			const submitBtn = el(
				"button",
				"self-end rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:brightness-110 transition-colors",
				"댓글 등록",
			);
			submitBtn.type = "submit";
			form.append(textarea, submitBtn);
			form.addEventListener("submit", async (e) => {
				e.preventDefault();
				const text = textarea.value.trim();
				if (!text) return;
				await submitComment(articleId, text, null);
				textarea.value = "";
				refresh();
			});
			formWrap.appendChild(form);
		} else {
			const prompt = el("p", "text-sm text-text-secondary");
			const link = el("a", "text-brand hover:underline", "로그인");
			link.href = `/login?redirect=${encodeURIComponent(location.pathname)}`;
			prompt.append("댓글을 작성하려면 ", link, "이 필요합니다");
			formWrap.appendChild(prompt);
		}
	}

	await refresh();
}
