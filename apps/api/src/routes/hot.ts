import { Hono } from "hono";
import { getHotArticles } from "../services/article-service.js";

interface Env {
	DB: D1Database;
}

const hot = new Hono<{ Bindings: Env }>();

// Hot!: 최근 24시간 안에서 보도량 점수가 가장 높은 개별 기사 상위 N개(기본·최대 50)
hot.get("/", async (c) => {
	const limit = Math.min(Number(c.req.query("limit") ?? "50"), 50);
	const articles = await getHotArticles(c.env.DB, limit);
	return c.json({ success: true, data: articles });
});

export { hot };
