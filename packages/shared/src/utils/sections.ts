import type { ArticleSection, SectionPoint } from "../types/article.js";

/** 불릿 하나가 가질 수 있는 하위 불릿 수 상한(모델이 과하게 뱉는 것을 방어) */
const MAX_CHILDREN = 6;

/**
 * 불릿 하나를 정규화.
 * 구 형식(문자열)은 { text }로 승격한다 — sections에 중첩이 없던 시절의 기존 행을
 * 재요약 없이 그대로 렌더하기 위한 호환 경로다.
 */
function normalizePoint(value: unknown): SectionPoint | null {
	if (typeof value === "string") {
		const text = value.trim();
		return text === "" ? null : { text };
	}
	if (value == null || typeof value !== "object") return null;

	const { text, children } = value as { text?: unknown; children?: unknown };
	if (typeof text !== "string" || text.trim() === "") return null;

	const point: SectionPoint = { text: text.trim() };

	if (Array.isArray(children)) {
		const kids = children
			.filter((c): c is string => typeof c === "string")
			.map((c) => c.trim())
			.filter((c) => c !== "")
			.slice(0, MAX_CHILDREN);
		if (kids.length > 0) point.children = kids;
	}

	return point;
}

/**
 * LLM 응답 또는 DB에 저장된 sections 값을 신뢰할 수 있는 형태로 정규화한다.
 * 요약 워커(생성 시점)와 API(조회 시점) 양쪽에서 같은 규칙을 쓰기 위해 shared에 둔다.
 * 형태가 어긋난 항목은 예외 대신 조용히 버린다 — 요약 한 건의 부분 손상이
 * 기사 전체를 렌더 불가로 만들지 않도록.
 */
export function normalizeSections(value: unknown): ArticleSection[] {
	if (!Array.isArray(value)) return [];

	return value
		.map((section) => {
			if (section == null || typeof section !== "object") return null;
			const { heading, points } = section as { heading?: unknown; points?: unknown };
			if (typeof heading !== "string" || heading.trim() === "") return null;
			if (!Array.isArray(points)) return null;

			const normalized = points
				.map(normalizePoint)
				.filter((p): p is SectionPoint => p !== null);
			if (normalized.length === 0) return null;

			return { heading: heading.trim(), points: normalized };
		})
		.filter((s): s is ArticleSection => s !== null);
}
