/**
 * 댓글(다단 스레드) + 추천 + 신고. 클라이언트에서 전부 그린다(계정 데이터라 SSR 없이
 * bookmarks.astro/feed.astro와 같은 방식 — mypage 등과 달리 여기선 초기 렌더도 클라이언트가 맡는다).
 *
 * 설계 의도(공론화 장): 비추천을 없앴고, 기본 정렬은 '동의가 많은 댓글'이 아니라
 * '논의가 붙은 댓글'을 올리는 화제순이다. 반대는 답글로, 규칙 위반은 신고로 간다.
 *
 * 재렌더 정책: 작성/삭제만 목록을 다시 불러온다. 추천·신고는 제자리 패치다 —
 * 화제순에선 추천 한 번에 순위가 바뀌어 커서 밑에서 댓글이 튀고, 열어둔 답글 폼과
 * 펼쳐보기가 전부 닫히기 때문이다.
 *
 * 남의 새 댓글도 같은 이유로 **자동으로 끼워넣지 않는다**. 조용히 확인만 하고
 * "새 댓글 N개" 버튼을 띄운 뒤, 반영 시점은 읽는 사람이 고르게 한다(§실시간 반영).
 */

import type { CommentDTO, CommentSort, ReportReason } from "@dansum/shared";
import {
	COMMENT_MAX_LENGTH,
	COMMENT_SORTS,
	DEFAULT_COMMENT_SORT,
	MAX_REPLY_DEPTH,
	REPORT_REASONS,
	formatRelativeTime,
	getLevel,
	getGradeByLevel,
} from "@dansum/shared";
import { isLoggedIn } from "./auth";
import { detectTone } from "./tone";
import { getInitialAvatar } from "./userAvatar";

const GUIDELINES = [
	"서로 예의를 지키며 댓글을 남겨주세요",
	// 기사와 토론이 같은 모듈을 쓰므로 "기사"라고 못 박지 않는다.
	"이 주제와 관련된 내용으로 작성해주세요",
];

// ── 실시간 반영 ────────────────────────────────────────────────
//
// 웹소켓(Durable Objects)을 쓰지 않는다. 지금 규모에서 스레드 하나에 상시 연결을 유지할
// 이유가 없고, 얻는 것은 "30초 빠름"뿐이다. 대신 조용한 폴링으로 새 댓글이 있는지만 보고,
// 화면을 다시 그리는 시점은 읽는 사람이 고른다.
//
// 폴링이 새는 것을 막는 장치 셋:
//  1) 숨은 탭에서는 건너뛴다(백그라운드 탭 수십 개가 계속 두드리지 않게)
//  2) 마지막 활동에서 POLL_IDLE_STOP_MS가 지나면 아예 멈춘다 — 밤새 열어둔 탭이
//     영원히 요청을 보내는 게 이 방식의 진짜 위험이다. 돌아오면 다시 시작한다.
//  3) 페이지를 떠날 때(astro:before-swap) 반드시 정리한다. 안 하면 클라이언트 라우팅으로
//     이동할 때마다 죽은 DOM을 붙잡은 타이머가 하나씩 쌓인다.
const POLL_INTERVAL_MS = 30_000;
const POLL_IDLE_STOP_MS = 5 * 60_000;

const REPLY_GUIDELINE = "예의를 지키며 주제와 관련된 답글을 남겨주세요";

/**
 * 들여쓰기를 멈추는 깊이. 서버가 허용하는 MAX_REPLY_DEPTH(20단)와 다른 숫자다 —
 * **얼마나 깊이 대화할 수 있는가**와 **얼마나 깊이 들여쓸 것인가**는 다른 문제다.
 *
 * 한 단에 1rem씩 밀리는데 좁은 화면(360px)에서 다섯 단을 넘기면 본문이 한 줄에 몇 자
 * 남지 않는다. 그래서 여기서부터는 나란히 세우고, 대신 머리줄에 "↳ 닉네임"을 달아
 * 누구에게 하는 말인지를 들여쓰기 대신 글자로 알려준다.
 */
const MAX_INDENT_DEPTH = 4;

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

/** 댓글이 달리는 대상. 기사 하나이거나 토론 글 하나다. */
export type CommentScope = { articleId: string } | { discussionId: string };

function scopeQuery(scope: CommentScope): string {
	return "articleId" in scope
		? `articleId=${encodeURIComponent(scope.articleId)}`
		: `discussionId=${encodeURIComponent(scope.discussionId)}`;
}

async function fetchComments(scope: CommentScope, sort: CommentSort): Promise<CommentDTO[]> {
	const res = await fetch(`/api/comments?${scopeQuery(scope)}&sort=${sort}`);
	if (!res.ok) return [];
	const data = (await res.json()) as { comments?: CommentDTO[] };
	return Array.isArray(data.comments) ? data.comments : [];
}

/** 헤더의 "댓글 N". 가려진 댓글은 빼서 카드의 숫자(counts 엔드포인트)와 뜻이 어긋나지 않게 한다. */
function countAll(comments: CommentDTO[]): number {
	let n = 0;
	for (const c of comments) {
		if (!c.isHidden) n += 1;
		n += countAll(c.replies); // 답글의 답글까지 센다
	}
	return n;
}

/** 답글까지 포함한 모든 댓글 id. "무엇이 새로 생겼나"를 세는 기준이다 — 개수 비교로는
 *  누가 하나 지우고 누가 하나 쓴 경우(증감 0)를 놓친다. */
function allCommentIds(comments: CommentDTO[]): Set<string> {
	const ids = new Set<string>();
	const walk = (list: CommentDTO[]) => {
		for (const c of list) {
			ids.add(c.id);
			walk(c.replies);
		}
	};
	walk(comments);
	return ids;
}

function goLogin(): void {
	window.location.href = `/login?redirect=${encodeURIComponent(location.pathname)}`;
}

// ── 작성 폼 ───────────────────────────────────────────────────

/** 루트 폼과 답글 폼을 한 함수로 합친다. 예전엔 두 벌이 클래스까지 어긋난 채 중복돼 있어서
 *  가이드/글자수/에러/넛지를 넣으려면 같은 걸 두 번 써야 했다. */
function createComposer(opts: {
	scope: CommentScope;
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
		const list = el("ul", "space-y-0.5 text-[13px] leading-relaxed text-text-secondary");
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
			body: { ...opts.scope, body: text, parentCommentId: opts.parentCommentId },
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

interface FlatReply {
	node: CommentDTO;
	parentNickname: string;
	/** 화면에서는 평평해도 서버가 보는 진짜 단수는 그대로 들고 간다(답글 버튼 판정용) */
	depth: number;
}

/** 자손 전체를 DFS 순서로 편다. 들여쓰기를 멈춘 지점 아래에서만 쓴다. */
function flattenDescendants(c: CommentDTO, depth: number, out: FlatReply[]): void {
	for (const r of c.replies) {
		out.push({ node: r, parentNickname: c.author.nickname, depth: depth + 1 });
		flattenDescendants(r, depth + 1, out);
	}
}

function renderComment(
	c: CommentDTO,
	scope: CommentScope,
	depth: number,
	refresh: () => void,
	/** 들여쓰기가 멈춘 뒤 "↳ 누구에게"를 표시하려고 부모의 닉네임을 넘겨받는다 */
	parentNickname?: string,
	/** 이미 조상이 자손을 평평하게 펴놨다는 표시 — 자기 자식을 또 그리면 두 번 나온다 */
	alreadyFlattened = false,
): HTMLElement {
	const renderReplies = (into: HTMLElement) => {
		if (alreadyFlattened || c.replies.length === 0) return;

		// 자식은 부모의 '본문 칸' 안에 들어가므로, pl-4를 빼도 아바타 폭(약 44px)만큼은
		// 계속 밀린다. 그래서 상한에 닿으면 클래스만 바꾸는 게 아니라 자손 전체를 꺼내
		// 한 상자에 나란히 세운다. 이래야 들여쓰기가 진짜로 멈춘다.
		if (depth >= MAX_INDENT_DEPTH) {
			const flat: FlatReply[] = [];
			flattenDescendants(c, depth, flat);
			const flatWrap = el("div", "mt-2 divide-y divide-border");
			for (const item of flat) {
				flatWrap.appendChild(
					renderComment(item.node, scope, item.depth, refresh, item.parentNickname, true),
				);
			}
			into.appendChild(flatWrap);
			return;
		}

		const wrapEl = el("div", "mt-2 pl-4 border-l border-border divide-y divide-border");
		for (const reply of c.replies) {
			wrapEl.appendChild(renderComment(reply, scope, depth + 1, refresh, c.author.nickname));
		}
		into.appendChild(wrapEl);
	};

	const avatar = getInitialAvatar(c.author.id, c.author.nickname);
	const wrap = el("div", "flex gap-3 py-4");
	wrap.dataset.commentId = c.id;
	// 퍼머링크 대상. 답글 알림이 /article/<id>#comment-<id>로 오면 focusHashComment가 여기로 스크롤한다.
	wrap.id = `comment-${c.id}`;

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
	// 들여쓰기가 멈춘 뒤로는 위치만으로 상대를 알 수 없다. 그때만 붙인다 —
	// 얕은 곳에서도 달면 모든 답글에 붙는 배지가 되어 아무 정보도 주지 않는다.
	if (depth > MAX_INDENT_DEPTH && parentNickname) {
		head.appendChild(el("span", "text-text-secondary text-xs", `↳ ${parentNickname}`));
	}
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

		// 가려진 글의 답글은 잘못한 게 없는 다른 사람들의 글이라 그대로 보여준다
		renderReplies(body);
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

		// 답글의 답글을 허용한다(레딧·긱뉴스식). 서버 상한에 닿은 마지막 단에서만 버튼을
		// 빼는데, 눌러봤자 "너무 깊어졌습니다"만 돌아오기 때문이다.
		if (depth < MAX_REPLY_DEPTH) {
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

	if (depth < MAX_REPLY_DEPTH && c.status !== "deleted") {
		replyForm = createComposer({
			scope,
			parentCommentId: c.id,
			variant: "reply",
			onPosted: refresh,
		});
		replyForm.classList.add("hidden", "mt-2");
		body.appendChild(replyForm);
	}

	renderReplies(body);

	return wrap;
}

// ── 마운트 ────────────────────────────────────────────────────

export async function mountComments(container: HTMLElement, scope: CommentScope): Promise<void> {
	const countEl = container.querySelector<HTMLElement>("[data-comment-count]");
	const listEl = container.querySelector<HTMLElement>("[data-comment-list]");
	const formWrap = container.querySelector<HTMLElement>("[data-comment-form-wrap]");
	if (!listEl) return;

	// 같은 DOM에 두 번 마운트하지 않는다.
	//
	// astro:page-load는 한 화면에서 두 번 올 수 있다. 대표적인 경우가 탭을 열어둔 채 새 버전이
	// 배포됐을 때다 — 클라이언트 라우팅으로 옮겨가면 구/신 페이지 모듈이 둘 다 살아 있어
	// 리스너가 두 벌 등록된다. 그러면 이 함수가 listEl.before(...)로 끼워 넣는 정렬 탭과
	// 새 댓글 줄이 두 개씩 생기고(실제로 보고됨), 폴링 타이머도 둘이 돌면서 그중 하나는
	// astro:before-swap 정리({ once: true })를 받지 못해 그대로 샌다.
	//
	// "리스너가 정확히 한 번만 등록된다"에 기대지 않는다. 그건 브라우저 모듈 캐시와 배포
	// 시점에 달린 일이라 이 컴포넌트가 보장할 수 있는 게 아니다. 화면이 바뀌면 컨테이너
	// 자체가 새로 생기므로 이 표시도 함께 사라진다.
	if (container.dataset.commentsMounted) return;
	container.dataset.commentsMounted = "true";

	let sort: CommentSort = DEFAULT_COMMENT_SORT;
	/** 지금 화면에 그려져 있는 것. 폴링이 "새 것"을 판별하는 기준선이다. */
	let shownIds = new Set<string>();

	const render = (comments: CommentDTO[]) => {
		shownIds = allCommentIds(comments);
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
		for (const c of comments) wrap.appendChild(renderComment(c, scope, 0, refresh));
		listEl.appendChild(wrap);
	};

	const refresh = async () => {
		render(await fetchComments(scope, sort));
		hideNewBanner();
		markActive();
	};

	// 정렬 탭(기본 화제순). SortTabs.astro와 같은 밑줄 탭 시각 언어를 쓰되, 여기는
	// 페이지 이동 없이 JS로 다시 불러오는 위젯이라 <a href> 대신 버튼으로 구현한다.
	const sortBar = el("div", "mb-3 flex items-center gap-4 text-sm");
	// 스모크 테스트가 이 바를 형제 위치(preceding-sibling)로 찾다가 주변에 무엇이 하나만 끼어도
	// 깨졌다. 위치가 아니라 이름으로 찾게 한다.
	sortBar.dataset.commentSort = "";
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

	// ── 새 댓글 알림 줄 ────────────────────────────────────────
	// 목록 바로 위에 끼운다. 화면에 고정하지 않는다 — 스레드에서 벌어진 일이니 스레드 안에
	// 있어야 하고, 떠 있는 배너는 읽는 동안 계속 시야에 걸린다.
	const newBanner = el("button", "hidden");
	newBanner.type = "button";
	newBanner.dataset.newComments = "";
	/** 폴링이 미리 받아둔 최신 목록. 버튼을 누르면 재요청 없이 이걸 그대로 그린다. */
	let pending: CommentDTO[] | null = null;
	const paintBanner = (n: number) => {
		newBanner.className =
			"mb-3 block w-full rounded-md border border-brand/30 bg-brand/5 px-3 py-2 text-[13px] font-semibold text-brand transition-colors hover:bg-brand/10 dark:bg-brand/10";
		newBanner.textContent = `새 댓글 ${n}개 보기`;
	};
	function hideNewBanner(): void {
		pending = null;
		newBanner.className = "hidden";
		newBanner.textContent = "";
	}
	newBanner.addEventListener("click", () => {
		if (!pending) return;
		// 여기서 정렬을 다시 태우지 않는다. 서버가 준 순서 그대로 그려야 화제순에서
		// 방금 읽던 댓글이 엉뚱한 데로 튀지 않는다.
		render(pending);
		hideNewBanner();
		markActive();
	});
	listEl.before(newBanner);

	// ── 폴링 ──────────────────────────────────────────────────
	let pollTimer: number | undefined;
	let lastActiveMs = Date.now();

	function startPolling(): void {
		if (pollTimer === undefined) pollTimer = window.setInterval(tick, POLL_INTERVAL_MS);
	}
	function stopPolling(): void {
		if (pollTimer !== undefined) window.clearInterval(pollTimer);
		pollTimer = undefined;
	}
	function markActive(): void {
		lastActiveMs = Date.now();
		startPolling();
	}

	async function tick(): Promise<void> {
		if (document.visibilityState !== "visible") return;
		if (Date.now() - lastActiveMs > POLL_IDLE_STOP_MS) {
			stopPolling();
			return;
		}
		const fresh = await fetchComments(scope, sort);
		// 빈 배열은 "댓글이 사라졌다"가 아니라 요청 실패일 수 있다(fetchComments가 []로 삼킨다).
		// 이미 그려둔 게 있는데 빈 응답이 오면 아무것도 하지 않는다.
		if (fresh.length === 0 && shownIds.size > 0) return;
		let added = 0;
		for (const id of allCommentIds(fresh)) if (!shownIds.has(id)) added += 1;
		if (added === 0) {
			// 삭제만 일어났을 수도 있다. 그건 버튼을 띄울 일이 아니라 다음 렌더에 자연히 반영된다.
			hideNewBanner();
			return;
		}
		pending = fresh;
		paintBanner(added);
	}

	// 탭으로 돌아오면 멈춰 있던 폴링을 되살리고 즉시 한 번 확인한다(30초를 기다리게 하지 않는다).
	const onVisibility = () => {
		if (document.visibilityState !== "visible") return;
		markActive();
		void tick();
	};
	document.addEventListener("visibilitychange", onVisibility);
	// 스레드를 만지는 동안은 계속 살아 있게 한다(위 2번 장치의 '활동' 정의).
	container.addEventListener("pointerdown", markActive);
	container.addEventListener("keydown", markActive);

	document.addEventListener(
		"astro:before-swap",
		() => {
			stopPolling();
			document.removeEventListener("visibilitychange", onVisibility);
		},
		{ once: true },
	);

	if (formWrap) {
		formWrap.innerHTML = "";
		if (isLoggedIn()) {
			formWrap.appendChild(
				createComposer({ scope, parentCommentId: null, variant: "root", onPosted: refresh }),
			);
		} else {
			// 비로그인에게도 규범을 먼저 보여준다 — 참여를 결정하기 전에 보여야 의미가 있다.
			const notice = el(
				"div",
				"rounded-md border border-border bg-brand/5 px-3 py-2.5 dark:bg-brand/10",
			);
			const list = el("ul", "space-y-0.5 text-[13px] leading-relaxed text-text-secondary");
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
	focusHashComment();
}

/** /article/<id>#comment-<id> 로 들어왔을 때 해당 댓글로 스크롤하고 잠깐 표시해준다.
 *  댓글 목록은 마운트 후 JS로 그려지므로 브라우저의 기본 해시 점프는 이미 지나간 뒤다. */
function focusHashComment(): void {
	if (!location.hash.startsWith("#comment-")) return;
	const target = document.getElementById(location.hash.slice(1));
	if (!target) return;
	target.scrollIntoView({ block: "center" });
	// 색을 칠하는 대신 왼쪽 선만 잠깐 준다 — "어느 것인지"만 알려주면 되고,
	// 배경을 칠하면 가려진 댓글·삭제된 댓글의 기존 표시와 신호가 겹친다.
	target.classList.add("border-l-2", "border-brand", "pl-3", "-ml-3");
	setTimeout(() => {
		target.classList.remove("border-l-2", "border-brand", "pl-3", "-ml-3");
	}, 2500);
}
