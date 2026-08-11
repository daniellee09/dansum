/**
 * 이슈 배정: 같은 사건을 다룬 기사들을 수집 시점에 하나의 영구 이슈로 묶는다.
 *
 * 왜 읽기 시점이 아니라 여기인가: 클러스터가 요청마다 다시 계산되면 id가 없고, id가 없으면
 * 댓글이 붙을 곳이 없다(migrations/0010 주석 참고). 묶는 규칙 자체는 apps/api와 공유해야
 * 갈라지지 않으므로 packages/shared/src/utils/cluster.ts에 두고 양쪽이 import한다.
 *
 * 불변식 두 가지는 이 파일이 지킨다:
 *   - 기사는 정확히 한 이슈에 속하고, 배정된 issue_id는 다시 바꾸지 않는다(병합 없음).
 *   - 이슈의 match_keywords는 창설 기사 것으로 동결한다(합집합으로 키우지 않는다).
 */

import {
	findCommonKeywords,
	ISSUE_ABSORB_WINDOW_HOURS,
	ISSUE_MATCH_KEYWORD_MAX,
	MIN_SHARED_KEYWORDS,
	sharedKeywords,
	toKeywordSet,
} from "@dansum/shared";

/** 아직 새 기사를 흡수할 수 있는 이슈. */
export interface IssueCandidate {
	id: string;
	matchKeywords: Set<string>;
}

export interface IncomingArticle {
	articleId: string;
	keywords: string[];
	/** 정렬 전용(오래된 것부터 배정). null이면 가장 오래된 것으로 취급. */
	publishedAt: string | null;
}

export interface IssueAssignment {
	articleId: string;
	issueId: string;
	/** 이 기사가 이슈를 새로 만들었을 때만 채워진다(= INSERT INTO issues 대상). */
	createdWith?: string[];
}

/** 흡수 창 안에 있는 이슈 후보. 최신 이슈일수록 매칭될 가능성이 높아 최신순으로 가져온다. */
export async function loadOpenIssues(db: D1Database, limit = 400): Promise<IssueCandidate[]> {
	const { results } = await db
		.prepare(
			`SELECT id, match_keywords FROM issues
			 WHERE last_published_at >= datetime('now', ?)
			 ORDER BY last_published_at DESC LIMIT ?`,
		)
		.bind(`-${ISSUE_ABSORB_WINDOW_HOURS} hours`, limit)
		.all<{ id: string; match_keywords: string }>();

	return results.map((r) => ({
		id: r.id,
		matchKeywords: new Set(safeParseKeywords(r.match_keywords)),
	}));
}

function safeParseKeywords(json: string): string[] {
	try {
		const parsed = JSON.parse(json);
		return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
	} catch {
		return [];
	}
}

/**
 * 오래된 기사부터 first-fit 배정.
 *
 * 오름차순으로 도는 이유: 같은 사건은 보통 한 매체가 먼저 내고 나머지가 뒤따른다. 먼저 난
 * 기사가 이슈를 창설해야 뒤따르는 기사들이 거기 붙는다(최신순으로 돌면 배치 경계마다
 * 창설 기사가 달라져 백필분과 신규분의 이슈 모양이 갈린다).
 *
 * `open`은 **제자리에서 확장된다** — 새로 만든 이슈를 즉시 후보에 넣어야 같은 배치 안의
 * 형제 기사가 서로 묶인다. 호출자가 같은 배열을 다음 단계(드레인)에 넘기면 그대로 이어진다.
 */
export function assignIssues(open: IssueCandidate[], incoming: IncomingArticle[]): IssueAssignment[] {
	const ordered = [...incoming].sort((a, b) =>
		(a.publishedAt ?? "").localeCompare(b.publishedAt ?? ""),
	);

	const keywordSets = ordered.map((a) => toKeywordSet(a.keywords));

	// 상투어 판정. 이 배치의 기사들에서 직접 센다 — 이슈 수로 세면 상투어가 여러 이슈로
	// 퍼지지 않고 한 이슈에 몰려버려 임계값에 닿지 않는다(운영에서 실제로 그래서 안 먹었다).
	// 열린 이슈의 매칭 집합도 표본에 넣어, 배치가 작을 때 최근 맥락이 반영되게 한다.
	const common = findCommonKeywords(
		[...keywordSets, ...open.map((c) => c.matchKeywords)],
		keywordSets.length,
	);

	const assignments: IssueAssignment[] = [];
	ordered.forEach((article, i) => {
		const kw = keywordSets[i];

		let matched: IssueCandidate | undefined;
		if (kw.size > 0) {
			matched = open.find((c) => {
				const shared = sharedKeywords(kw, c.matchKeywords);
				if (shared.length < MIN_SHARED_KEYWORDS) return false;
				// 공유한 게 전부 상투어면 잇지 않는다 — 최소 하나는 이 사건만의 말이어야 한다.
				return shared.some((k) => !common.has(k));
			});
		}

		if (matched) {
			assignments.push({ articleId: article.articleId, issueId: matched.id });
			return;
		}

		// 붙을 데가 없으면 단독 이슈로 창설한다. 키워드가 없는 기사도 여기로 오는데,
		// 빈 집합은 무엇과도 MIN_SHARED_KEYWORDS를 넘길 수 없어 남을 흡수하지 못한다(의도된 것).
		const frozen = [...kw].slice(0, ISSUE_MATCH_KEYWORD_MAX);
		const created: IssueCandidate = { id: crypto.randomUUID(), matchKeywords: new Set(frozen) };
		open.unshift(created);
		assignments.push({ articleId: article.articleId, issueId: created.id, createdWith: frozen });
	});
	return assignments;
}

/** 신규 이슈 INSERT문. 기사 INSERT보다 **먼저** 실행돼야 FK가 성립한다. */
export function buildIssueInsertStatements(
	db: D1Database,
	assignments: IssueAssignment[],
): D1PreparedStatement[] {
	return assignments
		.filter((a) => a.createdWith !== undefined)
		.map((a) =>
			db
				.prepare("INSERT INTO issues (id, match_keywords) VALUES (?, ?)")
				.bind(a.issueId, JSON.stringify(a.createdWith)),
		);
}

/**
 * 이슈 집계 재계산문. 기사 INSERT/UPDATE보다 **나중에** 실행돼야 한다.
 *
 * 증분(+1)이 아니라 재계산인 이유: source_count는 DISTINCT라 증분이 애초에 불가능하고,
 * 재계산은 어떤 이유로 한 tick을 건너뛰어도 다음 tick에 스스로 맞춰진다(자가 치유).
 * 다섯 서브쿼리 모두 idx_articles_issue를 탄다.
 */
export function buildIssueRecomputeStatements(
	db: D1Database,
	assignments: IssueAssignment[],
): D1PreparedStatement[] {
	const touched = [...new Set(assignments.map((a) => a.issueId))];
	return touched.map((id) =>
		db
			.prepare(
				`UPDATE issues SET
				   article_count      = (SELECT COUNT(*)                  FROM articles WHERE issue_id = issues.id),
				   source_count       = (SELECT COUNT(DISTINCT source_id) FROM articles WHERE issue_id = issues.id),
				   first_published_at = (SELECT MIN(published_at)         FROM articles WHERE issue_id = issues.id),
				   last_published_at  = (SELECT MAX(published_at)         FROM articles WHERE issue_id = issues.id),
				   lead_article_id    = (SELECT id FROM articles WHERE issue_id = issues.id ORDER BY published_at DESC LIMIT 1),
				   updated_at         = datetime('now')
				 WHERE id = ?`,
			)
			.bind(id),
	);
}

/** cron 한 tick에 배정을 시도할 미배정 기사 수. 최신분부터 처리해 홈에 뜰 것들을 먼저 채운다.
 *  이미 쌓인 기사를 한꺼번에 메울 때는 이 값이 아니라 /drain?n= 엔드포인트를 쓴다
 *  (cron 경로는 수집·요약과 서브리퀘스트 예산을 나눠 쓰므로 크게 잡을 수 없다). */
const DRAIN_BATCH = 50;

/**
 * issue_id가 비어 있는 기사를 조금씩 배정한다.
 *
 * 별도 백필 스크립트를 만들지 않는 이유: 클러스터링 규칙의 두 번째 구현체는 반드시
 * 원본과 갈라진다. 여기서 같은 assignIssues를 부르면 규칙은 영원히 한 벌이고, 마이그레이션
 * 직후의 대량 백필과 "어쩌다 배정이 빠진 기사"의 복구가 같은 코드로 처리된다.
 * 배정이 끝나면 0행을 반환하는 인덱스 조회 하나로 남는다.
 */
export async function drainUnassignedIssues(
	db: D1Database,
	open: IssueCandidate[],
	batch = DRAIN_BATCH,
): Promise<number> {
	const { results } = await db
		.prepare(
			`SELECT id, keywords, published_at FROM articles
			 WHERE issue_id IS NULL ORDER BY published_at DESC LIMIT ?`,
		)
		.bind(batch)
		.all<{ id: string; keywords: string; published_at: string | null }>();
	if (results.length === 0) return 0;

	const assignments = assignIssues(
		open,
		results.map((r) => ({
			articleId: r.id,
			keywords: safeParseKeywords(r.keywords),
			publishedAt: r.published_at,
		})),
	);

	await db.batch([
		...buildIssueInsertStatements(db, assignments),
		...assignments.map((a) =>
			db.prepare("UPDATE articles SET issue_id = ? WHERE id = ?").bind(a.issueId, a.articleId),
		),
		...buildIssueRecomputeStatements(db, assignments),
	]);

	return assignments.length;
}
