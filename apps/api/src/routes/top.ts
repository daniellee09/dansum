import { Hono } from "hono";
import { getTopClusters } from "../services/article-service.js";

interface Env {
	DB: D1Database;
	CACHE: KVNamespace;
}

const top = new Hono<{ Bindings: Env }>();

// 오늘의 주요 뉴스(보도량 클러스터링 + KV 순위 스냅샷 비교)
top.get("/", async (c) => {
	const limit = Math.min(Number(c.req.query("limit") ?? "6"), 20);
	const clusters = await getTopClusters(c.env.DB, c.env.CACHE ?? null, limit);
	return c.json({ success: true, data: clusters });
});

export { top };
