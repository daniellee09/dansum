import { MAX_RETRY_COUNT } from "@dansum/shared";
import { summarizeArticle } from "./claude/client.js";

interface Env {
	DB: D1Database;
	CACHE: KVNamespace;
	OPENAI_API_KEY: string;
	OPENAI_MODEL: string;
}

interface QueueMessage {
	rawArticleId: string;
	sourceId: string;
	sourceName: string;
}

export default {
	async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
		for (const message of batch.messages) {
			try {
				await processArticle(message.body, env);
				message.ack();
			} catch (error) {
				console.error(
					`[Summarizer] Failed to process ${message.body.rawArticleId}:`,
					error,
				);
				message.retry();
			}
		}
	},

	// 개발 중 수동 트리거용
	async fetch(request: Request, env: Env): Promise<Response> {
		// 로컬 검증용: pending 기사들을 큐 없이 직접 처리
		if (new URL(request.url).pathname === "/process") {
			const pending = await env.DB.prepare(
				`SELECT r.id AS rawArticleId, r.source_id AS sourceId, s.name AS sourceName
				 FROM raw_articles r JOIN sources s ON s.id = r.source_id
				 WHERE r.status = 'fetched' LIMIT 50`,
			).all<{ rawArticleId: string; sourceId: string; sourceName: string }>();

			let processed = 0;
			for (const row of pending.results ?? []) {
				try {
					await processArticle(row, env);
					processed++;
				} catch (error) {
					console.error(`[Summarizer] /process failed for ${row.rawArticleId}:`, error);
				}
			}
			return new Response(JSON.stringify({ processed }), {
				headers: { "Content-Type": "application/json" },
			});
		}
		return new Response("Dansum Summarizer Worker", { status: 200 });
	},
};

async function processArticle(msg: QueueMessage, env: Env): Promise<void> {
	const { rawArticleId, sourceId, sourceName } = msg;

	// 원본 기사 조회
	const rawArticle = await env.DB.prepare(
		"SELECT * FROM raw_articles WHERE id = ? AND status = 'fetched'",
	)
		.bind(rawArticleId)
		.first<{
			id: string;
			title: string;
			content: string | null;
			description: string | null;
			url: string;
			retry_count: number;
		}>();

	if (!rawArticle) {
		console.log(`[Summarizer] Article ${rawArticleId} not found or already processed`);
		return;
	}

	// 재시도 횟수 초과 체크
	if (rawArticle.retry_count >= MAX_RETRY_COUNT) {
		await env.DB.prepare(
			"UPDATE raw_articles SET status = 'failed' WHERE id = ?",
		)
			.bind(rawArticleId)
			.run();
		return;
	}

	// 처리 중 상태로 변경
	await env.DB.prepare(
		"UPDATE raw_articles SET status = 'processing', retry_count = retry_count + 1 WHERE id = ?",
	)
		.bind(rawArticleId)
		.run();

	try {
		// Claude API로 요약
		const result = await summarizeArticle(
			{
				title: rawArticle.title,
				description: rawArticle.description,
				content: rawArticle.content,
				sourceName,
			},
			env.OPENAI_API_KEY,
			env.OPENAI_MODEL,
		);

		// 요약 결과 저장
		const articleId = crypto.randomUUID();
		await env.DB.prepare(
			`INSERT INTO articles (id, raw_article_id, source_id, title, original_title, summary, sections, key_points, category, keywords, source_url, source_name, published_at, image_url)
			 SELECT ?, ?, ?, ?, r.title, ?, ?, ?, ?, ?, r.url, ?, COALESCE(r.published_at, datetime('now')), r.image_url
			 FROM raw_articles r WHERE r.id = ?`,
		)
			.bind(
				articleId,
				rawArticleId,
				sourceId,
				result.title,
				result.summary,
				JSON.stringify(result.sections),
				JSON.stringify(result.key_points),
				result.category,
				JSON.stringify(result.keywords),
				sourceName,
				rawArticleId,
			)
			.run();

		// 원본 기사 상태 완료로 변경
		await env.DB.prepare(
			"UPDATE raw_articles SET status = 'completed' WHERE id = ?",
		)
			.bind(rawArticleId)
			.run();

		// 캐시 무효화 (홈 피드)
		await env.CACHE.delete("feed:home:page:1");
		await env.CACHE.delete(`feed:category:${result.category}:page:1`);

		console.log(`[Summarizer] Summarized: ${result.title}`);
	} catch (error) {
		// 실패 시 fetched로 되돌려서 재시도 가능하게
		await env.DB.prepare(
			"UPDATE raw_articles SET status = 'fetched' WHERE id = ?",
		)
			.bind(rawArticleId)
			.run();
		throw error;
	}
}
