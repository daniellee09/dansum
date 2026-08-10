import { Hono } from "hono";
import { cors } from "hono/cors";
import { articles } from "./routes/articles.js";
import { categories } from "./routes/categories.js";
import { top } from "./routes/top.js";
import { hot } from "./routes/hot.js";
import { issues } from "./routes/issues.js";
import { kvCache } from "./middleware/cache.js";

interface Env {
	DB: D1Database;
	CACHE: KVNamespace;
}

const app = new Hono<{ Bindings: Env }>();

// CORS 설정
app.use("/*", cors({
	origin: ["https://dansum-web.pages.dev", "http://localhost:4321", "http://localhost:3000"],
	allowMethods: ["GET"],
}));

// 캐시 미들웨어
app.use("/api/*", kvCache());

// 라우트
app.route("/api/articles", articles);
app.route("/api/categories", categories);
app.route("/api/top", top);
app.route("/api/hot", hot);
app.route("/api/issues", issues);

// 헬스체크
app.get("/", (c) => {
	return c.json({ name: "Dansum API", version: "0.1.0", status: "ok" });
});

export default app;
