/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

import type { Runtime } from "@astrojs/cloudflare";
import type { AuthUser } from "@dansum/shared";

type CloudflareEnv = {
	DB: D1Database;
	CACHE: KVNamespace;
	// 구글 OAuth. 로컬은 apps/web/.dev.vars, 운영은 Pages 시크릿(RUNBOOK 참고).
	GOOGLE_CLIENT_ID: string;
	GOOGLE_CLIENT_SECRET: string;
};

declare global {
	namespace App {
		interface Locals extends Runtime<CloudflareEnv> {
			user: AuthUser | null;
		}
	}
}
