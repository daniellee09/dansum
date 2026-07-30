/** 댓글 DTO — 서버(lib/server/comments.ts)와 클라이언트(lib/comments.ts)가 같은 모양을 봐야 하므로
 *  각자 선언하지 않고 여기 한 벌만 둔다. */

export interface CommentAuthor {
	id: string;
	nickname: string;
	/** 레벨·등급은 이 값으로 클라이언트에서 계산한다(shared의 순수 함수). */
	exp: number;
}

export interface CommentDTO {
	id: string;
	articleId: string;
	author: CommentAuthor;
	parentCommentId: string | null;
	body: string;
	/** 가림(hidden)은 status가 아니라 별도 축이다 — isHidden 참고.
	 *  삭제와 가림은 동시에 성립할 수 있고, 관리자가 가림을 풀면 원래 status로 돌아가야 한다. */
	status: "active" | "deleted";
	score: number;
	/** 신고 누적으로 접힌 상태. 본문은 '펼쳐보기'를 위해 그대로 실려 온다 —
	 *  자동 가림은 마찰 장치이지 보안 통제가 아니다. */
	isHidden: boolean;
	createdAt: string;
	isOwner: boolean;
	/** 비추천을 없앴으므로 3상태(1|-1|0)가 아니라 불리언이다.
	 *  값이 둘뿐인데 3상태를 남겨두면 누군가 나중에 세 번째를 '복원'한다. */
	viewerUpvoted: boolean;
	viewerReported: boolean;
	replies: CommentDTO[];
}

/** active(화제순)는 기사 목록의 sort=hot(인기순)과 다른 공식이라 이름을 겹치지 않게 뒀다. */
export type CommentSort = "active" | "latest" | "top";

export type ReportReason = "insult" | "hate" | "spam" | "offtopic" | "etc";
