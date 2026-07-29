/** 알림 벨: 로그인 상태에서만 목록/뱃지를 채운다. 실시간 대신 페이지 로드 시 1회 폴링. */

import { formatRelativeTime } from "@dansum/shared";
import { isLoggedIn } from "./auth";

interface NotificationDTO {
	id: string;
	type: string;
	payload: { articleId: string; commentId: string; fromNickname: string; articleTitle: string | null };
	isRead: boolean;
	createdAt: string;
}

export async function setupNotificationBell(): Promise<void> {
	const toggle = document.getElementById("notif-bell-toggle");
	const menu = document.getElementById("notif-menu");
	const badge = document.getElementById("notif-badge");
	const list = document.getElementById("notif-list");
	const markAllBtn = document.getElementById("notif-mark-all");
	if (!toggle || !menu || !list) return;
	if (toggle.dataset.bound) return;
	toggle.dataset.bound = "true";

	if (!isLoggedIn()) {
		toggle.classList.add("hidden");
		return;
	}
	toggle.classList.remove("hidden");

	let loaded = false;

	const render = (notifications: NotificationDTO[]) => {
		list.innerHTML = "";
		if (notifications.length === 0) {
			const empty = document.createElement("p");
			empty.className = "px-3.5 py-6 text-center text-sm text-text-secondary";
			empty.textContent = "알림이 없습니다";
			list.appendChild(empty);
			return;
		}
		for (const n of notifications) {
			const a = document.createElement("a");
			a.href = `/article/${n.payload.articleId}`;
			a.className = `block px-3.5 py-2.5 text-sm hover:bg-surface-alt transition-colors ${n.isRead ? "" : "bg-brand/5"}`;
			a.addEventListener("click", () => {
				fetch(`/api/me/notifications/${n.id}/read`, { method: "POST" }).catch(() => {});
			});
			const title = n.payload.articleTitle ?? "삭제된 기사";
			const line1 = document.createElement("p");
			line1.className = "text-text";
			// fromNickname은 다른 유저가 정한 값이라 innerHTML로 합치지 않고 textContent로만 넣는다(XSS 방지)
			const nicknameEl = document.createElement("span");
			nicknameEl.className = "font-semibold";
			nicknameEl.textContent = n.payload.fromNickname;
			line1.append(nicknameEl, "님이 댓글에 답글을 남겼습니다");
			const line2 = document.createElement("p");
			line2.className = "text-text-secondary text-xs mt-0.5 truncate";
			line2.textContent = title;
			const line3 = document.createElement("p");
			line3.className = "text-text-secondary text-xs mt-0.5";
			line3.textContent = formatRelativeTime(n.createdAt);
			a.append(line1, line2, line3);
			list.appendChild(a);
		}
	};

	const load = async () => {
		const res = await fetch("/api/me/notifications").catch(() => null);
		if (!res?.ok) return;
		const data = (await res.json()) as { notifications?: NotificationDTO[]; unreadCount?: number };
		const unreadCount = data.unreadCount ?? 0;
		if (badge) {
			badge.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
			badge.classList.toggle("hidden", unreadCount === 0);
		}
		render(data.notifications ?? []);
	};

	// 뱃지 카운트는 페이지 로드 시 바로 확인, 목록 본문은 처음 열 때만 불러온다
	load();

	const isOpen = () => toggle.getAttribute("aria-expanded") === "true";
	const setOpen = (open: boolean) => {
		toggle.setAttribute("aria-expanded", String(open));
		menu.setAttribute("aria-hidden", String(!open));
		menu.classList.toggle("opacity-0", !open);
		menu.classList.toggle("scale-95", !open);
		menu.classList.toggle("pointer-events-none", !open);
		menu.classList.toggle("opacity-100", open);
		menu.classList.toggle("scale-100", open);
	};

	toggle.addEventListener("click", (e) => {
		e.stopPropagation();
		const next = !isOpen();
		setOpen(next);
		if (next && loaded) load(); // 다시 열 때 최신 상태 반영
		loaded = true;
	});
	document.addEventListener("click", (e) => {
		if (isOpen() && !menu.contains(e.target as Node) && e.target !== toggle) setOpen(false);
	});
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && isOpen()) {
			setOpen(false);
			toggle.focus();
		}
	});

	markAllBtn?.addEventListener("click", async () => {
		await fetch("/api/me/notifications/read-all", { method: "POST" }).catch(() => {});
		load();
	});
}
