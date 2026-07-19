import { XMLParser } from "fast-xml-parser";

export interface ParsedItem {
	title: string;
	link: string;
	description: string | null;
	author: string | null;
	pubDate: string | null;
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
	};
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
