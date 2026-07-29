import type { APIRoute } from "astro";
import { verifyPassword } from "@dansum/shared";
import { createSession, findUserByEmail, toAuthUser } from "../../../lib/server/db";
import { json } from "../../../lib/server/http";
import { SESSION_COOKIE } from "../../../middleware";

const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_SECONDS = 60 * 15;
const INVALID_CREDENTIALS = "이메일 또는 비밀번호가 올바르지 않습니다";

export const POST: APIRoute = async ({ request, cookies, locals }) => {
	let body: { email?: string; password?: string };
	try {
		body = await request.json();
	} catch {
		return json({ success: false, error: "잘못된 요청입니다" }, { status: 400 });
	}

	const email = body.email?.trim().toLowerCase() ?? "";
	const password = body.password ?? "";
	if (!email || !password || password.length > 200) {
		return json({ success: false, error: INVALID_CREDENTIALS }, { status: 400 });
	}

	const { DB, CACHE } = locals.runtime.env;

	const attemptKey = `login-attempts:${email}`;
	const attempts = Number((await CACHE.get(attemptKey)) ?? "0");
	if (attempts >= MAX_ATTEMPTS) {
		return json(
			{ success: false, error: "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요" },
			{ status: 429 },
		);
	}

	const row = await findUserByEmail(DB, email);
	const ok = row?.password_hash ? await verifyPassword(password, row.password_hash) : false;

	if (!row || !ok) {
		await CACHE.put(attemptKey, String(attempts + 1), { expirationTtl: ATTEMPT_WINDOW_SECONDS });
		return json({ success: false, error: INVALID_CREDENTIALS }, { status: 401 });
	}
	if (row.status !== "active") {
		return json({ success: false, error: "이용이 제한된 계정입니다" }, { status: 403 });
	}

	await CACHE.delete(attemptKey);

	const { token, expiresAt } = await createSession(DB, row.id, request.headers.get("user-agent"));
	cookies.set(SESSION_COOKIE, token, {
		httpOnly: true,
		secure: import.meta.env.PROD,
		sameSite: "lax",
		path: "/",
		expires: expiresAt,
	});

	return json({ success: true, data: toAuthUser(row) });
};
