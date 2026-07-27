import { XMLParser } from "fast-xml-parser";

export interface ParsedItem {
	title: string;
	link: string;
	description: string | null;
	author: string | null;
	pubDate: string | null;
	/** 대표 이미지. RSS에 없으면 null → fetcher가 og:image로 보강한다 */
	imageUrl: string | null;
}

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
});

export function parseRssFeed(xml: string): ParsedItem[] {
	const parsed = parser.parse(xml);

	// RSS 2.0 형식
	const channel = parsed?.rss?.channel;
	if (channel) {
		const items = Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : [];
		return items.map(normalizeItem);
	}

	// Atom 형식
	const feed = parsed?.feed;
	if (feed) {
		const entries = Array.isArray(feed.entry) ? feed.entry : feed.entry ? [feed.entry] : [];
		return entries.map(normalizeAtomEntry);
	}

	return [];
}

function normalizeItem(item: Record<string, unknown>): ParsedItem {
	return {
		title: String(item.title ?? "").trim(),
		link: extractLink(item.link),
		description: item.description ? stripHtml(String(item.description)) : null,
		author: item.author ? String(item.author) : item["dc:creator"] ? String(item["dc:creator"]) : null,
		pubDate: item.pubDate ? String(item.pubDate) : null,
		imageUrl: extractImage(item),
	};
}

function normalizeAtomEntry(entry: Record<string, unknown>): ParsedItem {
	const link = entry.link as Record<string, unknown> | undefined;
	return {
		title: String(entry.title ?? "").trim(),
		link: link?.["@_href"] ? String(link["@_href"]) : "",
		description: entry.summary ? stripHtml(String(entry.summary)) : null,
		author: entry.author
			? String((entry.author as Record<string, unknown>).name ?? "")
			: null,
		pubDate: entry.published ? String(entry.published) : entry.updated ? String(entry.updated) : null,
		imageUrl: extractImage(entry),
	};
}

/**
 * RSS 항목에서 대표 이미지 URL을 찾는다. 매체마다 쓰는 필드가 달라 우선순위대로 훑는다:
 * media:content → media:thumbnail → enclosure(image/*) → description 안의 첫 <img>
 */
function extractImage(item: Record<string, unknown>): string | null {
	const fromMedia =
		pickUrlAttr(item["media:content"]) ?? pickUrlAttr(item["media:thumbnail"]);
	if (fromMedia) return fromMedia;

	// enclosure는 오디오·비디오도 오므로 image 타입만 채택
	const enclosure = first(item.enclosure) as Record<string, unknown> | undefined;
	if (enclosure) {
		const type = String(enclosure["@_type"] ?? "");
		const url = enclosure["@_url"] ? String(enclosure["@_url"]) : "";
		if (url && (type.startsWith("image/") || !type)) return normalizeUrl(url);
	}

	const desc = item.description ?? item.summary ?? item["content:encoded"];
	if (desc) {
		const m = String(desc).match(/<img[^>]+src=["']([^"']+)["']/i);
		if (m?.[1]) return normalizeUrl(m[1]);
	}
	return null;
}

/** media:* 는 단일 객체이거나 배열이며 url을 속성으로 갖는다 */
function pickUrlAttr(node: unknown): string | null {
	const obj = first(node) as Record<string, unknown> | undefined;
	if (!obj) return null;
	const url = obj["@_url"];
	return url ? normalizeUrl(String(url)) : null;
}

function first(node: unknown): unknown {
	if (Array.isArray(node)) return node[0];
	return node ?? undefined;
}

/** 프로토콜 상대 URL(//host/a.jpg)과 http를 https로 정규화. 그 외 형식은 버린다. */
function normalizeUrl(url: string): string | null {
	const u = url.trim();
	if (!u) return null;
	if (u.startsWith("//")) return `https:${u}`;
	if (u.startsWith("http://")) return `https://${u.slice(7)}`;
	if (u.startsWith("https://")) return u;
	return null;
}

function extractLink(link: unknown): string {
	if (typeof link === "string") return link;
	if (typeof link === "object" && link !== null) {
		const obj = link as Record<string, unknown>;
		if (obj["@_href"]) return String(obj["@_href"]);
	}
	return "";
}

function stripHtml(html: string): string {
	return html.replace(/<[^>]*>/g, "").replace(/&[a-z]+;/gi, " ").trim();
}
