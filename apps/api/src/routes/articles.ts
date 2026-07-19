import { Hono } from "hono";
import {
	getArticles,
	getArticleById,
	getRelatedArticles,
} from "../services/article-service.js";

interface Env {
	DB: D1Database;
	CACHE: KVNamespace;
}

const articles = new Hono<{ Bindings: Env }>();

// 기사 목록
articles.get("/", async (c) => {
	const page = Number(c.req.query("page") ?? "1");
	const pageSize = Number(c.req.query("pageSize") ?? "20");
	const category = c.req.query("category");
	const q = c.req.query("q");

	const result = await getArticles(c.env.DB, { page, pageSize, category, q });

	return c.json({ success: true, data: result });
});

// 관련 보도(같은 이슈 다른 매체) — /:id 보다 먼저 정의
articles.get("/:id/related", async (c) => {
	const id = c.req.param("id");
	const limit = Math.min(Number(c.req.query("limit") ?? "5"), 10);
	const related = await getRelatedArticles(c.env.DB, id, limit);
	return c.json({ success: true, data: related });
});

// 기사 상세
articles.get("/:id", async (c) => {
	const id = c.req.param("id");
	const article = await getArticleById(c.env.DB, id);

	if (!article) {
		return c.json({ success: false, error: "Article not found" }, 404);
	}

	return c.json({ success: true, data: article });
});

export { articles };
