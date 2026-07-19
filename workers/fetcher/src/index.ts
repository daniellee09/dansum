import { extractArticle } from "./extract.js";

interface Env {
	DB: D1Database;
	SUMMARIZE_QUEUE: Queue;
	MAX_HTML_BYTES: string;
	MAX_CONTENT_CHARS: string;
}

interface FetchMessage {
	rawArticleId: string;
	sourceId: string;
	sourceName: string;
	url: string;
	language: string;
}

export default {
	async queue(batch: MessageBatch<FetchMessage>, env: Env): Promise<void> {
		for (const message of batch.messages) {
			try {
				await processArticle(message.body, env);
				message.ack();
			} catch (error) {
				console.error(
					`[Fetcher] Failed to fetch ${message.body.rawArticleId}:`,
					error,
				);
				message.retry();
			}
		}
	},

	// 개발 중 수동 트리거용: pending 기사들의 본문을 큐 없이 직접 추출
	async fetch(request: Request, env: Env): Promise<Response> {
		if (new URL(request.url).pathname === "/process") {
			const pending = await env.DB.prepare(
				`SELECT r.id AS rawArticleId, r.source_id AS sourceId, s.name AS sourceName,
				        r.url AS url, s.language AS language
				 FROM raw_articles r JOIN sources s ON s.id = r.source_id
				 WHERE r.status = 'pending' LIMIT 50`,
			).all<FetchMessage>();

			let fetched = 0;
			let failed = 0;
			for (const row of pending.results ?? []) {
				try {
					await processArticle(row, env);
					fetched++;
				} catch (error) {
					console.error(`[Fetcher] /process failed for ${row.rawArticleId}:`, error);
					failed++;
				}
			}
			return Response.json({ fetched, failed });
		}
		return new Response("Dansum Fetcher Worker", { status: 200 });
	},
};

async function processArticle(msg: FetchMessage, env: Env): Promise<void> {
	const { rawArticleId, sourceId, sourceName, url } = msg;
	const maxHtml = Number(env.MAX_HTML_BYTES) || 800_000;
	const maxChars = Number(env.MAX_CONTENT_CHARS) || 8_000;

	// fetching 상태로 표시
	await env.DB.prepare("UPDATE raw_articles SET status = 'fetching' WHERE id = ?")
		.bind(rawArticleId)
		.run();

	let content: string | null = null;
	try {
		const response = await fetch(url, {
			headers: {
				"User-Agent": "Dansum-News-Collector/0.1 (+https://dansum.example)",
				Accept: "text/html,application/xhtml+xml",
			},
		});
		if (response.ok) {
			let html = await response.text();
			if (html.length > maxHtml) html = html.slice(0, maxHtml);
			const extracted = extractArticle(html, maxChars);
			if (extracted) content = extracted.text;
		} else {
			console.warn(`[Fetcher] HTTP ${response.status} for ${url}`);
		}
	} catch (error) {
		// 네트워크/타임아웃 등은 큐 재시도에 맡기되, 본문 없이도 요약은 진행되도록 폴백한다.
		console.warn(`[Fetcher] fetch error for ${url}:`, error);
	}

	// 본문 추출 성공/실패와 무관하게 'fetched'로 전이 → summarizer로 넘김
	// (content가 null이면 summarizer가 description 폴백으로 요약)
	await env.DB.prepare("UPDATE raw_articles SET content = ?, status = 'fetched' WHERE id = ?")
		.bind(content, rawArticleId)
		.run();

	await env.SUMMARIZE_QUEUE.send({ rawArticleId, sourceId, sourceName });

	console.log(
		`[Fetcher] ${content ? `extracted ${content.length} chars` : "no body (fallback)"}: ${rawArticleId}`,
	);
}
