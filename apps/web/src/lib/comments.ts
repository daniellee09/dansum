/**
 * 댓글(1단 대댓글) + 추천 + 신고. 클라이언트에서 전부 그린다(계정 데이터라 SSR 없이
 * bookmarks.astro/feed.astro와 같은 방식 — mypage 등과 달리 여기선 초기 렌더도 클라이언트가 맡는다).
 *
 * 설계 의도(공론화 장): 비추천을 없앴고, 기본 정렬은 '동의가 많은 댓글'이 아니라
 * '논의가 붙은 댓글'을 올리는 화제순이다. 반대는 답글로, 규칙 위반은 신고로 간다.
 *
 * 재렌더 정책: 작성/삭제만 목록을 다시 불러온다. 추천·신고는 제자리 패치다 —
 * 화제순에선 추천 한 번에 순위가 바뀌어 커서 밑에서 댓글이 튀고, 열어둔 답글 폼과
 * 펼쳐보기가 전부 닫히기 때문이다.
 */

import type { CommentDTO, CommentSort, ReportReason } from "@dansum/shared";
import {
	COMMENT_MAX_LENGTH,
	COMMENT_SORTS,
	DEFAULT_COMMENT_SORT,
	REPORT_REASONS,
	formatRelativeTime,
	getLevel,
	getGradeByLevel,
} from "@dansum/shared";
import { isLoggedIn } from "./auth";
import { detectTone } from "./tone";
import { getInitialAvatar } from "./userAvatar";

const GUIDELINES = [
	"사람이 아니라 주장을 비판해주세요",
	"진영 라벨 대신 근거를 적어주세요",
	// 사용자가 ▼를 찾는 바로 그 순간에 부재를 설명하면서, 반대를 '억압'이 아니라 '참여'로 재정의한다
	"반대는 답글로 남겨주세요 — 비추천 버튼은 없앴습니다",
	"나와 다른 의견도 한 번 읽고 답해주세요",
];

const REPLY_GUIDELINE = "답글도 사람이 아니라 주장을 향하게 해주세요";

const NETWORK_ERROR = "네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요";

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

/** 기존 코드가 모든 fetch를 .catch(() => {})로 삼켜서 429(작성 제한)나 400(길이 초과)이
 *  사용자에게 전혀 보이지 않았다. 서버가 내려주는 error 문구를 그대로 살려 올린다. */
async function postJson<T = unknown>(
	url: string,
	init?: { method?: string; body?: unknown },
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
	try {
		const res = await fetch(url, {
			method: init?.method ?? "POST",
			...(init?.body === undefined
				? {}
				: { headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.body) }),
		});
		let data: (T & { success?: boolean; error?: string }) | null = null;
		try {
			data = (await res.json()) as T & { success?: boolean; error?: string };
		} catch {
			// 본문이 비었거나 JSON이 아닌 경우
		}
		if (!res.ok || data?.success === false) {
			return { ok: false, error: data?.error ?? "요청을 처리하지 못했습니다" };
		}
		return { ok: true, data: (data ?? ({} as T)) as T };
	} catch {
		return { ok: false, error: NETWORK_ERROR };
	}
}

async function fetchComments(articleId: string, sort: CommentSort): Promise<CommentDTO[]> {
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

function goLogin(): void {
	window.location.href = `/login?redirect=${encodeURIComponent(location.pathname)}`;
}

// ── 작성 폼 ───────────────────────────────────────────────────

/** 루트 폼과 답글 폼을 한 함수로 합친다. 예전엔 두 벌이 클래스까지 어긋난 채 중복돼 있어서
 *  가이드/글자수/에러/넛지를 넣으려면 같은 걸 두 번 써야 했다. */
function createComposer(opts: {
	articleId: string;
	parentCommentId: string | null;
	variant: "root" | "reply";
	onPosted: () => void | Promise<void>;
}): HTMLFormElement {
	const isRoot = opts.variant === "root";
	const form = el("form", "flex flex-col");

	// 문구를 textarea에 물리적으로 붙인다(아래쪽 라운딩/보더 제거). 위에 얹힌 고지가 아니라
	// 입력 컨트롤의 일부로 보여야 약관처럼 읽히지 않는다. 회색 대신 브랜드 톤을 쓰는 것도 같은 이유다.
	const notice = el(
		"div",
		"rounded-t-md border border-border border-b-0 bg-brand/5 px-3 py-2.5 dark:bg-brand/10",
	);
	if (isRoot) {
		notice.appendChild(
			el("p", "text-[13px] font-bold text-brand", "서로 다른 의견이 오가는 자리입니다"),
		);
		const list = el("ul", "mt-1 space-y-0.5 text-[13px] leading-relaxed text-text-secondary");
		for (const line of GUIDELINES) list.appendChild(el("li", undefined, `· ${line}`));
		notice.appendChild(list);
	} else {
		notice.appendChild(el("p", "text-[13px] text-text-secondary", REPLY_GUIDELINE));
	}
	form.appendChild(notice);

	// relative+focus:z-10이 없으면 맞닿은 문구 박스에 포커스 링이 잘린다
	const textarea = el(
		"textarea",
		`relative w-full rounded-b-md border border-border bg-surface-alt px-3 py-2.5 outline-none focus:z-10 focus:border-brand focus:bg-surface focus:ring-2 focus:ring-brand/40 ${isRoot ? "text-[15px]" : "text-sm"}`,
	);
	textarea.rows = isRoot ? 3 : 2;
	textarea.placeholder = isRoot ? "의견을 남겨주세요" : "답글을 입력하세요";
	textarea.maxLength = COMMENT_MAX_LENGTH;
	form.appendChild(textarea);

	const footer = el("div", "mt-2 flex items-center justify-between gap-3");
	const errorEl = el("p", "text-sm text-hot");
	errorEl.setAttribute("role", "alert");
	const right = el("div", "flex items-center gap-2");
	const counter = el(
		"span",
		"text-xs tabular-nums text-text-secondary",
		`0 / ${COMMENT_MAX_LENGTH}`,
	);
	const submitBtn = el(
		"button",
		`rounded-full bg-brand font-semibold text-white hover:brightness-110 transition-colors disabled:opacity-50 ${isRoot ? "px-4 py-2 text-sm" : "px-4 py-1.5 text-xs"}`,
		isRoot ? "댓글 등록" : "등록",
	);
	submitBtn.type = "submit";
	right.append(counter, submitBtn);
	footer.append(errorEl, right);
	form.appendChild(footer);

	textarea.addEventListener("input", () => {
		const len = textarea.value.length;
		counter.textContent = `${len} / ${COMMENT_MAX_LENGTH}`;
		counter.className =
			len >= 900
				? "text-xs tabular-nums text-hot font-semibold"
				: "text-xs tabular-nums text-text-secondary";
		if (errorEl.textContent) errorEl.textContent = "";
	});

	// 넛지 패널은 제출 행을 대체한다
	const nudge = el(
		"div",
		"hidden mt-2 rounded-md border border-brand/40 bg-brand/5 px-3 py-2.5 text-[13px] dark:bg-brand/10",
	);
	const nudgeQuestion = el("p", "mt-0.5 text-text-secondary");
	const nudgeActions = el("div", "mt-2 flex items-center justify-end gap-2");
	const backBtn = el(
		"button",
		"rounded-full border border-border px-3 py-1.5 text-xs hover:bg-surface-alt transition-colors",
		"다시 볼게요",
	);
	backBtn.type = "button";
	// 브랜드 pill 그대로 둔다. 진행 버튼을 흐리거나 빨갛게 만들면 '그대로 올리는 것'이
	// 잘못을 인정하는 느낌이 되고, 넛지가 확인이 아니라 강요가 된다.
	const proceedBtn = el(
		"button",
		"rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:brightness-110 transition-colors",
		"이대로 등록",
	);
	proceedBtn.type = "button";
	nudgeActions.append(backBtn, proceedBtn);
	nudge.append(
		el("p", "font-bold text-brand", "잠깐만요"),
		nudgeQuestion,
		el("p", "mt-1 text-xs text-text-secondary", "고쳐도 좋고, 그대로 올려도 괜찮아요."),
		nudgeActions,
	);
	form.appendChild(nudge);

	// 제출당 최대 한 번만 뜬다. 텍스트 내용으로 키를 잡으면 오타를 고칠 때마다 다시 떠서
	// 정확히 그 짜증나는 동작이 된다. 성공 제출에서만 초기화한다.
	let nudged = false;
	let sending = false;

	const send = async () => {
		if (sending) return;
		const text = textarea.value.trim();
		if (!text) return;

		sending = true;
		submitBtn.disabled = true;
		errorEl.textContent = "";

		const result = await postJson("/api/comments", {
			body: { articleId: opts.articleId, body: text, parentCommentId: opts.parentCommentId },
		});

		sending = false;
		submitBtn.disabled = false;

		if (!result.ok) {
			// 실패했으면 입력을 지우지 않는다 — 예전엔 429를 먹고도 본문이 사라졌다
			errorEl.textContent = result.error;
			return;
		}

		textarea.value = "";
		textarea.dispatchEvent(new Event("input"));
		nudged = false;
		nudge.classList.add("hidden");
		footer.classList.remove("hidden");
		await opts.onPosted();
	};

	backBtn.addEventListener("click", () => {
		nudge.classList.add("hidden");
		footer.classList.remove("hidden");
		textarea.focus();
	});
	proceedBtn.addEventListener("click", () => {
		nudge.classList.add("hidden");
		footer.classList.remove("hidden");
		void send();
	});

	form.addEventListener("submit", (e) => {
		e.preventDefault();
		const text = textarea.value.trim();
		if (!text) return;

		if (!nudged) {
			const rule = detectTone(text);
			if (rule) {
				nudged = true;
				nudgeQuestion.textContent = rule.question;
				nudge.classList.remove("hidden");
				footer.classList.add("hidden");
				return;
			}
		}
		void send();
	});

	return form;
}

// ── 댓글 렌더 ─────────────────────────────────────────────────

function renderReportPanel(commentId: string, onReported: () => void): HTMLElement {
	const panel = el("div", "hidden mt-2 rounded-md border border-border bg-surface-alt p-3");
	panel.appendChild(
		el(
			"p",
			"text-xs text-text-secondary",
			"의견이 다르다는 이유로는 신고할 수 없어요. 반론은 답글로 남겨주세요.",
		),
	);
	const chips = el("div", "mt-2 flex flex-wrap gap-1.5");
	const errorEl = el("p", "mt-2 hidden text-xs text-hot");
	errorEl.setAttribute("role", "alert");

	for (const reason of REPORT_REASONS) {
		const chip = el(
			"button",
			"rounded-full border border-border px-3 py-1 text-xs hover:border-brand hover:text-brand transition-colors disabled:opacity-50",
			reason.label,
		);
		chip.type = "button";
		chip.addEventListener("click", async () => {
			for (const b of chips.querySelectorAll("button")) b.disabled = true;
			errorEl.classList.add("hidden");

			const result = await postJson(`/api/comments/${commentId}/report`, {
				body: { reason: reason.key as ReportReason },
			});

			if (!result.ok) {
				errorEl.textContent = result.error;
				errorEl.classList.remove("hidden");
				for (const b of chips.querySelectorAll("button")) b.disabled = false;
				return;
			}
			panel.classList.add("hidden");
			onReported();
		});
		chips.appendChild(chip);
	}

	panel.append(chips, errorEl);
	return panel;
}

function renderComment(
	c: CommentDTO,
	articleId: string,
	depth: number,
	refresh: () => void,
): HTMLElement {
	const avatar = getInitialAvatar(c.author.id, c.author.nickname);
	const wrap = el("div", "flex gap-3 py-4");
	wrap.dataset.commentId = c.id;

	const avatarEl = el(
		"span",
		"flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white",
		avatar.initial,
	);
	avatarEl.style.backgroundColor = avatar.color;
	wrap.appendChild(avatarEl);

	const body = el("div", "min-w-0 flex-1");
	wrap.appendChild(body);

	const level = getLevel(c.author.exp);
	const grade = getGradeByLevel(level);
	const head = el("div", "flex items-center gap-2 text-sm");
	head.appendChild(el("span", "font-semibold text-text", c.author.nickname));
	// 초심자(가입 직후)는 칩을 달지 않는다 — 모두가 달고 있으면 정보가 되지 않는다
	if (grade.key !== "beginner") {
		head.appendChild(el("span", "text-[11px] font-semibold text-brand", `Lv.${level} ${grade.label}`));
	}
	head.appendChild(el("span", "text-text-secondary text-xs", formatRelativeTime(c.createdAt)));
	body.appendChild(head);

	// 가려진 댓글은 접어두되 지우지는 않는다 — 오탐일 수 있으니 직접 확인할 길은 남긴다.
	if (c.isHidden && c.status !== "deleted") {
		const collapsed = el("div", "mt-1");
		const notice = el("p", "text-sm text-text-secondary italic", "신고 누적된 댓글입니다");
		const toggle = el("button", "mt-1 text-xs text-brand hover:underline", "펼쳐보기");
		toggle.type = "button";
		const revealed = el(
			"p",
			"hidden mt-1 whitespace-pre-wrap break-words border-l-2 border-hot/40 pl-3 text-[15px]",
			c.body,
		);
		toggle.addEventListener("click", () => {
			const hidden = revealed.classList.toggle("hidden");
			toggle.textContent = hidden ? "펼쳐보기" : "접기";
		});
		collapsed.append(notice, toggle, revealed);
		body.appendChild(collapsed);

		if (c.replies.length > 0) {
			// 가려진 글의 답글은 잘못한 게 없는 다른 사람들의 글이라 그대로 보여준다
			const repliesWrap = el("div", "mt-2 pl-4 border-l border-border divide-y divide-border");
			for (const reply of c.replies) {
				repliesWrap.appendChild(renderComment(reply, articleId, depth + 1, refresh));
			}
			body.appendChild(repliesWrap);
		}
		return wrap;
	}

	const bodyText = el(
		"p",
		c.status === "deleted"
			? "text-[15px] mt-1 text-text-secondary italic"
			: "text-[15px] mt-1 whitespace-pre-wrap break-words",
		c.status === "deleted" ? "삭제된 댓글입니다" : c.body,
	);
	body.appendChild(bodyText);

	let replyForm: HTMLFormElement | null = null;
	let reportPanel: HTMLElement | null = null;

	if (c.status !== "deleted") {
		const actions = el("div", "mt-2 flex items-center gap-3 text-xs text-text-secondary");

		const scoreEl = el("span", "tabular-nums", String(c.score));
		if (c.isOwner) {
			// 본인 댓글은 추천할 수 없으므로(카르마 자기적립 방지) 버튼 없이 점수만 보여준다
			actions.appendChild(scoreEl);
		} else {
			let upvoted = c.viewerUpvoted;
			const upBtn = el("button", "", "▲ 추천");
			upBtn.type = "button";
			const syncUp = () => {
				upBtn.className = `transition-colors hover:text-brand ${upvoted ? "text-brand font-bold" : ""}`;
				upBtn.setAttribute("aria-pressed", String(upvoted));
			};
			syncUp();

			upBtn.addEventListener("click", async () => {
				if (!isLoggedIn()) return goLogin();
				upBtn.disabled = true;
				const result = await postJson<{ score: number; upvoted: boolean }>(
					`/api/comments/${c.id}/vote`,
				);
				upBtn.disabled = false;
				if (!result.ok) {
					// 목록을 다시 그리지 않으므로 실패는 버튼 옆에 짧게만 알린다
					upBtn.title = result.error;
					return;
				}
				// 화제순에선 전체 재렌더 시 순위가 바뀌어 댓글이 커서 밑에서 튄다 → 제자리 패치
				scoreEl.textContent = String(result.data.score);
				upvoted = result.data.upvoted;
				syncUp();
			});
			actions.append(upBtn, scoreEl);
		}

		if (depth === 0) {
			const replyBtn = el("button", "hover:text-text transition-colors", "답글");
			replyBtn.type = "button";
			replyBtn.addEventListener("click", () => {
				if (!isLoggedIn()) return goLogin();
				if (!replyForm) return;
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
				const result = await postJson(`/api/comments/${c.id}`, { method: "DELETE" });
				if (!result.ok) {
					deleteBtn.title = result.error;
					return;
				}
				refresh();
			});
			actions.appendChild(deleteBtn);
		} else if (c.viewerReported) {
			actions.appendChild(el("span", "text-text-secondary", "신고함"));
		} else {
			const reportBtn = el("button", "hover:text-hot transition-colors", "신고");
			reportBtn.type = "button";
			reportBtn.addEventListener("click", () => {
				if (!isLoggedIn()) return goLogin();
				reportPanel?.classList.toggle("hidden");
			});
			actions.appendChild(reportBtn);

			reportPanel = renderReportPanel(c.id, () => {
				// 신고 직후에도 재렌더하지 않는다(열어둔 답글 폼이 닫히므로)
				reportBtn.replaceWith(el("span", "text-text-secondary", "신고함"));
			});
		}

		body.appendChild(actions);
		if (reportPanel) body.appendChild(reportPanel);
	}

	if (depth === 0 && c.status !== "deleted") {
		replyForm = createComposer({
			articleId,
			parentCommentId: c.id,
			variant: "reply",
			onPosted: refresh,
		});
		replyForm.classList.add("hidden", "mt-2");
		body.appendChild(replyForm);
	}

	if (c.replies.length > 0) {
		const repliesWrap = el("div", "mt-2 pl-4 border-l border-border divide-y divide-border");
		for (const reply of c.replies) {
			repliesWrap.appendChild(renderComment(reply, articleId, depth + 1, refresh));
		}
		body.appendChild(repliesWrap);
	}

	return wrap;
}

// ── 마운트 ────────────────────────────────────────────────────

export async function mountComments(container: HTMLElement, articleId: string): Promise<void> {
	const countEl = container.querySelector<HTMLElement>("[data-comment-count]");
	const listEl = container.querySelector<HTMLElement>("[data-comment-list]");
	const formWrap = container.querySelector<HTMLElement>("[data-comment-form-wrap]");
	if (!listEl) return;

	let sort: CommentSort = DEFAULT_COMMENT_SORT;

	const refresh = async () => {
		const comments = await fetchComments(articleId, sort);
		if (countEl) countEl.textContent = String(countAll(comments));
		listEl.innerHTML = "";
		if (comments.length === 0) {
			const empty = el("div", "py-8 text-center");
			empty.append(
				el(
					"p",
					"text-sm text-text-secondary",
					"아직 오간 의견이 없어요. 어떻게 보셨는지 가장 먼저 들려주세요.",
				),
				el(
					"p",
					"mt-1 text-xs text-text-secondary",
					"찬성이든 반대든, 근거와 함께라면 모두 환영합니다.",
				),
			);
			listEl.appendChild(empty);
			return;
		}
		const wrap = el("div", "divide-y divide-border");
		for (const c of comments) wrap.appendChild(renderComment(c, articleId, 0, refresh));
		listEl.appendChild(wrap);
	};

	// 정렬 탭(기본 화제순). SortTabs.astro와 같은 밑줄 탭 시각 언어를 쓰되, 여기는
	// 페이지 이동 없이 JS로 다시 불러오는 위젯이라 <a href> 대신 버튼으로 구현한다.
	const sortBar = el("div", "mb-3 flex items-center gap-4 text-sm");
	const tabButtons = COMMENT_SORTS.map((tab) => {
		const btn = el("button", undefined, tab.label);
		btn.type = "button";
		sortBar.appendChild(btn);
		return btn;
	});
	const syncTabStyles = () => {
		tabButtons.forEach((btn, i) => {
			const active = COMMENT_SORTS[i].key === sort;
			btn.className = `border-b-2 px-0.5 py-2 font-semibold transition-colors ${active ? "border-text text-text" : "border-transparent text-text-secondary hover:text-text"}`;
		});
	};
	tabButtons.forEach((btn, i) => {
		btn.addEventListener("click", () => {
			if (sort === COMMENT_SORTS[i].key) return;
			sort = COMMENT_SORTS[i].key;
			syncTabStyles();
			refresh();
		});
	});
	syncTabStyles();
	listEl.before(sortBar);

	if (formWrap) {
		formWrap.innerHTML = "";
		if (isLoggedIn()) {
			formWrap.appendChild(
				createComposer({ articleId, parentCommentId: null, variant: "root", onPosted: refresh }),
			);
		} else {
			// 비로그인에게도 규범을 먼저 보여준다 — 참여를 결정하기 전에 보여야 의미가 있다.
			const notice = el(
				"div",
				"rounded-md border border-border bg-brand/5 px-3 py-2.5 dark:bg-brand/10",
			);
			notice.appendChild(
				el("p", "text-[13px] font-bold text-brand", "서로 다른 의견이 오가는 자리입니다"),
			);
			const list = el("ul", "mt-1 space-y-0.5 text-[13px] leading-relaxed text-text-secondary");
			for (const line of GUIDELINES) list.appendChild(el("li", undefined, `· ${line}`));
			notice.appendChild(list);

			const prompt = el("p", "mt-2 text-sm text-text-secondary");
			const link = el("a", "text-brand hover:underline", "로그인");
			link.href = `/login?redirect=${encodeURIComponent(location.pathname)}`;
			prompt.append("댓글을 작성하려면 ", link, "이 필요합니다");

			formWrap.append(notice, prompt);
		}
	}

	await refresh();
}
