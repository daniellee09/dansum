import { MAX_RETRY_COUNT, hashUrl } from "@dansum/shared";
// 요약 로직은 summarizer 워커에서 재사용(중복 제거). esbuild가 번들 시 함께 묶는다.
import { summarizeArticle } from "../../summarizer/src/claude/client.js";
// 본문 추출은 무료 플랜 CPU 한도 때문에 readability 대신 경량(정규식) 추출기 사용.
import { extractArticleLight } from "./light-extract.js";
import { parseRssFeed } from "./parsers/rss-parser.js";
import { NEWS_SOURCES } from "./sources/config.js";

interface Env {
	DB: D1Database;
	CACHE: KVNamespace;
	OPENAI_API_KEY: string;
	OPENAI_MODEL: string;
	OPENAI_ENDPOINT: string;
	MAX_HTML_BYTES: string;
	MAX_CONTENT_CHARS: string;
}

// 무료 플랜 subrequest 한도(호출당 50개) 안에서 동작하도록 배치 제한:
//   수집(10) + 추출(FETCH_BATCH) + 요약(SUMMARIZE_BATCH) <= ~50
// 경량 추출이라 CPU는 여유롭고, 요약(OpenAI 순차 호출)의 wall-clock이 주 제약.
const FETCH_BATCH = 12;
const SUMMARIZE_BATCH = 12;
// 발행 N일이 지나도록 처리되지 못한 pending은 신선도상 가치가 없어 'skipped'로 정리한다.
// (삭제하지 않는 이유: url_hash 행이 남아야 재수집 churn을 막음)
const STALE_PENDING_DAYS = 2;

export default {
	async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
		ctx.waitUntil(runPipeline(env));
	},

	// 수동 트리거용(배포 후 즉시 1회 돌려보거나, 외부 cron 대체용)
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const { pathname } = new URL(request.url);
		if (pathname === "/trigger") {
			ctx.waitUntil(runPipeline(env));
			return Response.json({ status: "pipeline started" });
		}
		return new Response("Dansum Pipeline Worker", { status: 200 });
	},
};

/**
 * 큐 없이(무료 플랜) 한 번의 cron 호출에서 수집→본문추출→요약을 순서대로 처리한다.
 * 각 단계는 배치 크기로 제한되어 subrequest 한도를 넘지 않는다. 밀린 작업은 다음 호출에서 이어 처리된다.
 */
async function runPipeline(env: Env): Promise<void> {
	console.log(`[Pipeline] start ${new Date().toISOString()}`);
	// self-heal(중단된 전이 복구) + stale skip을 한 배치로(서브리퀘스트 절약).
	// stale skip: 발행 N일 경과 미처리 pending은 큐에서 제외(무한 증식 방지). NULL은 created_at 기준.
	await env.DB.batch([
		env.DB.prepare("UPDATE raw_articles SET status='pending' WHERE status='fetching'"),
		env.DB.prepare("UPDATE raw_articles SET status='fetched' WHERE status='processing'"),
		env.DB
			.prepare(
				`UPDATE raw_articles SET status='skipped'
				 WHERE status='pending'
				   AND COALESCE(published_at, created_at) < datetime('now', ?)`,
			)
			.bind(`-${STALE_PENDING_DAYS} days`),
	]);
	await collectNews(env);
	await fetchPending(env);
	const completed = await summarizeFetched(env);
	// 새 완료분이 있으면 홈 캐시(주요뉴스·최신피드)를 비워 다음 요청에서 즉시 갱신.
	if (completed > 0) await invalidateFeedCache(env);
	console.log(`[Pipeline] done (completed: ${completed})`);
}

// 홈이 호출하는 핵심 피드 캐시만 무효화(서브리퀘스트 절약 위해 2키만; 카테고리는 TTL로 자연 갱신).
const API_ORIGIN = "https://dansum-api.dansum.workers.dev";
async function invalidateFeedCache(env: Env): Promise<void> {
	const keys = [
		`api:${API_ORIGIN}/api/top?limit=6`,
		`api:${API_ORIGIN}/api/articles`,
	];
	await Promise.allSettled(keys.map((k) => env.CACHE.delete(k)));
}

// ─────────────────────────────────────────────────────────────
// 1단계: RSS 수집 → raw_articles(pending)
// 무료 플랜 서브리퀘스트(호출당 50개) 절약: 항목별 SELECT/INSERT 대신
// 전역으로 한 번 조회 + db.batch() 한 번 삽입(배치 1회 = 서브리퀘스트 1개).
// ─────────────────────────────────────────────────────────────
interface Candidate {
	sourceId: string;
	url: string;
	urlHash: string;
	title: string;
	description: string | null;
	author: string | null;
	publishedAt: string | null;
	imageUrl: string | null;
}

async function collectNews(env: Env): Promise<void> {
	// 소스별 RSS fetch+parse는 네트워크 바운드 → 병렬(DB 접근 없음)
	const perSource = await Promise.all(
		NEWS_SOURCES.map((source) =>
			fetchSourceItems(source).catch((error) => {
				console.error(`[Collect] ${source.name} 실패:`, error);
				return [] as Candidate[];
			}),
		),
	);

	// 전역 후보 + 배치 내 url_hash 중복 제거
	const byHash = new Map<string, Candidate>();
	for (const list of perSource) {
		for (const c of list) if (!byHash.has(c.urlHash)) byHash.set(c.urlHash, c);
	}
	const candidates = [...byHash.values()];

	// 기존 url_hash 조회(D1 바인드 파라미터 100개 제한 → 90개씩 청크). url_hash UNIQUE라 INSERT OR IGNORE가 최종 방어.
	const existing = new Set<string>();
	for (let i = 0; i < candidates.length; i += 90) {
		const chunk = candidates.slice(i, i + 90);
		const ph = chunk.map(() => "?").join(",");
		const r = await env.DB.prepare(
			`SELECT url_hash FROM raw_articles WHERE url_hash IN (${ph})`,
		)
			.bind(...chunk.map((c) => c.urlHash))
			.all<{ url_hash: string }>();
		for (const row of r.results ?? []) existing.add(row.url_hash);
	}
	const fresh = candidates.filter((c) => !existing.has(c.urlHash));

	// 신규 INSERT + 성공 소스 last_fetched 갱신을 한 번의 배치로(1 서브리퀘스트)
	const okSourceIds = [...new Set(perSource.flatMap((l) => l.map((c) => c.sourceId)))];
	const stmts = [
		...fresh.map((c) =>
			env.DB.prepare(
				`INSERT OR IGNORE INTO raw_articles (id, source_id, url, url_hash, title, description, author, published_at, image_url, status)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
			).bind(
				crypto.randomUUID(),
				c.sourceId,
				c.url,
				c.urlHash,
				c.title,
				c.description,
				c.author,
				c.publishedAt,
				c.imageUrl,
			),
		),
		...okSourceIds.map((id) =>
			env.DB.prepare(
				"UPDATE sources SET last_fetched_at = datetime('now') WHERE id = ?",
			).bind(id),
		),
	];
	// 배치당 statement 수 제한(다운타임 후 신규 급증 대비)
	for (let i = 0; i < stmts.length; i += 50) {
		await env.DB.batch(stmts.slice(i, i + 50));
	}
	if (fresh.length > 0) console.log(`[Collect] +${fresh.length} (sources ok: ${okSourceIds.length})`);
}

async function fetchSourceItems(
	source: (typeof NEWS_SOURCES)[number],
): Promise<Candidate[]> {
	const response = await fetch(source.url, {
		headers: {
			"User-Agent": "Dansum-News-Collector/0.1",
			Accept: "application/rss+xml, application/xml, text/xml",
		},
	});
	if (!response.ok) throw new Error(`HTTP ${response.status} from ${source.url}`);

	const items = parseRssFeed(await response.text());
	const out: Candidate[] = [];
	for (const item of items) {
		if (!item.link || !item.title) continue;
		out.push({
			sourceId: source.id,
			url: item.link,
			urlHash: await hashUrl(item.link),
			title: item.title,
			description: item.description ?? null,
			author: item.author ?? null,
			publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : null,
			imageUrl: item.imageUrl ?? null,
		});
	}
	return out;
}

// ─────────────────────────────────────────────────────────────
// 2단계: pending → 본문 추출 → fetched
// ─────────────────────────────────────────────────────────────
interface PendingRow {
	rawArticleId: string;
	url: string;
}

async function fetchPending(env: Env): Promise<void> {
	const maxHtml = Number(env.MAX_HTML_BYTES) || 800_000;
	const maxChars = Number(env.MAX_CONTENT_CHARS) || 8_000;

	// 발행일이 최신인 기사부터 처리해야 피드 상단이 항상 신선해진다(백로그의 옛 기사는 자연 후순위).
	// published_at NULL은 DESC에서 맨 뒤로 밀려 최저 우선순위가 됨.
	const pending = await env.DB.prepare(
		`SELECT id AS rawArticleId, url FROM raw_articles
		 WHERE status = 'pending' ORDER BY published_at DESC LIMIT ?`,
	)
		.bind(FETCH_BATCH)
		.all<PendingRow>();
	const rows = pending.results ?? [];
	if (rows.length === 0) return;

	// 기사 fetch는 네트워크 바운드 → 병렬. (중간 'fetching' 마킹 생략: 중단되면 pending으로 남아 자연 재시도)
	const results = await Promise.all(
		rows.map(async (row) => {
			let content: string | null = null;
			try {
				const res = await fetch(row.url, {
					headers: {
						"User-Agent": "Dansum-News-Collector/0.1 (+https://dansum.example)",
						Accept: "text/html,application/xhtml+xml",
					},
				});
				if (res.ok) {
					let html = await res.text();
					if (html.length > maxHtml) html = html.slice(0, maxHtml);
					const extracted = extractArticleLight(html, maxChars);
					if (extracted) content = extracted.text;
				}
			} catch (error) {
				console.warn(`[Fetch] ${row.url}:`, error);
			}
			return { id: row.rawArticleId, content };
		}),
	);

	// 본문 추출 실패해도 description 폴백으로 요약하도록 fetched 전이 — 한 번의 배치(1 서브리퀘스트)
	await env.DB.batch(
		results.map((r) =>
			env.DB.prepare(
				"UPDATE raw_articles SET content = ?, status = 'fetched' WHERE id = ?",
			).bind(r.content, r.id),
		),
	);
}

// ─────────────────────────────────────────────────────────────
// 3단계: fetched → 요약(OpenAI) → articles(completed)
// ─────────────────────────────────────────────────────────────
interface FetchedRow {
	rawArticleId: string;
	sourceId: string;
	sourceName: string;
	title: string;
	description: string | null;
	content: string | null;
	url: string;
	publishedAt: string | null;
	retryCount: number;
}

async function summarizeFetched(env: Env): Promise<number> {
	// 요약에 필요한 필드를 한 번에 조회(건별 SELECT 제거 → 서브리퀘스트 절약)
	const res = await env.DB.prepare(
		`SELECT r.id AS rawArticleId, r.source_id AS sourceId, s.name AS sourceName,
		        r.title AS title, r.description AS description, r.content AS content,
		        r.url AS url, r.published_at AS publishedAt, r.retry_count AS retryCount
		 FROM raw_articles r JOIN sources s ON s.id = r.source_id
		 WHERE r.status = 'fetched' ORDER BY r.published_at DESC LIMIT ?`,
	)
		.bind(SUMMARIZE_BATCH)
		.all<FetchedRow>();
	const rows = res.results ?? [];
	if (rows.length === 0) return 0;

	// 재시도 초과 → failed, 나머지 → processing(+retry) 일괄 전이(1 배치)
	const tooMany = rows.filter((r) => r.retryCount >= MAX_RETRY_COUNT);
	const toProcess = rows.filter((r) => r.retryCount < MAX_RETRY_COUNT);
	const preStmts = [
		...tooMany.map((r) =>
			env.DB.prepare("UPDATE raw_articles SET status = 'failed' WHERE id = ?").bind(r.rawArticleId),
		),
		...toProcess.map((r) =>
			env.DB.prepare(
				"UPDATE raw_articles SET status = 'processing', retry_count = retry_count + 1 WHERE id = ?",
			).bind(r.rawArticleId),
		),
	];
	if (preStmts.length > 0) await env.DB.batch(preStmts);
	if (toProcess.length === 0) return 0;

	// OpenAI 호출은 I/O 바운드 → 병렬(건당 1 서브리퀘스트)
	const results = await Promise.allSettled(
		toProcess.map((r) =>
			summarizeArticle(
				{ title: r.title, description: r.description, content: r.content, sourceName: r.sourceName },
				env.OPENAI_API_KEY,
				env.OPENAI_MODEL,
				env.OPENAI_ENDPOINT,
			),
		),
	);

	// 성공: articles INSERT + completed / 실패: fetched 복귀 — 모두 한 번의 배치로 기록
	const writeStmts: D1PreparedStatement[] = [];
	results.forEach((out, i) => {
		const r = toProcess[i];
		if (out.status === "fulfilled") {
			const s = out.value;
			writeStmts.push(
				env.DB.prepare(
					`INSERT INTO articles (id, raw_article_id, source_id, title, original_title, summary, sections, key_points, category, keywords, source_url, source_name, published_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
				).bind(
					crypto.randomUUID(),
					r.rawArticleId,
					r.sourceId,
					s.title,
					r.title,
					s.summary,
					JSON.stringify(s.sections),
					JSON.stringify(s.key_points),
					s.category,
					JSON.stringify(s.keywords),
					r.url,
					r.sourceName,
					r.publishedAt,
				),
				env.DB.prepare("UPDATE raw_articles SET status = 'completed' WHERE id = ?").bind(r.rawArticleId),
			);
			console.log(`[Summarize] ${s.title}`);
		} else {
			console.error(`[Summarize] ${r.rawArticleId} 실패:`, out.reason);
			writeStmts.push(
				env.DB.prepare("UPDATE raw_articles SET status = 'fetched' WHERE id = ?").bind(r.rawArticleId),
			);
		}
	});
	if (writeStmts.length > 0) await env.DB.batch(writeStmts);
	return results.filter((r) => r.status === "fulfilled").length;
}
