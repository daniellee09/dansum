import type { Context, Next } from "hono";
import { FEED_CACHE_TTL, ARTICLE_CACHE_TTL } from "@dansum/shared";

interface Env {
	CACHE: KVNamespace;
}

export function kvCache(ttl?: number) {
	return async (c: Context<{ Bindings: Env }>, next: Next) => {
		// 검색(q)은 쿼리가 제각각이라 적중률이 낮고 미스마다 KV put만 쌓인다.
		// Hot!(/api/hot)은 방문할 때마다 최신 상태를 보여줘야 하는 페이지라 캐시를 안 쓴다.
		// 둘 다 캐시를 건너뛰고 D1에서 바로 읽는다.
		if (c.req.query("q") || c.req.path.startsWith("/api/hot")) {
			await next();
			return;
		}

		const cacheKey = `api:${c.req.url}`;
		const cached = await c.env.CACHE.get(cacheKey);

		if (cached) {
			return c.json(JSON.parse(cached));
		}

		await next();

		if (c.res.status === 200) {
			const body = await c.res.clone().text();
			const cacheTtl = ttl ?? (c.req.path.includes("/articles/") ? ARTICLE_CACHE_TTL : FEED_CACHE_TTL);
			c.executionCtx.waitUntil(
				c.env.CACHE.put(cacheKey, body, { expirationTtl: cacheTtl }),
			);
		}
	};
}
