export interface AuthUser {
	id: string;
	email: string;
	nickname: string;
	avatarUrl: string | null;
	/** 신고 처리 화면(/admin/reports) 접근 판단용. BaseLayout이 authUser를 통째로
	 *  클라이언트에 내려주므로 이 값은 브라우저에서 보인다 — 절대 클라이언트 가드로 쓰지 말 것.
	 *  모든 admin API는 서버에서 독립적으로 다시 확인한다. */
	role: "user" | "admin";
	createdAt: string;
}
