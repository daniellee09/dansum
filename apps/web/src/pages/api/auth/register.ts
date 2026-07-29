import type { APIRoute } from "astro";
import { hashPassword } from "@dansum/shared";
import { createSession, createUser, findUserByEmail, nicknameExists } from "../../../lib/server/db";
import { json } from "../../../lib/server/http";
import { SESSION_COOKIE } from "../../../middleware";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_REGISTRATIONS_PER_WINDOW = 5;
const RATE_WINDOW_SECONDS = 60 * 60;

export const POST: APIRoute = async ({ request, cookies, locals }) => {
	let body: { email?: string; password?: string; nickname?: string };
	try {
		body = await request.json();
	} catch {
		return json({ success: false, error: "잘못된 요청입니다" }, { status: 400 });
	}

	const email = body.email?.trim().toLowerCase() ?? "";
	const password = body.password ?? "";
	const nickname = body.nickname?.trim() ?? "";

	if (!EMAIL_RE.test(email)) {
		return json({ success: false, error: "이메일 형식이 올바르지 않습니다" }, { status: 400 });
	}
	if (password.length < 8 || password.length > 200) {
		return json({ success: false, error: "비밀번호는 8~200자여야 합니다" }, { status: 400 });
	}
	if (nickname.length < 2 || nickname.length > 20) {
		return json({ success: false, error: "닉네임은 2~20자여야 합니다" }, { status: 400 });
	}

	const { DB, CACHE } = locals.runtime.env;

	// IP당 시간당 가입 시도 제한(대량 계정 생성 방지). Cloudflare 뒤에선 항상 이 헤더가 온다.
	const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
	const rateKey = `register-attempts:${ip}`;
	const attempts = Number((await CACHE.get(rateKey)) ?? "0");
	if (attempts >= MAX_REGISTRATIONS_PER_WINDOW) {
		return json(
			{ success: false, error: "가입 시도가 너무 많습니다. 잠시 후 다시 시도해주세요" },
			{ status: 429 },
		);
	}
	await CACHE.put(rateKey, String(attempts + 1), { expirationTtl: RATE_WINDOW_SECONDS });

	if (await findUserByEmail(DB, email)) {
		return json({ success: false, error: "이미 가입된 이메일입니다" }, { status: 409 });
	}
	if (await nicknameExists(DB, nickname)) {
		return json({ success: false, error: "이미 사용 중인 닉네임입니다" }, { status: 409 });
	}

	const passwordHash = await hashPassword(password);
	const user = await createUser(DB, { email, passwordHash, nickname });
	const { token, expiresAt } = await createSession(DB, user.id, request.headers.get("user-agent"));

	cookies.set(SESSION_COOKIE, token, {
		httpOnly: true,
		secure: import.meta.env.PROD,
		sameSite: "lax",
		path: "/",
		expires: expiresAt,
	});

	return json({ success: true, data: user });
};
