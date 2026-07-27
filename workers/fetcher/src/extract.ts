import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

export interface Extracted {
	title: string;
	text: string;
}

/**
 * 본문 HTML에서 대표 이미지(og:image → twitter:image)를 뽑는다.
 * RSS에 이미지가 없던 기사를 보강하는 용도. 정규식으로 <head> meta만 훑어
 * linkedom 전체 파싱 비용을 피한다(워커 CPU 시간 절약).
 */
export function extractImageUrl(html: string, pageUrl: string): string | null {
	const patterns = [
		/<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)["']/i,
		/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::url)?["']/i,
		/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
	];
	for (const re of patterns) {
		const m = html.match(re);
		if (m?.[1]) {
			const resolved = resolveUrl(m[1].trim(), pageUrl);
			if (resolved) return resolved;
		}
	}
	return null;
}

/** 상대 경로·프로토콜 상대 URL을 기사 URL 기준 절대 https URL로 만든다 */
function resolveUrl(url: string, base: string): string | null {
	if (!url) return null;
	try {
		const abs = new URL(url, base);
		if (abs.protocol !== "http:" && abs.protocol !== "https:") return null;
		abs.protocol = "https:";
		return abs.toString();
	} catch {
		return null;
	}
}

/**
 * HTML에서 기사 본문을 추출한다. Readability 기반(사이트 무관).
 * 추출 실패하거나 본문이 너무 짧으면(SPA·봇차단 등) null 반환 → 호출부에서 description 폴백.
 */
export function extractArticle(html: string, maxChars: number): Extracted | null {
	let document: unknown;
	try {
		document = parseHTML(html).document;
	} catch {
		return null;
	}

	try {
		// Readability 타입은 표준 DOM 기준이라 linkedom 문서를 캐스팅해서 넘긴다.
		// biome-ignore lint/suspicious/noExplicitAny: linkedom <-> DOM 타입 차이 우회
		const reader = new Readability(document as any);
		const article = reader.parse();
		const text = (article?.textContent ?? "").replace(/\s+/g, " ").trim();
		if (text.length < 200) return null;
		return {
			title: (article?.title ?? "").trim(),
			text: text.slice(0, maxChars),
		};
	} catch {
		return null;
	}
}
