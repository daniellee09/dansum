import {
	DEFAULT_PAGE_SIZE,
	type Article,
	type ArticleSection,
	type NewsCluster,
	normalizeSections,
} from "@dansum/shared";

interface ArticleRow {
	id: string;
	raw_article_id: string;
	source_id: string;
	title: string;
	original_title: string | null;
	summary: string;
	sections: string;
	key_points: string;
	category: string;
	keywords: string;
	source_url: string;
	source_name: string;
	image_url: string | null;
	published_at: string;
	summarized_at: string;
	created_at: string;
}

function safeParseArray(json: string): string[] {
	try {
		const v = JSON.parse(json);
		return Array.isArray(v) ? v : [];
	} catch {
		return [];
	}
}

/**
 * sections(JSON)을 방어적으로 파싱.
 * 중첩 불릿 도입 이전에 저장된 행은 points가 string[]인데, normalizeSections가
 * 이를 { text } 형태로 승격해주므로 재요약 없이 그대로 렌더된다.
 */
function safeParseSections(json: string): ArticleSection[] {
	try {
		return normalizeSections(JSON.parse(json));
	} catch {
		return [];
	}
}

function rowToArticle(row: ArticleRow): Article {
	return {
		id: row.id,
		rawArticleId: row.raw_article_id,
		sourceId: row.source_id,
		title: row.title,
		originalTitle: row.original_title,
		summary: row.summary,
		sections: safeParseSections(row.sections),
		keyPoints: safeParseArray(row.key_points),
		category: row.category as Article["category"],
		keywords: safeParseArray(row.keywords),
		sourceUrl: row.source_url,
		sourceName: row.source_name,
		imageUrl: row.image_url ?? null,
		publishedAt: row.published_at,
		summarizedAt: row.summarized_at,
		createdAt: row.created_at,
	};
}

/** LIKE 검색용 와일드카드 이스케이프(\ % _) */
function escapeLike(s: string): string {
	return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

// 검색어: 공백으로 토큰 분리 → 각 토큰이 (여러 필드 중 어디든) 모두 들어간 기사만(토큰 간 AND).
// 단순 부분일치의 "여러 단어 = 한 덩어리로만 매칭" 문제를 해결한다.
const SEARCH_FIELDS = ["title", "original_title", "summary", "keywords", "sections", "key_points"];

/** 검색어 q를 WHERE 조건(토큰 간 AND, 필드 간 OR)으로 변환. getArticles(관련도순)와
 *  getArticlesHot(검색 결과 내 인기순)이 공유한다. */
function buildSearchConditions(q: string): { conditions: string[]; bindings: unknown[] } {
	const conditions: string[] = [];
	const bindings: unknown[] = [];
	const terms = q.split(/\s+/).filter(Boolean).slice(0, 6);

	for (const term of terms) {
		const like = `%${escapeLike(term)}%`;
		const ors = SEARCH_FIELDS.map((f) => `${f} LIKE ? ESCAPE '\\'`).join(" OR ");
		conditions.push(`(${ors})`);
		for (let i = 0; i < SEARCH_FIELDS.length; i++) bindings.push(like);
	}

	return { conditions, bindings };
}

export async function getArticles(
	db: D1Database,
	options: {
		page?: number;
		pageSize?: number;
		category?: string;
		/** 매체 필터(sources.id). 목록의 매체명을 눌렀을 때 쓴다 */
		source?: string;
		q?: string;
		/** "hot" = 보도량 기반 인기순, "latest" = 최신순. 검색(q)에서 생략하면 관련도순(기본) */
		sort?: "latest" | "hot";
	},
) {
	const page = options.page ?? 1;
	const pageSize = Math.min(options.pageSize ?? DEFAULT_PAGE_SIZE, 50);
	const offset = (page - 1) * pageSize;
	const q = options.q?.trim();

	if (options.sort === "hot") {
		return getArticlesHot(db, {
			page,
			pageSize,
			offset,
			category: options.category,
			source: options.source,
			q,
		});
	}

	const conditions: string[] = [];
	const bindings: unknown[] = [];

	if (options.category) {
		conditions.push("category = ?");
		bindings.push(options.category);
	}

	if (options.source) {
		conditions.push("source_id = ?");
		bindings.push(options.source);
	}

	// 관련도 가중치(필드별). 제목 매칭이 가장 강한 신호.
	const FIELD_WEIGHT: Record<string, number> = {
		title: 4,
		original_title: 3,
		keywords: 3,
		summary: 2,
		sections: 1,
		key_points: 1,
	};

	const relevanceBindings: unknown[] = [];
	let relevanceExpr = "";

	if (q) {
		const search = buildSearchConditions(q);
		conditions.push(...search.conditions);
		bindings.push(...search.bindings);

		// 관련도 점수: 제목에 전체 문구가 그대로면 보너스 + 토큰×필드 가중 합
		const terms = q.split(/\s+/).filter(Boolean).slice(0, 6);
		const relParts: string[] = [
			"CASE WHEN title LIKE ? ESCAPE '\\' THEN 20 ELSE 0 END",
		];
		relevanceBindings.push(`%${escapeLike(q)}%`);
		for (const term of terms) {
			const like = `%${escapeLike(term)}%`;
			for (const f of SEARCH_FIELDS) {
				relParts.push(
					`CASE WHEN ${f} LIKE ? ESCAPE '\\' THEN ${FIELD_WEIGHT[f]} ELSE 0 END`,
				);
				relevanceBindings.push(like);
			}
		}
		relevanceExpr = relParts.join(" + ");
	}

	const whereClause = conditions.length
		? `WHERE ${conditions.join(" AND ")}`
		: "";

	// 총 개수(필터 기준만; 관련도 점수는 불필요)
	const countResult = await db
		.prepare(`SELECT COUNT(*) as total FROM articles ${whereClause}`)
		.bind(...bindings)
		.first<{ total: number }>();

	const total = countResult?.total ?? 0;

	// 목록: 검색 시 기본은 관련도 DESC→최신순(sort=latest면 최신순만), 일반 목록은 최신순.
	// SELECT 절(관련도)이 SQL에서 먼저 나오므로 relevanceBindings를 앞에 바인딩.
	const selectCols = q ? `*, (${relevanceExpr}) AS _rel` : "*";
	const orderBy = q
		? options.sort === "latest"
			? "published_at DESC"
			: "_rel DESC, published_at DESC"
		: "published_at DESC";

	const rows = await db
		.prepare(
			`SELECT ${selectCols} FROM articles ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
		)
		.bind(...relevanceBindings, ...bindings, pageSize, offset)
		.all<ArticleRow>();

	return {
		items: rows.results.map(rowToArticle),
		total,
		page,
		pageSize,
		hasMore: offset + pageSize < total,
	};
}

export async function getArticleById(
	db: D1Database,
	id: string,
): Promise<Article | null> {
	const row = await db
		.prepare("SELECT * FROM articles WHERE id = ?")
		.bind(id)
		.first<ArticleRow>();

	return row ? rowToArticle(row) : null;
}

/** 키워드 정규화: 공백·구두점 제거 + 소문자화(한글은 영향 없음) */
function normalizeKeyword(k: string): string {
	return k
		.trim()
		.toLowerCase()
		.replace(/[\s·().,"'“”\-_/]/g, "");
}

/** 두 정규화 키워드 집합의 공통 개수 */
function sharedCount(a: Set<string>, b: Set<string>): number {
	let n = 0;
	for (const k of a) {
		if (b.has(k)) n++;
	}
	return n;
}

/** ISO 시각 → 현재로부터 경과 시간(시간 단위). null/파싱 실패는 매우 오래된 값. */
function hoursSince(iso: string | null, nowMs: number): number {
	if (!iso) return 1e6;
	const t = new Date(iso).getTime();
	if (Number.isNaN(t)) return 1e6;
	return Math.max(0, (nowMs - t) / 3_600_000);
}

/** 클러스터의 안정적 식별자: 멤버 키워드 빈도 상위 2개를 정렬·결합.
 *  (상위 4개는 멤버 변동에 따라 꼬리 키워드가 자주 바뀌어 지문이 불안정 → 순위변동이 항상 NEW로 떨어짐.
 *   핵심 1~2개 키워드는 같은 이슈에서 안정적이라 30분 스냅샷 비교가 실제로 매칭된다.) */
function clusterFingerprint(members: Article[]): string {
	const freq: Record<string, number> = {};
	for (const m of members) {
		for (const k of m.keywords) {
			const nk = normalizeKeyword(k);
			if (nk) freq[nk] = (freq[nk] || 0) + 1;
		}
	}
	return Object.entries(freq)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 2)
		.map(([k]) => k)
		.sort()
		.join("|");
}

interface RankSnapshot {
	rankings: Record<string, number>;
	savedAt: string;
}

// 스냅샷 갱신 최소 간격(초). 이 간격 안에서는 이전 스냅샷과 비교해 순위 변동을 표시한다.
const SNAPSHOT_TTL_SEC = 30 * 60;

// 후보 시간창: 최근 N시간 내 발행 기사만 "오늘의 주요 뉴스" 후보로(이보다 옛 기사는 제외).
const CANDIDATE_WINDOW_HOURS = 30;
// 보도량 점수에 곱하는 신선도 감쇠 반감기(시간). 이 시간만큼 오래되면 점수 절반.
// 작을수록 "오늘" 강조(옛 이슈가 상단에서 더 빨리 밀림).
const SCORE_HALF_LIFE_HOURS = 16;

interface CoverageCluster {
	keywordSet: Set<string>;
	members: Article[];
	sourceIds: Set<string>;
	/** 보도량(매체 수) × 신선도 감쇠. 많은 매체가 다룰수록 ↑, 오래될수록 완만히 ↓.
	 *  보도량을 곱셈 계수로 둬 단독(1매체)이 신선하다고 상위를 점령하진 않음. */
	score: number;
}

/**
 * 키워드 공유 기반 클러스터링 + 점수 산출. "오늘의 주요 뉴스"(getTopClusters)와
 * 인기순 정렬(getArticlesHot)이 공유하는 핵심 로직.
 * articles는 최신순(published_at DESC)이어야 각 클러스터의 첫 멤버가 대표(lead)가 된다.
 */
function buildCoverageClusters(articles: Article[], nowMs: number): CoverageCluster[] {
	const MIN_SHARED = 2; // 같은 사건으로 보려면 최소 2개 키워드 공유
	const clusters: Omit<CoverageCluster, "score">[] = [];

	for (const article of articles) {
		const kw = new Set(article.keywords.map(normalizeKeyword).filter(Boolean));
		let placed = false;
		if (kw.size > 0) {
			for (const cluster of clusters) {
				if (sharedCount(kw, cluster.keywordSet) >= MIN_SHARED) {
					cluster.members.push(article);
					cluster.sourceIds.add(article.sourceId);
					for (const k of kw) cluster.keywordSet.add(k);
					placed = true;
					break;
				}
			}
		}
		if (!placed) {
			clusters.push({
				keywordSet: kw,
				members: [article],
				sourceIds: new Set([article.sourceId]),
			});
		}
	}

	return clusters.map((c) => ({
		...c,
		score: c.sourceIds.size * 0.5 ** (hoursSince(c.members[0].publishedAt, nowMs) / SCORE_HALF_LIFE_HOURS),
	}));
}

/** 기사 배열을 보도량 점수(buildCoverageClusters) 내림차순으로 정렬(동점은 최신순).
 *  getArticlesHot·getHotArticles가 공유한다. */
function sortByHotness(articles: Article[], nowMs: number): Article[] {
	const clusters = buildCoverageClusters(articles, nowMs);
	const scoreById = new Map<string, number>();
	for (const c of clusters) {
		for (const m of c.members) scoreById.set(m.id, c.score);
	}
	return [...articles].sort((a, b) => {
		const sa = scoreById.get(a.id) ?? 0;
		const sb = scoreById.get(b.id) ?? 0;
		if (sb !== sa) return sb - sa;
		return b.publishedAt.localeCompare(a.publishedAt);
	});
}

/**
 * 인기순(sort=hot) 정렬 목록. getTopClusters와 동일한 후보 시간창·점수 로직을 재사용하되,
 * 카테고리/매체/검색어(q) 필터를 적용하고 페이지네이션한다. 검색과 함께 쓰이면 "검색 결과 중
 * 여러 매체가 다룬 최근 이슈"가 상위로 온다. 인기순은 최근 이슈에서만 의미가 있으므로
 * 후보 시간창(CANDIDATE_WINDOW_HOURS) 밖의 과거 기사는 다루지 않는다(레딧의 "Top: today"와 유사).
 */
async function getArticlesHot(
	db: D1Database,
	opts: {
		page: number;
		pageSize: number;
		offset: number;
		category?: string;
		source?: string;
		q?: string;
	},
) {
	const conditions: string[] = [`published_at >= datetime('now', ?)`];
	const bindings: unknown[] = [`-${CANDIDATE_WINDOW_HOURS} hours`];

	if (opts.category) {
		conditions.push("category = ?");
		bindings.push(opts.category);
	}
	if (opts.source) {
		conditions.push("source_id = ?");
		bindings.push(opts.source);
	}
	if (opts.q) {
		const search = buildSearchConditions(opts.q);
		conditions.push(...search.conditions);
		bindings.push(...search.bindings);
	}

	const rows = await db
		.prepare(
			`SELECT * FROM articles WHERE ${conditions.join(" AND ")} ORDER BY published_at DESC LIMIT 300`,
		)
		.bind(...bindings)
		.all<ArticleRow>();

	const articles = rows.results.map(rowToArticle);
	const sorted = sortByHotness(articles, Date.now());

	const total = sorted.length;
	const items = sorted.slice(opts.offset, opts.offset + opts.pageSize);

	return {
		items,
		total,
		page: opts.page,
		pageSize: opts.pageSize,
		hasMore: opts.offset + opts.pageSize < total,
	};
}

// "Hot!" 사이드바 전용 시간창: sort=hot 목록(CANDIDATE_WINDOW_HOURS=30h)과 달리
// "하루 기준"을 그대로 반영해 정확히 24시간으로 고정한다.
const HOT_ARTICLES_WINDOW_HOURS = 24;

/**
 * "Hot!" — 최근 24시간(하루) 안에서 보도량 점수가 가장 높은 개별 기사 상위 limit개.
 * getArticlesHot과 달리 필터·페이지네이션이 없는 고정 스냅샷이고, 캐시도 안 쓴다
 * (middleware/cache.ts에서 /api/hot을 캐시 대상에서 제외 — 방문할 때마다 최신 상태를 보여줘야 해서).
 */
export async function getHotArticles(db: D1Database, limit = 50): Promise<Article[]> {
	const rows = (
		await db
			.prepare(
				`SELECT * FROM articles WHERE published_at >= datetime('now', ?) ORDER BY published_at DESC LIMIT 300`,
			)
			.bind(`-${HOT_ARTICLES_WINDOW_HOURS} hours`)
			.all<ArticleRow>()
	).results;

	const articles = rows.map(rowToArticle);
	return sortByHotness(articles, Date.now()).slice(0, limit);
}

/**
 * "오늘의 주요 뉴스" — 최근 시간창 안에서 보도량(매체 수) 기반.
 * 같은 사건을 키워드 중복으로 묶고, 그 사건을 보도한 distinct source 수로 순위(동률은 최신순).
 * → "최신 기사 중 여러 매체가 함께 다룬(핫한) 이슈"가 상위. 최신성은 후보 시간창으로 보장.
 * 후보는 최근 CANDIDATE_WINDOW_HOURS시간으로 제한. 영문 기사도 한국어 키워드로 정규화돼 KR/US가 한 클러스터로 묶인다.
 * kv 가 주어지면 30분 단위 스냅샷과 비교해 rankChange 를 계산한다(보도량 급증=급상승).
 */
export async function getTopClusters(
	db: D1Database,
	kv: KVNamespace | null,
	limit = 6,
): Promise<NewsCluster[]> {
	// 최근 N시간 후보(B). 데이터가 적으면 최신 200건으로 폴백.
	let rows = (
		await db
			.prepare(
				`SELECT * FROM articles WHERE published_at >= datetime('now', ?)
				 ORDER BY published_at DESC LIMIT 300`,
			)
			.bind(`-${CANDIDATE_WINDOW_HOURS} hours`)
			.all<ArticleRow>()
	).results;

	if (rows.length < 5) {
		rows = (
			await db
				.prepare("SELECT * FROM articles ORDER BY published_at DESC LIMIT 200")
				.all<ArticleRow>()
		).results;
	}

	const articles = rows.map(rowToArticle);
	const nowMs = Date.now();
	const clusters = buildCoverageClusters(articles, nowMs);

	const scored = clusters.map((c) => ({ c, s: c.score }));
	scored.sort((a, b) => {
		if (b.s !== a.s) return b.s - a.s;
		return b.c.members[0].publishedAt.localeCompare(a.c.members[0].publishedAt);
	});

	const topClusters = scored.slice(0, limit).map((x) => x.c);

	// ── 순위 변동 계산 (KV 스냅샷 비교) ──────────────────────────────────
	const fingerprints = topClusters.map((c) => clusterFingerprint(c.members));
	let prevRankings: Record<string, number> = {};
	let hasValidSnapshot = false;

	if (kv) {
		// 순위 변동은 부가 기능 — KV 장애/한도(put 429) 시에도 본문(클러스터)은 정상 반환해야 한다.
		try {
			const raw = await kv.get("rankings:snapshot");
			if (raw) {
				try {
					const snap = JSON.parse(raw) as RankSnapshot;
					const ageMs = Date.now() - new Date(snap.savedAt).getTime();
					if (ageMs <= SNAPSHOT_TTL_SEC * 1000) {
						prevRankings = snap.rankings;
						hasValidSnapshot = true;
					}
				} catch {
					// 파싱 실패 → 스냅샷 무효 처리
				}
			}
			// 스냅샷이 없거나 만료됐으면 현재 순위로 새 스냅샷 저장
			if (!hasValidSnapshot) {
				const newSnap: RankSnapshot = {
					rankings: Object.fromEntries(fingerprints.map((fp, i) => [fp, i + 1])),
					savedAt: new Date().toISOString(),
				};
				await kv.put("rankings:snapshot", JSON.stringify(newSnap), {
					expirationTtl: 86400,
				});
			}
		} catch {
			// KV 접근 실패 → rankChange 없이(=신규 표시) 진행
			hasValidSnapshot = false;
		}
	}
	// ─────────────────────────────────────────────────────────────────────

	return topClusters.map((c, i) => {
		const fp = fingerprints[i];
		const currentRank = i + 1;
		const prevRank = hasValidSnapshot ? prevRankings[fp] : undefined;
		// 양수 = 상승, 음수 = 하락, null = 신규 진입
		const rankChange: number | null =
			prevRank !== undefined ? prevRank - currentRank : null;

		const sourceNames = [...new Set(c.members.map((m) => m.sourceName))];
		return {
			lead: c.members[0],
			coverage: c.sourceIds.size,
			sourceNames,
			articleIds: c.members.map((m) => m.id),
			rankChange,
		};
	});
}

/**
 * 같은 이슈를 보도한 다른 기사("관련 보도").
 * 기준 기사와 키워드를 MIN_SHARED개 이상 공유하는 최신 후보를 찾아
 * 매체(sourceId)별로 1건씩만, 공유 키워드 수·최신순으로 정렬해 반환.
 */
export async function getRelatedArticles(
	db: D1Database,
	id: string,
	limit = 5,
): Promise<Article[]> {
	const base = await getArticleById(db, id);
	if (!base) return [];

	const baseKw = new Set(base.keywords.map(normalizeKeyword).filter(Boolean));
	if (baseKw.size === 0) return [];

	const rows = (
		await db
			.prepare(
				`SELECT * FROM articles WHERE published_at >= datetime('now','-3 days')
				 ORDER BY published_at DESC LIMIT 400`,
			)
			.all<ArticleRow>()
	).results;

	const MIN_SHARED = 2;
	const scored: { article: Article; shared: number }[] = [];

	for (const row of rows) {
		if (row.id === id) continue;
		const a = rowToArticle(row);
		const kw = new Set(a.keywords.map(normalizeKeyword).filter(Boolean));
		const shared = sharedCount(baseKw, kw);
		if (shared >= MIN_SHARED) scored.push({ article: a, shared });
	}

	// 공유 키워드 수 DESC, 동률이면 최신순
	scored.sort((x, y) => {
		if (y.shared !== x.shared) return y.shared - x.shared;
		return y.article.publishedAt.localeCompare(x.article.publishedAt);
	});

	// 매체별 1건만(기준 기사와 같은 매체는 제외해 "다른 매체" 의미 유지)
	const seenSources = new Set<string>([base.sourceId]);
	const result: Article[] = [];
	for (const { article } of scored) {
		if (seenSources.has(article.sourceId)) continue;
		seenSources.add(article.sourceId);
		result.push(article);
		if (result.length >= limit) break;
	}

	return result;
}

export async function getCategories(db: D1Database) {
	const rows = await db
		.prepare(
			"SELECT category, COUNT(*) as count FROM articles GROUP BY category ORDER BY count DESC",
		)
		.all<{ category: string; count: number }>();

	return rows.results;
}
