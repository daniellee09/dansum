/**
 * RSS 피드 유효성 검증 스크립트
 * 실행: pnpm dlx tsx scripts/test-rss.ts
 *
 * 각 뉴스 소스의 RSS URL을 fetch 하고 기존 파서로 파싱하여
 * HTTP 상태 / 파싱된 아이템 수 / 샘플 1건을 출력한다.
 */
import { NEWS_SOURCES } from "../workers/collector/src/sources/config.js";
import { parseRssFeed } from "../workers/collector/src/parsers/rss-parser.js";

async function checkSource(source: (typeof NEWS_SOURCES)[number]): Promise<boolean> {
	process.stdout.write(`\n[${source.id}] ${source.name}\n  URL: ${source.url}\n`);
	try {
		const res = await fetch(source.url, {
			headers: {
				"User-Agent": "Dansum-News-Collector/0.1",
				Accept: "application/rss+xml, application/xml, text/xml",
			},
		});
		process.stdout.write(`  HTTP: ${res.status} ${res.statusText}\n`);
		if (!res.ok) return false;

		const xml = await res.text();
		const items = parseRssFeed(xml);
		process.stdout.write(`  파싱된 아이템: ${items.length}건\n`);

		if (items.length === 0) {
			process.stdout.write("  ⚠️  아이템 0건 — 피드 형식이 파서와 맞지 않을 수 있음\n");
			return false;
		}

		const s = items[0];
		process.stdout.write(`  샘플: ${s.title}\n`);
		process.stdout.write(`         link=${s.link || "(없음)"}\n`);
		process.stdout.write(`         pubDate=${s.pubDate || "(없음)"}\n`);
		const hasLink = Boolean(s.link);
		if (!hasLink) {
			process.stdout.write("  ⚠️  link 추출 실패 — collector가 이 아이템을 건너뜀\n");
		}
		return hasLink;
	} catch (err) {
		process.stdout.write(`  ❌ 실패: ${err instanceof Error ? err.message : String(err)}\n`);
		return false;
	}
}

async function main(): Promise<void> {
	process.stdout.write("=== Dansum RSS 피드 검증 ===\n");
	const results: { id: string; ok: boolean }[] = [];
	for (const source of NEWS_SOURCES) {
		const ok = await checkSource(source);
		results.push({ id: source.id, ok });
	}

	process.stdout.write("\n=== 요약 ===\n");
	for (const r of results) {
		process.stdout.write(`  ${r.ok ? "✅" : "❌"} ${r.id}\n`);
	}
	const failed = results.filter((r) => !r.ok);
	if (failed.length > 0) {
		process.stdout.write(`\n${failed.length}개 소스 점검 필요. config.ts 와 seed/sources.sql 수정 검토.\n`);
		process.exitCode = 1;
	} else {
		process.stdout.write("\n모든 소스 정상.\n");
	}
}

main();
