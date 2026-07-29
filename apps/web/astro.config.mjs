import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
	output: "server",
	adapter: cloudflare({
		// 로컬 dev에서 D1/KV를 다른 워커(collector/fetcher/summarizer/api)와 같은 로컬 상태로
		// 공유한다 — 리포 루트의 .wrangler-state를 그대로 가리킨다(dansum-dev 스킬 참고).
		platformProxy: {
			// getPlatformProxy의 persist.path는 wrangler CLI의 --persist-to와 달리 v3 디렉터리
			// 자체를 가리켜야 같은 로컬 D1/KV 데이터를 공유한다(직접 검증함).
			persist: { path: "../../.wrangler-state/v3" },
		},
	}),
	vite: {
		plugins: [tailwindcss()],
	},
	server: {
		host: true,
		port: 4321,
	},
});
