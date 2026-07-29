import type { APIRoute } from "astro";
import { nicknameExists } from "../../../lib/server/db";
import { json } from "../../../lib/server/http";

/** 회원가입/프로필 편집 폼의 실시간 중복확인용 */
export const GET: APIRoute = async ({ url, locals }) => {
	const nickname = url.searchParams.get("nickname")?.trim() ?? "";
	if (nickname.length < 2 || nickname.length > 20) {
		return json({ success: true, available: false });
	}
	// 본인의 현재 닉네임이면(변경 없이 다시 확인하는 경우) 사용 가능으로 처리
	if (locals.user?.nickname === nickname) {
		return json({ success: true, available: true });
	}
	const exists = await nicknameExists(locals.runtime.env.DB, nickname);
	return json({ success: true, available: !exists });
};
