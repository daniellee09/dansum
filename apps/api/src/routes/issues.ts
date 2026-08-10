import { Hono } from "hono";
import { getIssue } from "../services/article-service.js";

interface Env {
	DB: D1Database;
	CACHE: KVNamespace;
}

const issues = new Hono<{ Bindings: Env }>();

// 이슈 상세: 같은 사건을 다룬 기사 전체. 공개 데이터라 kvCache가 그대로 먹는다
// (논의 쪽은 여기 오지 않는다 — 댓글은 계정 도메인이라 apps/web이 D1에서 직접 읽는다).
issues.get("/:id", async (c) => {
	const issue = await getIssue(c.env.DB, c.req.param("id"));
	if (!issue) return c.json({ success: false, error: "Issue not found" }, 404);
	return c.json({ success: true, data: issue });
});

export { issues };
