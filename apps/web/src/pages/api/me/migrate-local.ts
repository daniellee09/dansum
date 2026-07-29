import type { APIRoute } from "astro";
import { migrateLocalData } from "../../../lib/server/db";
import { json, unauthorized } from "../../../lib/server/http";

interface Body {
	bookmarks?: string[];
	followSources?: string[];
	followCategories?: string[];
	recentlyViewed?: string[];
}

function toIdArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((v): v is string => typeof v === "string").slice(0, 200);
}

/** 로그인/회원가입 직후 클라이언트가 기존 localStorage 4종을 한 번에 보내 계정에 멱등 병합한다. */
export const POST: APIRoute = async ({ request, locals }) => {
	if (!locals.user) return unauthorized();

	let body: Body;
	try {
		body = await request.json();
	} catch {
		return json({ success: false, error: "잘못된 요청입니다" }, { status: 400 });
	}

	await migrateLocalData(locals.runtime.env.DB, locals.user.id, {
		bookmarks: toIdArray(body.bookmarks),
		followSources: toIdArray(body.followSources),
		followCategories: toIdArray(body.followCategories),
		recentlyViewed: toIdArray(body.recentlyViewed),
	});

	return json({ success: true });
};
