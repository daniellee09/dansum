import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

export interface Extracted {
	title: string;
	text: string;
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
