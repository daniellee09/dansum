import type { APIRoute } from "astro";
import { addFollow, removeFollow } from "../../../../../lib/server/db";
import { json, unauthorized } from "../../../../../lib/server/http";

function parseType(type: string | undefined): "source" | "category" | null {
	return type === "source" || type === "category" ? type : null;
}

export const POST: APIRoute = async ({ params, locals }) => {
	if (!locals.user) return unauthorized();
	const type = parseType(params.type);
	const value = params.value;
	if (!type || !value) return json({ success: false, error: "잘못된 요청입니다" }, { status: 400 });
	await addFollow(locals.runtime.env.DB, locals.user.id, type, value);
	return json({ success: true });
};

export const DELETE: APIRoute = async ({ params, locals }) => {
	if (!locals.user) return unauthorized();
	const type = parseType(params.type);
	const value = params.value;
	if (!type || !value) return json({ success: false, error: "잘못된 요청입니다" }, { status: 400 });
	await removeFollow(locals.runtime.env.DB, locals.user.id, type, value);
	return json({ success: true });
};
