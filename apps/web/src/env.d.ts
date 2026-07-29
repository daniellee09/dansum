/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

import type { Runtime } from "@astrojs/cloudflare";
import type { AuthUser } from "@dansum/shared";

type CloudflareEnv = {
	DB: D1Database;
	CACHE: KVNamespace;
};

declare global {
	namespace App {
		interface Locals extends Runtime<CloudflareEnv> {
			user: AuthUser | null;
		}
	}
}
