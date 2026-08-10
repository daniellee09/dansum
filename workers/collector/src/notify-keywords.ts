/**
 * 키워드 알림 팬아웃.
 *
 * ⚠️ 경계를 넘는 파일이다. 계정 데이터(follows·notifications·users)는 원래 apps/web이 소유하지만,
 * "새 이슈가 방금 생겼다"를 아는 건 컬렉터뿐이라 여기서 쓴다. 그 넘나듦을 이 파일 하나에 가둔다.
 * 그리고 **기사 배치와 분리된 배치에서 try/catch로** 실행한다 — 알림 INSERT 하나가 실패해서
 * 수집 파이프라인이 롤백되거나 중단되는 일은 절대 없어야 한다.
 *
 * 왜 기사가 아니라 '이슈 생성' 시점인가: 멤버 기사마다 알리면 5개 매체가 다룬 사건에 알림이
 * 5번 간다. 창설 시점에만 쏘면 이슈당 최대 1건이 **구조적으로** 보장되고, "이미 보냈나"를
 * 기억할 상태가 아예 필요 없다. 대가는 알림이 가장 먼저 낸 매체를 가리킨다는 것 — 수용한다.
 */

import {
	KEYWORD_ALERTS_PER_RUN,
	KEYWORD_MIN_LENGTH,
	normalizeKeyword,
} from "@dansum/shared";

/** 이번 tick에 새로 만들어진 이슈와 그 대표 기사. */
export interface NewIssueAlert {
	issueId: string;
	articleId: string;
	articleTitle: string;
	/** 창설 기사의 원본 키워드(정규화 전) */
	keywords: string[];
}

interface KeywordFollowRow {
	user_id: string;
	target_value: string;
}

/**
 * 팔로우 키워드와 기사 키워드를 맞춰본다.
 *
 * 정확히 일치만 보면 거의 안 터진다 — LLM이 기사당 3~6개만 뽑으므로 "금리"를 팔로우해도
 * "기준금리"와 매칭되지 않는다. 그래서 양방향 부분 문자열을 쓴다. 짧은 키워드가 아무 데나
 * 걸리는 건 KEYWORD_MIN_LENGTH와 팔로우 개수 상한으로 막는다.
 */
function matches(followed: string, articleKeywords: string[]): boolean {
	const f = normalizeKeyword(followed);
	if (f.length < KEYWORD_MIN_LENGTH) return false;
	return articleKeywords.some((k) => {
		const a = normalizeKeyword(k);
		return a.length > 0 && (a.includes(f) || f.includes(a));
	});
}

/**
 * 새로 만들어진 이슈들에 대해 키워드 알림을 만든다. 실패해도 파이프라인에 영향이 없도록
 * 호출부가 아니라 여기서 삼킨다. 반환값은 만들어진 알림 수(로그용).
 */
export async function notifyKeywordFollowers(
	db: D1Database,
	newIssues: NewIssueAlert[],
): Promise<number> {
	if (newIssues.length === 0) return 0;

	try {
		// 키워드를 팔로우한 사람 전체. 알림을 끈 사람은 애초에 조회하지 않는다.
		// 팔로우 개수 상한(20)이 있어 유저 수 × 20이 상한이고, 초기 규모에서는 수백 행이다.
		const { results: follows } = await db
			.prepare(
				`SELECT f.user_id, f.target_value
				 FROM follows f JOIN users u ON u.id = f.user_id
				 WHERE f.target_type = 'keyword'
				   AND u.notify_keyword = 1
				   AND u.status = 'active'`,
			)
			.all<KeywordFollowRow>();
		if (follows.length === 0) return 0;

		const byUser = new Map<string, string[]>();
		for (const f of follows) {
			const list = byUser.get(f.user_id);
			if (list) list.push(f.target_value);
			else byUser.set(f.user_id, [f.target_value]);
		}

		const stmts: D1PreparedStatement[] = [];
		for (const [userId, keywords] of byUser) {
			let sent = 0;
			for (const issue of newIssues) {
				// tick당 상한. 큰 사건이 터진 날 종이 스무 번 울리면 다음부터 아무도 안 읽는다.
				if (sent >= KEYWORD_ALERTS_PER_RUN) break;
				const hit = keywords.find((k) => matches(k, issue.keywords));
				if (!hit) continue;
				stmts.push(
					db
						.prepare(
							"INSERT INTO notifications (id, user_id, type, payload) VALUES (?, ?, 'keyword', ?)",
						)
						.bind(
							crypto.randomUUID(),
							userId,
							JSON.stringify({
								// articleId는 알림 목록이 기사 제목을 조인하는 키다(listNotifications).
								articleId: issue.articleId,
								issueId: issue.issueId,
								keyword: hit,
							}),
						),
				);
				sent++;
			}
		}

		if (stmts.length === 0) return 0;
		await db.batch(stmts);
		return stmts.length;
	} catch (e) {
		console.error("[KeywordAlert] 팬아웃 실패(파이프라인은 계속):", e);
		return 0;
	}
}
