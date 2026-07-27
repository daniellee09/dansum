export interface Extracted {
	title: string;
	text: string;
}

// 본문과 무관한 블록 제거(스크립트/스타일/네비 등). 백레퍼런스로 여는/닫는 태그 매칭.
const STRIP_BLOCKS =
	/<(script|style|noscript|head|nav|footer|aside|form|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi;
const COMMENTS = /<!--[\s\S]*?-->/g;

function decodeEntities(s: string): string {
	return s
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#0*39;|&apos;/g, "'")
		.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function stripTags(html: string): string {
	return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** 대표 이미지 메타 태그. 앞에 있는 것부터 우선한다(og:image가 사실상 표준). */
const IMAGE_META_PATTERNS = [
	/<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)["']/i,
	/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::url)?["']/i,
	/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
];

/**
 * 기사 HTML에서 대표 이미지(og:image → twitter:image)를 뽑는다.
 * 본문 추출용으로 이미 받아 둔 HTML을 그대로 쓰므로 추가 요청이 들어가지 않는다.
 * 메타 태그는 <head>에 있어 MAX_HTML_BYTES로 잘린 앞부분만으로 충분하다.
 *
 * RSS 썸네일보다 원본이 큰 경우가 많다(연합뉴스: RSS 500x262 vs og 1200x628).
 * 한국경제처럼 RSS에 이미지 필드가 아예 없는 매체는 이 경로로만 이미지를 얻는다.
 */
export function extractImageLight(html: string, pageUrl: string): string | null {
	for (const re of IMAGE_META_PATTERNS) {
		const m = html.match(re);
		if (!m?.[1]) continue;
		const url = decodeEntities(m[1].trim());
		try {
			const abs = new URL(url, pageUrl);
			if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
			// 대부분의 매체가 https를 지원하고, http면 브라우저가 혼합 콘텐츠로 막는다.
			abs.protocol = "https:";
			return abs.toString();
		} catch {
			// 상대 경로 해석 실패 → 다음 패턴
		}
	}
	return null;
}

/**
 * 정규식 기반 경량 본문 추출 (무료 플랜 CPU 한도 대응).
 * DOM을 만들지 않고 <p> 텍스트를 모아 본문을 근사한다. readability보다 품질은 낮지만
 * RSS description보다는 훨씬 많은 본문을 확보하며 CPU를 거의 쓰지 않는다.
 * 추출이 빈약하면(SPA·봇차단 등) null 반환 → 호출부에서 description 폴백.
 */
export function extractArticleLight(html: string, maxChars: number): Extracted | null {
	const cleaned = html.replace(COMMENTS, " ").replace(STRIP_BLOCKS, " ");

	// <article>이 있으면 그 안을 우선 스코프로(보일러플레이트 최소화)
	const articleMatch = cleaned.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
	const scope = articleMatch ? articleMatch[1] : cleaned;

	// <p> 단락 수집. 너무 짧은 조각(메뉴/캡션 등)은 제외.
	const paragraphs = [...scope.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
		.map((m) => stripTags(m[1]))
		.filter((t) => t.length >= 30);

	let text = paragraphs.join("\n\n").trim();

	// <p>가 거의 없는 마크업이면 스코프 전체 태그 제거로 폴백
	if (text.length < 200) text = stripTags(scope);
	if (text.length < 200) return null;

	const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
	const title = titleMatch ? stripTags(titleMatch[1]) : "";

	return { title, text: text.slice(0, maxChars) };
}
