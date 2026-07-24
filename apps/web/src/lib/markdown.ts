const HTML_ESCAPES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/**
 * 요약 불릿의 ** 강조만 <strong>으로 바꾼 안전한 HTML을 만든다. set:html에 그대로 넘길 수 있다.
 *
 * 이스케이프를 먼저 하는 순서가 안전성의 전부다: 원문에 섞인 태그는 이 시점에 무력화되고,
 * '*'는 이스케이프 대상이 아니라 뒤따르는 정규식이 그대로 동작한다. 순서를 뒤집으면
 * 우리가 만든 <strong>까지 이스케이프되거나, 주입된 태그가 살아남는다.
 */
export function renderEmphasis(text: string): string {
	return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}
