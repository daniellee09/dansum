import { Hono } from "hono";
import { getCategories } from "../services/article-service.js";

interface Env {
	DB: D1Database;
}

const categories = new Hono<{ Bindings: Env }>();

categories.get("/", async (c) => {
	const result = await getCategories(c.env.DB);
	return c.json({ success: true, data: result });
});

export { categories };
