export function json(data: unknown, init?: ResponseInit): Response {
	return new Response(JSON.stringify(data), {
		...init,
		headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
	});
}

export function unauthorized(): Response {
	return json({ success: false, error: "로그인이 필요합니다" }, { status: 401 });
}

export function forbidden(): Response {
	return json({ success: false, error: "권한이 없습니다" }, { status: 403 });
}
