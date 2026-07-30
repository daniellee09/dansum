/** 관리자 판별. role은 BaseLayout이 authUser를 통째로 직렬화해 내려주므로 브라우저에서도 보인다 —
 *  절대 클라이언트 가드로 쓰지 말고, 모든 admin 라우트가 서버에서 독립적으로 이 함수를 다시 호출한다.
 *  (페이지가 통과시켰다고 API가 신뢰하면 안 된다) */

import type { AuthUser } from "@dansum/shared";

export function isAdmin(user: AuthUser | null | undefined): boolean {
	return user?.role === "admin";
}
